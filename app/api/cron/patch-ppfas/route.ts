// Full PPFAS wipe-and-reload (superseding the earlier partial patch —
// user explicitly said "delete all the old data from PPFAS and just keep
// the data from the excel+nav+aum data"). The dev's original DB load used
// the pre-scheme-name-fix JSONL, so PPFAS's `schemes` table has both
// correctly-coded rows (real mfapi codes) AND garbage ones
// (`corpus-ppfas-mutual-fund-...`) — both types were inserted with
// amc_name="PPFAS Mutual Fund" literally, so a single dbList on that
// filter finds every scheme_code ever used, regardless of correctness.
// `snapshots` has no amc_name column, so its rows are found per-scheme via
// scheme_code once the full scheme_code list is known.
//
// Self-rescheduling chain (same proven pattern as bulk-load/enrich-
// moneycontrol — task-name uniqueness, budget guard, retry-on-failure):
// phase 1 wipes every snapshot+schemes row for each known scheme_code one
// at a time (cursor = index into the scheme_code list); phase 2 (cursor
// reaches the end) does the clean bulk-insert exactly once.
import { NextRequest, NextResponse } from "next/server";
import { dbList, dbDelete, dbBulkInsert } from "@/lib/db";
import { getIngestCursor, setIngestCursor } from "@/lib/ingest-write";
import { createDelayedTask } from "@/lib/task-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CURSOR_KEY = "ppfas_wipe";
const GITHUB_REPO = "AdityaDutta02/invest-os-mf-analyser";
const STAGING_BRANCH = "data-staging";
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_REPO}/${STAGING_BRANCH}/staging/bulk-ready/patches`;
const BUDGET_MS = 20_000;

async function fetchRows<T>(name: string): Promise<T[]> {
  const res = await fetch(`${RAW_BASE}/${name}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch ${name} -> ${res.status}`);
  const text = await res.text();
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function reschedName(): string {
  return `PPFAS wipe continue ${Date.now()}`;
}
async function retry(token: string): Promise<void> {
  await createDelayedTask({ name: reschedName(), callbackPath: "/api/cron/patch-ppfas", delayMinutes: 1 }, token).catch(() => {});
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return NextResponse.json({ error: "missing task token" }, { status: 401 });

  try {
    return await run(token, startedAt);
  } catch (e) {
    await retry(token);
    return NextResponse.json({ error: "cycle failed, retrying", detail: String(e) }, { status: 200 });
  }
}

async function run(token: string, startedAt: number): Promise<NextResponse> {
  const cursor = await getIngestCursor(CURSOR_KEY, token).catch(() => 0);
  if (cursor === -1) return NextResponse.json({ done: true, alreadyCompleted: true });

  const schemeRows = await dbList<{ id: string; scheme_code: string }>("schemes", { amc_name: "PPFAS Mutual Fund" }, token);

  if (cursor < schemeRows.length) {
    let i = cursor;
    let deletedSnapshots = 0;
    let deletedSchemes = 0;
    while (i < schemeRows.length) {
      if (Date.now() - startedAt > BUDGET_MS) break;
      const s = schemeRows[i];
      try {
        const snaps = await dbList<{ id: string }>("snapshots", { scheme_code: s.scheme_code }, token);
        await Promise.all(snaps.map((r) => dbDelete("snapshots", r.id, token).catch(() => {})));
        deletedSnapshots += snaps.length;
        await dbDelete("schemes", s.id, token).catch(() => {});
        deletedSchemes++;
      } catch {
        /* best-effort — a stuck scheme_code just gets retried next cycle since cursor only advances past it below */
      }
      i++;
    }
    await setIngestCursor(CURSOR_KEY, i, token);
    const wipeDone = i >= schemeRows.length;
    if (!wipeDone) {
      await createDelayedTask({ name: reschedName(), callbackPath: "/api/cron/patch-ppfas", delayMinutes: 1 }, token);
    } else {
      // Immediately continue into the insert phase in the SAME cycle if
      // there's budget left, rather than waiting a full extra minute.
      if (Date.now() - startedAt < BUDGET_MS) return insertPhase(token, schemeRows.length);
      await createDelayedTask({ name: reschedName(), callbackPath: "/api/cron/patch-ppfas", delayMinutes: 1 }, token);
    }
    return NextResponse.json({ phase: "wipe", cursor: i, total: schemeRows.length, deletedSnapshots, deletedSchemes, wipeDone });
  }

  return insertPhase(token, schemeRows.length);
}

async function insertPhase(token: string, totalWiped: number): Promise<NextResponse> {
  const [snapshots, schemes] = await Promise.all([
    fetchRows<Record<string, unknown>>("ppfas-full-history-snapshots.jsonl"),
    fetchRows<Record<string, unknown>>("ppfas-full-history-schemes.jsonl"),
  ]);
  const snapResult = await dbBulkInsert("snapshots", snapshots, token);
  const schemeResult = await dbBulkInsert("schemes", schemes, token);
  await setIngestCursor(CURSOR_KEY, -1, token); // sentinel: fully done, don't re-wipe on accidental re-trigger

  return NextResponse.json({
    phase: "insert",
    done: true,
    totalSchemesWiped: totalWiped,
    snapshots: { total: snapshots.length, inserted: snapResult.inserted.length, errors: snapResult.errors },
    schemes: { total: schemes.length, inserted: schemeResult.inserted.length, errors: schemeResult.errors },
  });
}
