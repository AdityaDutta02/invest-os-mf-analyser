import { NextRequest, NextResponse } from "next/server";
import { getSnapshot } from "@/lib/snapshot";
import type { AnalyseData, ChangeRow, CompareData, WeightItem } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const round2 = (n: number) => Math.round(n * 100) / 100;
const equityPct = (d: AnalyseData) =>
  d.asset_allocation.filter((a) => /equity/i.test(a.name)).reduce((s, a) => s + a.weight, 0);

function diffHoldings(a: AnalyseData, b: AnalyseData) {
  const keyOf = (h: { isin: string; name: string }) => (h.isin && h.isin !== "—" ? h.isin : h.name.toLowerCase());
  const mapA = new Map(a.holdings.map((h) => [keyOf(h), h]));
  const mapB = new Map(b.holdings.map((h) => [keyOf(h), h]));
  const added: ChangeRow[] = [];
  const exited: ChangeRow[] = [];
  const increased: ChangeRow[] = [];
  const reduced: ChangeRow[] = [];
  for (const [k, hb] of mapB) {
    const ha = mapA.get(k);
    if (!ha) {
      added.push({ name: hb.name, isin: hb.isin, weight_a: 0, weight_b: hb.weight, delta: round2(hb.weight) });
    } else {
      const delta = round2(hb.weight - ha.weight);
      if (delta > 0.01) increased.push({ name: hb.name, isin: hb.isin, weight_a: ha.weight, weight_b: hb.weight, delta });
      else if (delta < -0.01) reduced.push({ name: hb.name, isin: hb.isin, weight_a: ha.weight, weight_b: hb.weight, delta });
    }
  }
  for (const [k, ha] of mapA) {
    if (!mapB.has(k)) exited.push({ name: ha.name, isin: ha.isin, weight_a: ha.weight, weight_b: 0, delta: round2(-ha.weight) });
  }
  const byAbs = (x: ChangeRow, y: ChangeRow) => Math.abs(y.delta) - Math.abs(x.delta);
  return {
    added: added.sort(byAbs),
    exited: exited.sort(byAbs),
    increased: increased.sort(byAbs),
    reduced: reduced.sort(byAbs),
  };
}

function categoryDrift(a: AnalyseData, b: AnalyseData): WeightItem[] {
  const wa = new Map(a.category_breakdown.map((c) => [c.name, c.weight]));
  const names = new Set([...a.category_breakdown, ...b.category_breakdown].map((c) => c.name));
  const out: WeightItem[] = [];
  for (const name of names) {
    const delta = round2((b.category_breakdown.find((c) => c.name === name)?.weight ?? 0) - (wa.get(name) ?? 0));
    if (Math.abs(delta) >= 0.05) out.push({ name, weight: delta });
  }
  return out.sort((x, y) => Math.abs(y.weight) - Math.abs(x.weight));
}

export async function GET(req: NextRequest) {
  const scheme = req.nextUrl.searchParams.get("scheme") ?? "";
  const aP = req.nextUrl.searchParams.get("a") ?? "";
  const bP = req.nextUrl.searchParams.get("b") ?? "";
  const token = req.headers.get("x-embed-token");
  if (!scheme || !aP || !bP) return NextResponse.json({ error: "scheme, a and b are required" }, { status: 400 });

  try {
    const [a, b] = await Promise.all([getSnapshot(scheme, aP, token), getSnapshot(scheme, bP, token)]);
    if (!a || !b) {
      return NextResponse.json({ error: "One or both months have no stored portfolio." }, { status: 404 });
    }
    const payload: CompareData = {
      a,
      b,
      kpis: {
        cash_delta: round2(b.deployable_cash - a.deployable_cash),
        count_delta: b.holdings_count - a.holdings_count,
        equity_delta: round2(equityPct(b) - equityPct(a)),
        aum_delta: a.aum != null && b.aum != null ? round2(b.aum - a.aum) : null,
      },
      changes: diffHoldings(a, b),
      category_drift: categoryDrift(a, b),
    };
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
