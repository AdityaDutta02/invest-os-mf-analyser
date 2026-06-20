import { NextRequest, NextResponse } from "next/server";
import { callGateway } from "@/lib/terminal-ai";
import { dbInsert, dbList } from "@/lib/db";
import { getSnapshot } from "@/lib/snapshot";
import type { AIInsight, AnalyseData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AiCacheRow {
  scheme_code: string;
  period: string;
  insight: AIInsight;
}

const SYSTEM = `You are a buy-side research analyst writing a concise, factual interpretation of a single mutual-fund monthly portfolio.
RULES:
- Be descriptive and analytical, NEVER advisory. Do not recommend buying, selling, holding, or rate the fund.
- Use ONLY the numbers provided in the input JSON. Never invent or estimate figures not present.
- Interpret what the disclosed allocation, concentration, cash level and sector tilts imply about the portfolio's posture.
- Output STRICT JSON only (no markdown, no prose outside JSON) matching exactly:
{"headline": string, "sections": [{"title": string, "bullets": [string, ...]}], "flags": [string, ...]}
- 1 headline sentence; 2-3 sections (e.g. "Portfolio posture", "Notable positioning", "Concentration & cash"); 2-4 bullets each; 1-3 flags noting risks visible in the data (e.g. elevated cash, single-name concentration). Keep it grounded and specific to the numbers.`;

function compact(d: AnalyseData) {
  return {
    scheme_name: d.scheme_name,
    category: d.category,
    asset_class: d.asset_class,
    aum_cr: d.aum,
    nav: d.nav,
    expense_ratio: d.expense_ratio,
    holdings_count: d.holdings_count,
    deployable_cash_pct: d.deployable_cash,
    total_weight: d.total_weight,
    asset_allocation: d.asset_allocation,
    sector_or_instrument_breakdown: d.category_breakdown.slice(0, 8),
    market_cap_breakdown: d.market_cap_breakdown,
    cash_breakdown: d.cash_breakdown,
    top_holdings: d.top_holdings,
  };
}

function parseInsight(content: string): AIInsight | null {
  let txt = content.trim();
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) txt = fence[1].trim();
  const start = txt.indexOf("{");
  const end = txt.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    const obj = JSON.parse(txt.slice(start, end + 1)) as Partial<AIInsight>;
    if (!obj.headline || !Array.isArray(obj.sections)) return null;
    return {
      generated_at: new Date().toISOString(),
      headline: String(obj.headline),
      sections: obj.sections.map((s) => ({ title: String(s.title), bullets: (s.bullets ?? []).map(String) })),
      flags: Array.isArray(obj.flags) ? obj.flags.map(String) : [],
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-embed-token");
  const body = (await req.json().catch(() => ({}))) as { scheme?: string; period?: string };
  const scheme = body.scheme ?? "";
  const period = body.period ?? "";
  if (!token || !scheme || !period) {
    return NextResponse.json({ error: "missing token/scheme/period" }, { status: 400 });
  }

  // cache hit?
  try {
    const cached = await dbList<AiCacheRow>("ai_cache", { scheme_code: scheme, period }, token);
    const hit = cached.find((c) => c.period === period);
    if (hit?.insight?.headline) return NextResponse.json(hit.insight);
  } catch {
    /* ignore */
  }

  const snap = await getSnapshot(scheme, period, token);
  if (!snap.ok) return NextResponse.json({ error: "no snapshot" }, { status: 404 });
  const data = snap.data;

  try {
    const result = await callGateway(
      [{ role: "user", content: `Interpret this monthly portfolio. Input JSON:\n${JSON.stringify(compact(data))}` }],
      token,
      { category: "chat", tier: "good", system: SYSTEM },
    );
    const insight = parseInsight(result.content);
    if (!insight) return NextResponse.json({ error: "could not parse interpretation" }, { status: 502 });
    try {
      await dbInsert("ai_cache", { scheme_code: scheme, period, insight }, token);
    } catch {
      /* best-effort cache */
    }
    return NextResponse.json(insight);
  } catch (e) {
    const err = e as Error & { code?: string; redirect?: string };
    if (err.code === "INSUFFICIENT_CREDITS") {
      return NextResponse.json({ error: err.message, code: "INSUFFICIENT_CREDITS", redirect: err.redirect }, { status: 402 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
