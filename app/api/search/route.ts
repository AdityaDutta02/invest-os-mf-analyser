// M5: search over the full-searchability corpus (db-migrations.sql's
// amcs/schemes/holdings_index/securities tables, populated by
// /api/cron/ingest + /api/cron/ingest-staged). Same auth pattern as
// app/api/screen/route.ts — viewer embed token in x-embed-token, no
// server-side auth beyond that (app-wide read, not viewer-scoped data).
//
// Two query shapes, auto-detected:
//   - ISIN (exact 12-char SEBI code): who holds this security, and how much.
//   - free text: fuzzy match against security names and scheme/AMC names.
import { NextRequest, NextResponse } from "next/server";
import { dbList } from "@/lib/db";
import { ISIN_RE, fuzzyScore, getSecuritiesCached, getSchemesCached } from "@/lib/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HoldingsIndexRow {
  isin: string;
  scheme_code: string;
  period: string;
  weight: number | null;
}

interface SchemeRow {
  scheme_code: string;
  amc_name: string;
  scheme_name: string;
  isin: string | null;
  category: string;
  asset_class: string;
}

const MAX_NAME_MATCHES = 15;
const MAX_ISIN_HOLDERS = 50; // cap scheme-meta fan-out for a widely-held security

async function searchByIsin(isin: string, token: string) {
  const rows = await dbList<HoldingsIndexRow>("holdings_index", { isin }, token);

  // One row per scheme, latest period only — a security's weight in a fund
  // moves month to month, older periods aren't useful in a "who holds this
  // now" result.
  const latestByScheme = new Map<string, HoldingsIndexRow>();
  for (const r of rows) {
    const prev = latestByScheme.get(r.scheme_code);
    if (!prev || r.period > prev.period) latestByScheme.set(r.scheme_code, r);
  }
  const holders = [...latestByScheme.values()].slice(0, MAX_ISIN_HOLDERS);

  const [nameRows, schemeRows] = await Promise.all([
    dbList<{ isin: string; name: string }>("securities", { isin }, token),
    Promise.all(holders.map((h) => dbList<SchemeRow>("schemes", { scheme_code: h.scheme_code }, token).catch(() => []))),
  ]);
  const schemeByCode = new Map<string, SchemeRow>();
  for (const rows of schemeRows) for (const s of rows) schemeByCode.set(s.scheme_code, s);

  const holdings = holders
    .map((h) => {
      const s = schemeByCode.get(h.scheme_code);
      return {
        scheme_code: h.scheme_code,
        scheme_name: s?.scheme_name ?? h.scheme_code,
        amc_name: s?.amc_name ?? "",
        period: h.period,
        weight: h.weight,
      };
    })
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));

  return {
    type: "isin" as const,
    isin,
    security_name: nameRows[0]?.name ?? null,
    holder_count: latestByScheme.size,
    holdings,
  };
}

async function searchByName(q: string, token: string) {
  const [securities, schemes] = await Promise.all([getSecuritiesCached(token), getSchemesCached(token)]);

  const securityMatches = securities
    .map((s) => ({ ...s, score: fuzzyScore(q, s.name) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_NAME_MATCHES);

  const schemeMatches = schemes
    .map((s) => ({ ...s, score: Math.max(fuzzyScore(q, s.scheme_name), fuzzyScore(q, `${s.amc_name} ${s.scheme_name}`)) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_NAME_MATCHES);

  return {
    type: "name" as const,
    query: q,
    securities: securityMatches.map(({ isin, name, score }) => ({ isin, name, score })),
    schemes: schemeMatches.map(({ scheme_code, amc_name, scheme_name, category, asset_class, score }) => ({
      scheme_code,
      amc_name,
      scheme_name,
      category,
      asset_class,
      score,
    })),
  };
}

export async function GET(req: NextRequest) {
  const token = req.headers.get("x-embed-token");
  if (!token) return NextResponse.json({ error: "missing embed token" }, { status: 401 });

  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ type: "empty" });

  try {
    if (ISIN_RE.test(q)) return NextResponse.json(await searchByIsin(q.toUpperCase(), token));
    return NextResponse.json(await searchByName(q, token));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "search failed" }, { status: 500 });
  }
}
