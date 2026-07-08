// M1+M2: monthly ingest for the ~13 direct-fetch AMCs (lib/registry.ts).
// Triggered by a Terminal AI scheduled task (create_scheduled_task), which
// POSTs here with a short-lived task token in Authorization — the only
// token a headless/off-session caller can get from this platform (see
// ARCHITECTURE.md / plan for why /api/ingest with a static secret doesn't
// work: the DB gateway only accepts embed/task tokens, never a static key).
//
// Default mode discovers every scheme across the 13 direct-fetch AMCs
// (lib/discover.ts) and processes as many as `limit` allows per invocation,
// skipping tuples already 'success' in ingest_runs — the backlog drains
// over repeat scheduled runs. Pass scheme_codes explicitly to target a
// specific subset instead.
import { NextRequest, NextResponse } from "next/server";
import { getIdentity } from "@/lib/identity";
import { recipeFor, DIRECT_AMCS } from "@/lib/registry";
import { parseWorkbook } from "@/lib/ingest";
import { navOnOrBefore } from "@/lib/mfapi";
import { writeSnapshot, logIngestRun, alreadyIngested } from "@/lib/ingest-write";
import { discoverAllDirectSchemes } from "@/lib/discover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function currentPeriod(): string {
  // Portfolio disclosures publish for the *prior* month; a run in the first
  // days of month M targets M-1's period.
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), 0); // last day of prev month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface CronPayload {
  period?: string;
  scheme_codes?: string[];
  limit?: number; // cap schemes processed this invocation (route has a wall-clock budget)
}

// Lowered from 20 — writeSnapshot fans out to 4 tables (snapshots, ai_cache,
// schemes, holdings_index, securities), and each equity holding costs its
// own dbInsert on top of that. A ~50-holding fund can be 100+ gateway round
// trips; 20 schemes/invocation was almost certainly what was timing out the
// hourly task (both cron tasks were reporting last_run_status: "failed").
// The BUDGET_MS wall-clock guard below is the real backstop — this is just
// a sane starting cap.
// Lowered from 5 — a single scheme's fetchPortfolio can itself take up to
// ~8-16s (registry.ts's per-candidate fetch timeout) before the loop even
// re-checks BUDGET_MS, so a handful of slow/hung candidates in one item can
// still blow past the callback's real execution ceiling. 3 keeps worst-case
// per-invocation wall clock lower even if BUDGET_MS is never hit exactly.
const DEFAULT_LIMIT = 3;
// Terminal AI task callbacks have an unconfirmed but presumably bounded
// serverless execution ceiling. Bail out of the processing loop with time
// to spare so the route always returns a response instead of getting
// killed mid-request (which is indistinguishable from a real failure to
// the scheduler and, worse, can leave a scheme half-written). Whatever
// doesn't fit this invocation just gets picked up next hour. Lowered from
// 40s to leave more headroom below that ceiling.
const BUDGET_MS = 25_000;

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return NextResponse.json({ error: "missing task token" }, { status: 401 });

  let payload: CronPayload = {};
  try {
    payload = (await req.json()) as CronPayload;
  } catch {
    /* no body is fine — use defaults */
  }
  const period = payload.period || currentPeriod();
  const limit = payload.limit ?? DEFAULT_LIMIT;

  // Discover every scheme across the 13 direct-fetch AMCs (M2), then process
  // only the not-yet-ingested ones, capped per invocation — the task fires
  // hourly at minimum (Task SDK floor) so the backlog drains over repeat
  // runs instead of one call trying to cover everything and timing out.
  let candidates: string[];
  if (payload.scheme_codes?.length) {
    candidates = payload.scheme_codes;
  } else {
    const discovered = await discoverAllDirectSchemes();
    candidates = discovered.map((d) => d.scheme_code);
  }

  const results: { scheme_code: string; amc: string; status: string }[] = [];
  let processed = 0;

  for (const schemeCode of candidates) {
    if (Date.now() - startedAt > BUDGET_MS) {
      results.push({ scheme_code: schemeCode, amc: "-", status: "deferred_budget" });
      continue;
    }
    if (processed >= limit) {
      results.push({ scheme_code: schemeCode, amc: "-", status: "deferred_limit" });
      continue;
    }
    let amcName = "unknown";
    try {
      const id = await getIdentity(schemeCode, token);
      amcName = id.fund_house;

      if (await alreadyIngested(amcName, schemeCode, period, token)) {
        results.push({ scheme_code: schemeCode, amc: amcName, status: "skipped_already_done" });
        continue;
      }

      const recipe = recipeFor(amcName);
      if (!recipe) {
        await logIngestRun({ amc_name: amcName, scheme_code: schemeCode, period, status: "not_published", error: "no direct-fetch recipe" }, token);
        results.push({ scheme_code: schemeCode, amc: amcName, status: "not_covered" });
        continue;
      }

      processed++; // counts against `limit` only once real fetch/parse work starts
      const resolved = await recipe.fetchPortfolio(period, id);
      if (!resolved) {
        await logIngestRun({ amc_name: amcName, scheme_code: schemeCode, period, status: "not_published" }, token);
        results.push({ scheme_code: schemeCode, amc: amcName, status: "not_published" });
        continue;
      }

      const nav = (await navOnOrBefore(schemeCode, resolved.asOfDate)) ?? id.latest_nav;
      const data = await parseWorkbook(resolved.buffer, id, period, resolved.asOfDate, resolved.sourceUrl, { nav });
      if (!data) {
        await logIngestRun({ amc_name: amcName, scheme_code: schemeCode, period, status: "parse_failed", source_url: resolved.sourceUrl }, token);
        results.push({ scheme_code: schemeCode, amc: amcName, status: "parse_failed" });
        continue;
      }

      await writeSnapshot(amcName, schemeCode, period, data, "fetch", token);
      await logIngestRun({ amc_name: amcName, scheme_code: schemeCode, period, status: "success", source_url: resolved.sourceUrl }, token);
      results.push({ scheme_code: schemeCode, amc: amcName, status: "success" });
    } catch (e) {
      await logIngestRun({ amc_name: amcName, scheme_code: schemeCode, period, status: "transient", error: e instanceof Error ? e.message : String(e) }, token);
      results.push({ scheme_code: schemeCode, amc: amcName, status: "transient" });
    }
  }

  return NextResponse.json({ period, covered_amcs: DIRECT_AMCS, results });
}
