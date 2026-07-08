// Piece 3 of the bulk-direct-DB-load plan (see project memory
// project_plan_bulk_direct_db_load / ama_bulk_direct_db_load): drains the
// pre-parsed, pre-mapped corpus (scripts/bulk/build-write-ready.ts's chunked
// JSONL, committed to this repo's data-staging branch) into `snapshots` +
// `schemes` via the platform-dev-granted bulk-insert endpoint
// (dbBulkInsert — up to 1000 rows/call, 1 call against the 600/min limit
// regardless of row count).
//
// Self-reschedules via createDelayedTask every 1 minute until the whole
// corpus is written — far faster than the platform's 1-hour minimum cron
// interval, and needs no locally-held credential: each invocation receives
// its own short-lived task token automatically, same as every other
// scheduled task callback.
//
// scheme_latest / securities / holdings_index are deliberately NOT written
// here — those are a separate finalize pass (F1/F6 follow-up) once the
// snapshots/schemes backfill is confirmed complete, to keep this route's
// per-invocation work simple and fast. See project_status_full_disclosure_archive.
import { NextRequest, NextResponse } from "next/server";
import { dbBulkInsert } from "@/lib/db";
import { getIngestCursor, setIngestCursor } from "@/lib/ingest-write";
import { createDelayedTask } from "@/lib/task-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CURSOR_KEY = "bulk_load";
const GITHUB_REPO = "AdityaDutta02/invest-os-mf-analyser";
const STAGING_BRANCH = "data-staging";
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_REPO}/${STAGING_BRANCH}/staging/bulk-ready`;

const BUDGET_MS = 25_000;
const FETCH_TIMEOUT_MS = 15_000;
const BULK_MAX_ROWS = 1000;
const BULK_MAX_BYTES = 5_000_000; // stay well under the endpoint's ~10MB cap

interface ChunkIndex {
  chunkFiles: string[];
  totalRecords: number;
  chunkSize: number;
}

interface WriteRow {
  scheme_code: string;
  period: string;
  source: string;
  data: {
    scheme_name: string;
    amc_name: string;
    category: string;
    isin: string;
    asset_class: string;
    [k: string]: unknown;
  };
}

async function fetchRaw(path: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${RAW_BASE}/${path}`, { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) throw new Error(`fetch ${path} -> ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// Greedy byte-aware batching — a chunk can contain a few outsized records
// (e.g. an index fund with 1000+ holdings, flagged as a risk in the plan's
// FMEA F2), so a fixed row count alone isn't safe against the endpoint's
// body-size cap.
function batchRows<T>(rows: T[]): T[][] {
  const batches: T[][] = [];
  let cur: T[] = [];
  let curBytes = 2; // "[]"
  for (const row of rows) {
    const size = JSON.stringify(row).length;
    if (cur.length > 0 && (cur.length >= BULK_MAX_ROWS || curBytes + size > BULK_MAX_BYTES)) {
      batches.push(cur);
      cur = [];
      curBytes = 2;
    }
    cur.push(row);
    curBytes += size + 1;
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return NextResponse.json({ error: "missing task token" }, { status: 401 });

  const index: ChunkIndex = JSON.parse(await fetchRaw("index.json"));
  const packed = await getIngestCursor(CURSOR_KEY, token);
  let chunkIdx = Math.floor(packed / 1_000_000);
  let lineOffset = packed % 1_000_000;

  if (chunkIdx >= index.chunkFiles.length) {
    return NextResponse.json({ done: true, totalChunks: index.chunkFiles.length, totalRecords: index.totalRecords });
  }

  let snapshotsWritten = 0;
  let schemesWritten = 0;
  let snapshotErrors = 0;
  const seenSchemeCodes = new Map<string, WriteRow["data"]>();

  outer: while (chunkIdx < index.chunkFiles.length) {
    const text = await fetchRaw(index.chunkFiles[chunkIdx]);
    const lines = text.split("\n").filter(Boolean);
    let i = lineOffset;

    while (i < lines.length) {
      if (Date.now() - startedAt > BUDGET_MS) break outer;

      // Take as many remaining lines as fit one processing pass this
      // invocation (bounded by the byte-aware batcher below anyway).
      const rows: WriteRow[] = lines.slice(i, i + 2000).map((l) => JSON.parse(l));
      const snapshotRows = rows.map((r) => ({ scheme_code: r.scheme_code, period: r.period, source: r.source, data: r.data }));

      for (const batch of batchRows(snapshotRows)) {
        if (Date.now() - startedAt > BUDGET_MS) break outer;
        const result = await dbBulkInsert("snapshots", batch, token);
        snapshotsWritten += result.inserted.length;
        snapshotErrors += result.errors.filter((e) => e.error !== "unique_violation").length;
      }
      for (const r of rows) {
        if (!seenSchemeCodes.has(r.scheme_code)) seenSchemeCodes.set(r.scheme_code, r.data);
      }

      i += rows.length;
    }

    lineOffset = i;
    if (lineOffset >= lines.length) {
      chunkIdx++;
      lineOffset = 0;
    } else {
      break; // ran out of budget mid-chunk
    }
  }

  const schemeRows = [...seenSchemeCodes.entries()].map(([scheme_code, d]) => ({
    scheme_code,
    amc_name: d.amc_name,
    scheme_name: d.scheme_name,
    isin: d.isin || null,
    category: d.category,
    asset_class: d.asset_class,
  }));
  for (const batch of batchRows(schemeRows)) {
    const result = await dbBulkInsert("schemes", batch, token);
    schemesWritten += result.inserted.length;
  }

  await setIngestCursor(CURSOR_KEY, chunkIdx * 1_000_000 + lineOffset, token);

  const done = chunkIdx >= index.chunkFiles.length;
  if (!done) {
    await createDelayedTask(
      { name: "Bulk load continue", callbackPath: "/api/cron/bulk-load", delayMinutes: 1 },
      token,
    );
  }

  return NextResponse.json({
    done,
    chunkIdx,
    lineOffset,
    totalChunks: index.chunkFiles.length,
    snapshotsWritten,
    snapshotErrors,
    schemesWritten,
  });
}
