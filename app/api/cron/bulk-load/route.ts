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

// Lowered from 25s: the main snapshot-write loop respects this, but the
// schemes dedup-write tail + cursor write + createDelayedTask call ran
// AFTER it with no time check at all — on a cycle with more distinct
// schemes or slower network, that unaccounted tail work could push total
// wall-clock past the platform's real (undocumented) invocation ceiling,
// getting the whole request killed before createDelayedTask ever fires.
// That produced exactly the intermittent pattern observed live: cycle 1
// (kickoff) made it through, cycle 2 didn't and the self-rescheduling
// chain silently died. Same class of bug ingest-staged's route already
// hit once (see its BUDGET_MS/ENTRY_DEADLINE_MS comments) — leave real
// headroom below budget for the tail, and make the tail skip low-priority
// work (schemes) rather than skip the cursor/reschedule that keeps the
// chain alive.
// Raised from 15s now that the real root cause (task-name collision, see
// commit 4bc52d9b) is fixed and chunks are small (150 records) — the
// original risk this guarded against (a large partially-processed chunk
// re-fetched in full) no longer applies. 22s matches the value
// ingest-staged's route already runs safely in production. Higher budget
// = more chunks drained per cycle = fewer total cycles needed for the
// 990-chunk backlog.
const BUDGET_MS = 22_000;
const TAIL_DEADLINE_MS = 27_000; // hard ceiling incl. schemes tail — never skip cursor/reschedule
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

// A transient failure anywhere in one cycle (GitHub raw fetch blip, a
// gateway hiccup) must not permanently end the backfill — retry the exact
// same cursor position from a fresh invocation rather than let an uncaught
// exception skip straight past createDelayedTask. Confirmed necessary live:
// the chain died twice at cycle 2 even after bounding the known slow tail,
// which pointed at an upstream failure (most likely repeatedly re-fetching
// a large partially-processed chunk file) killing the request before it
// ever reached the reschedule call.
export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return NextResponse.json({ error: "missing task token" }, { status: 401 });

  let chunkIdx = 0;
  let lineOffset = 0;
  try {
    const packed = await getIngestCursor(CURSOR_KEY, token);
    chunkIdx = Math.floor(packed / 1_000_000);
    lineOffset = packed % 1_000_000;
  } catch (e) {
    await retry(token);
    return NextResponse.json({ error: "cursor read failed, retrying", detail: String(e) }, { status: 200 });
  }

  try {
    return await run(token, chunkIdx, lineOffset, startedAt);
  } catch (e) {
    await retry(token);
    return NextResponse.json({ error: "cycle failed, retrying same position", chunkIdx, lineOffset, detail: String(e) }, { status: 200 });
  }
}

// Task names must be unique per app — every prior reschedule reused the
// literal string "Bulk load continue", which fails once a task with that
// name already exists (the first cycle's one-shot task, disabled but not
// deleted after firing — nothing in the route's own authority can delete
// it; only the owner-level platform API can). That exactly explains the
// repeatable "succeeds once, then dies at the identical next step" pattern
// seen across three separate live test runs. Suffix with the current
// timestamp so every reschedule call gets a distinct name.
function reschedName(): string {
  return `Bulk load continue ${Date.now()}`;
}

async function retry(token: string): Promise<void> {
  await createDelayedTask({ name: reschedName(), callbackPath: "/api/cron/bulk-load", delayMinutes: 1 }, token).catch(() => {});
}

async function run(token: string, startChunkIdx: number, startLineOffset: number, startedAt: number): Promise<NextResponse> {
  let chunkIdx = startChunkIdx;
  let lineOffset = startLineOffset;
  const index: ChunkIndex = JSON.parse(await fetchRaw("index.json"));

  if (chunkIdx >= index.chunkFiles.length) {
    return NextResponse.json({ done: true, totalChunks: index.chunkFiles.length, totalRecords: index.totalRecords });
  }

  let snapshotsWritten = 0;
  let schemesWritten = 0;
  let snapshotErrors = 0;
  const seenSchemeCodes = new Map<string, WriteRow["data"]>();

  // Chunks are small (150 records) so a single dbBulkInsert call (up to
  // 1000 rows) can hold several chunks' worth at once. Fetch GROUP chunks
  // concurrently and issue one insert call per group instead of one per
  // chunk — if per-call latency (GitHub raw / gateway round-trip), not row
  // count, is the throughput bottleneck, this cuts round-trips ~GROUP-fold
  // per invocation. Groups are always processed whole, so lineOffset stays
  // 0 (kept in the cursor packing only for format compatibility).
  const GROUP = 6; // 6 * 150 = 900 rows, stays under the 1000-row bulk cap
  outer: while (chunkIdx < index.chunkFiles.length) {
    if (Date.now() - startedAt > BUDGET_MS) break;

    const groupIdxs: number[] = [];
    for (let k = 0; k < GROUP && chunkIdx + k < index.chunkFiles.length; k++) groupIdxs.push(chunkIdx + k);

    const texts = await Promise.all(groupIdxs.map((idx) => fetchRaw(index.chunkFiles[idx])));
    const rows: WriteRow[] = [];
    for (const text of texts) {
      for (const line of text.split("\n").filter(Boolean)) rows.push(JSON.parse(line));
    }
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

    chunkIdx += groupIdxs.length;
    lineOffset = 0;
  }

  // Lower priority than keeping the chain alive — skip remaining batches
  // once close to the deadline rather than risk the whole invocation (and
  // the cursor-write/reschedule below) getting killed mid-tail. Schemes
  // for skipped codes get picked up naturally when that scheme_code
  // reappears in a later period's chunk.
  const schemeRows = [...seenSchemeCodes.entries()].map(([scheme_code, d]) => ({
    scheme_code,
    amc_name: d.amc_name,
    scheme_name: d.scheme_name,
    isin: d.isin || null,
    category: d.category,
    asset_class: d.asset_class,
  }));
  for (const batch of batchRows(schemeRows)) {
    if (Date.now() - startedAt > TAIL_DEADLINE_MS) break;
    const result = await dbBulkInsert("schemes", batch, token);
    schemesWritten += result.inserted.length;
  }

  await setIngestCursor(CURSOR_KEY, chunkIdx * 1_000_000 + lineOffset, token);

  const done = chunkIdx >= index.chunkFiles.length;
  if (!done) {
    await createDelayedTask(
      { name: reschedName(), callbackPath: "/api/cron/bulk-load", delayMinutes: 1 },
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
