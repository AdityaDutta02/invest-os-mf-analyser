import { NextRequest, NextResponse } from "next/server";
import { dbList } from "@/lib/db";
import type { ScreenerRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SchemeLatestRow {
  scheme_code: string;
  scheme_name: string;
  amc_name: string;
  category: string;
  asset_class: ScreenerRow["asset_class"];
  aum: number | null;
  nav: number | null;
  expense_ratio: number | null;
  holdings_count: number;
  deployable_cash: number;
  top10_concentration: number;
}

// Cross-fund screener. Reads the pre-computed scheme_latest dimension
// (maintained by lib/ingest-write.ts's writeSnapshot on every ingest) instead
// of a full-table dbList("snapshots") scan + client-side latest-period
// reduction — that scan reads every historical JSONB row ever written and
// dies at corpus scale (100k+ rows: multi-GB payload / silent truncation).
export async function GET(req: NextRequest) {
  const token = req.headers.get("x-embed-token");
  if (!token) return NextResponse.json([]);
  let rows: SchemeLatestRow[];
  try {
    rows = await dbList<SchemeLatestRow>("scheme_latest", {}, token);
  } catch {
    return NextResponse.json([]);
  }
  const out: ScreenerRow[] = rows.map((r) => ({
    id: r.scheme_code,
    scheme_name: r.scheme_name,
    amc_name: r.amc_name,
    category: r.category,
    asset_class: r.asset_class,
    aum: r.aum ?? 0,
    nav: r.nav ?? 0,
    expense_ratio: r.expense_ratio ?? 0,
    holdings_count: r.holdings_count,
    deployable_cash: r.deployable_cash,
    top10_concentration: r.top10_concentration,
  }));
  out.sort((a, b) => b.aum - a.aum);
  return NextResponse.json(out);
}
