import { NextRequest, NextResponse } from "next/server";
import { dbList } from "@/lib/db";
import type { AnalyseData, ScreenerRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SnapshotRow {
  scheme_code: string;
  period: string;
  data: AnalyseData;
}

// Cross-fund screener over the snapshots already in the corpus (grows as funds
// are analysed/uploaded). Uses the latest period per scheme.
export async function GET(req: NextRequest) {
  const token = req.headers.get("x-embed-token");
  if (!token) return NextResponse.json([]);
  let rows: SnapshotRow[];
  try {
    rows = await dbList<SnapshotRow>("snapshots", {}, token);
  } catch {
    return NextResponse.json([]);
  }
  const latest = new Map<string, SnapshotRow>();
  for (const r of rows) {
    const prev = latest.get(r.scheme_code);
    if (!prev || r.period > prev.period) latest.set(r.scheme_code, r);
  }
  const out: ScreenerRow[] = [];
  for (const [code, r] of latest) {
    const d = r.data;
    if (!d) continue;
    const top10 = d.top_holdings.slice(0, 10).reduce((s, h) => s + h.weight, 0);
    out.push({
      id: code,
      scheme_name: d.scheme_name,
      amc_name: d.amc_name,
      category: d.category,
      asset_class: d.asset_class,
      aum: d.aum ?? 0,
      nav: d.nav ?? 0,
      expense_ratio: d.expense_ratio ?? 0,
      holdings_count: d.holdings_count,
      deployable_cash: d.deployable_cash,
      top10_concentration: Math.round(top10 * 100) / 100,
    });
  }
  out.sort((a, b) => b.aum - a.aum);
  return NextResponse.json(out);
}
