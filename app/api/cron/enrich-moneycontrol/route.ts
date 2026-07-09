// Moneycontrol enrichment pass (task #8 follow-up): backfills current-month
// NAV/AUM/holdings for every scheme in schemes.jsonl via lib/moneycontrol.ts
// — the supplementary source, not a replacement for the full SEBI-disclosure
// corpus (see lib/moneycontrol.ts's header comment). Growth plans only.
//
// Same self-rescheduling chain pattern app/api/cron/bulk-load/route.ts
// already proved out live (task-name-uniqueness fix, budget guard, retry
// on failure) — reused here rather than re-derived, since that pattern took
// 3 rounds of live debugging to get right the first time.
import { NextRequest, NextResponse } from "next/server";
import { dbInsert, dbList, dbDelete } from "@/lib/db";
import { getIngestCursor, setIngestCursor } from "@/lib/ingest-write";
import { createDelayedTask } from "@/lib/task-sdk";
import {
  searchFunds,
  fetchFundOverview,
  isGrowthOption,
  fetchHoldings,
  fetchAssetAllocation,
  assembleFromMoneycontrol,
} from "@/lib/moneycontrol";
import type { SchemeIdentity } from "@/lib/mfapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CURSOR_KEY = "enrich_moneycontrol";
const GITHUB_REPO = "AdityaDutta02/invest-os-mf-analyser";
const STAGING_BRANCH = "data-staging";
const SCHEMES_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/${STAGING_BRANCH}/staging/bulk-ready/enrich/schemes.jsonl`;

// One scheme costs ~4 sequential Moneycontrol fetches (search, overview,
// holdings, asset-alloc) plus a handful of gateway writes — budget lower
// than bulk-load's per-cycle allowance since each item does more work.
const BUDGET_MS = 20_000;
const TAIL_DEADLINE_MS = 26_000;
const FETCH_TIMEOUT_MS = 10_000;

interface SchemeEntry {
  scheme_code: string;
  amc_name: string;
  scheme_name: string;
  isin: string | null;
  category: string;
  asset_class: string;
}

async function fetchSchemesList(): Promise<SchemeEntry[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(SCHEMES_URL, { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) throw new Error(`fetch schemes list -> ${res.status}`);
    const text = await res.text();
    return text
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as SchemeEntry);
  } finally {
    clearTimeout(t);
  }
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function purge(table: string, filters: Record<string, string>, token: string): Promise<void> {
  try {
    const rows = await dbList<{ id: string }>(table, filters, token);
    await Promise.all(rows.map((r) => dbDelete(table, r.id, token).catch(() => {})));
  } catch {
    /* best-effort */
  }
}

// One scheme end-to-end: resolve on Moneycontrol (growth plan only), fetch
// holdings + allocation, write as a tagged snapshot row. Never throws —
// any failure for one scheme just skips it, the cursor still advances.
async function enrichOne(entry: SchemeEntry, period: string, token: string): Promise<"written" | "no_match" | "skipped"> {
  const hits = await searchFunds(`${entry.scheme_name} ${entry.amc_name}`).catch(() => []);
  if (hits.length === 0) return "no_match";

  // Prefer a hit whose overview resolves to a Growth option; try up to the
  // first few candidates since autosuggest ranking isn't always exact.
  for (const hit of hits.slice(0, 5)) {
    const ov = await fetchFundOverview(hit.imid, hit.slug).catch(() => null);
    if (!ov) continue;
    const growth = ov.planOptions.find(isGrowthOption) ?? (isGrowthOption(ov) ? ov : null);
    if (!growth) continue;
    const isin = "isin" in growth ? growth.isin : ov.isin;

    const [stocks, alloc] = await Promise.all([
      fetchHoldings(isin).catch(() => []),
      fetchAssetAllocation(isin).catch(() => null),
    ]);
    if (stocks.length === 0 && !alloc) continue;

    const identity: SchemeIdentity = {
      scheme_code: entry.scheme_code,
      scheme_name: entry.scheme_name,
      amc_name: entry.amc_name,
      fund_house: entry.amc_name,
      category: entry.category,
      asset_class: (entry.asset_class as SchemeIdentity["asset_class"]) || "other",
      isin: entry.isin || "",
      latest_nav: null,
      latest_nav_date: null,
      inception_date: null,
    };
    const asOf = new Date().toISOString().slice(0, 10);
    const data = assembleFromMoneycontrol(
      identity,
      ov,
      alloc,
      stocks,
      period,
      asOf,
      `https://www.moneycontrol.com/mutual-funds/nav/${hit.slug}/${hit.imid}`,
    );

    await purge("snapshots", { scheme_code: entry.scheme_code, period }, token);
    await dbInsert("snapshots", { scheme_code: entry.scheme_code, period, source: "moneycontrol_enrich", data }, token);
    return "written";
  }
  return "no_match";
}

function reschedName(): string {
  return `Enrich MC continue ${Date.now()}`;
}

async function retry(token: string): Promise<void> {
  await createDelayedTask({ name: reschedName(), callbackPath: "/api/cron/enrich-moneycontrol", delayMinutes: 1 }, token).catch(() => {});
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
  const schemes = await fetchSchemesList();
  const cursor = await getIngestCursor(CURSOR_KEY, token).catch(() => 0);

  if (cursor >= schemes.length) {
    return NextResponse.json({ done: true, totalSchemes: schemes.length });
  }

  const period = currentPeriod();
  let i = cursor;
  let written = 0;
  let noMatch = 0;
  let skipped = 0;

  while (i < schemes.length) {
    if (Date.now() - startedAt > BUDGET_MS) break;
    const entry = schemes[i];
    try {
      const result = await enrichOne(entry, period, token);
      if (result === "written") written++;
      else if (result === "no_match") noMatch++;
      else skipped++;
    } catch {
      skipped++;
    }
    i++;
  }

  await setIngestCursor(CURSOR_KEY, i, token);

  const done = i >= schemes.length;
  if (!done && Date.now() - startedAt < TAIL_DEADLINE_MS) {
    await createDelayedTask({ name: reschedName(), callbackPath: "/api/cron/enrich-moneycontrol", delayMinutes: 1 }, token);
  } else if (!done) {
    await retry(token);
  }

  return NextResponse.json({ done, cursor: i, totalSchemes: schemes.length, written, noMatch, skipped, period });
}
