// One-shot admin patch: replaces PPFAS's full historical snapshots/schemes
// with corrected full-detail data (346 fund-months across all 7 PPFAS
// funds, Jan 2020-June 2026 — the original bulk-load used the pre-parser-
// fix JSONL, so most PPFAS records were attached to garbage scheme_codes
// even though the source files were always the full detailed disclosure).
//
// dbBulkInsert skips a row on unique_violation rather than replacing it —
// fine for the historical bulk (near-zero chance a correct-coded row
// already exists for e.g. 2021-03), but wrong for recent months: the
// hourly direct-fetch ingest cron could plausibly have already written a
// correctly-coded row for the current period that's nonetheless thinner
// than this full-detail patch (that mismatch is exactly what the user
// flagged). Recent periods get an explicit delete-then-insert instead so
// they're actually replaced, not silently skipped.
import { NextRequest, NextResponse } from "next/server";
import { dbBulkInsert, dbList, dbDelete, dbInsert } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GITHUB_REPO = "AdityaDutta02/invest-os-mf-analyser";
const STAGING_BRANCH = "data-staging";
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_REPO}/${STAGING_BRANCH}/staging/bulk-ready/patches`;
// Periods from here forward get delete-then-insert instead of bulk-insert.
const RECENT_CUTOFF = "2026-04";

interface SnapshotRow {
  scheme_code: string;
  period: string;
  source: string;
  data: Record<string, unknown>;
  [key: string]: unknown;
}

async function fetchRows<T>(name: string): Promise<T[]> {
  const res = await fetch(`${RAW_BASE}/${name}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch ${name} -> ${res.status}`);
  const text = await res.text();
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return NextResponse.json({ error: "missing task token" }, { status: 401 });

  try {
    const [allSnapshots, schemes] = await Promise.all([
      fetchRows<SnapshotRow>("ppfas-full-history-snapshots.jsonl"),
      fetchRows<Record<string, unknown>>("ppfas-full-history-schemes.jsonl"),
    ]);

    const recent = allSnapshots.filter((r) => r.period >= RECENT_CUTOFF);
    const older = allSnapshots.filter((r) => r.period < RECENT_CUTOFF);

    let recentReplaced = 0;
    const recentErrors: { scheme_code: string; period: string; error: string }[] = [];
    for (const r of recent) {
      try {
        const existing = await dbList<{ id: string }>("snapshots", { scheme_code: r.scheme_code, period: r.period }, token);
        await Promise.all(existing.map((row) => dbDelete("snapshots", row.id, token).catch(() => {})));
        await dbInsert("snapshots", r, token);
        recentReplaced++;
      } catch (e) {
        recentErrors.push({ scheme_code: r.scheme_code, period: r.period, error: String(e) });
      }
    }

    const olderResult = await dbBulkInsert("snapshots", older, token);
    const schemeResult = await dbBulkInsert("schemes", schemes, token);

    return NextResponse.json({
      done: true,
      recent: { total: recent.length, replaced: recentReplaced, errors: recentErrors },
      older: { total: older.length, inserted: olderResult.inserted.length, errors: olderResult.errors },
      schemes: { total: schemes.length, inserted: schemeResult.inserted.length, errors: schemeResult.errors },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
