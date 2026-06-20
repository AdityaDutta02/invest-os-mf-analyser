// PDF factsheet extraction. We extract text locally (unpdf — serverless pdf.js,
// no native deps) and let the Terminal AI gateway (Claude) turn that text into
// structured holdings. Every number we surface is then derived deterministically
// from those holdings (the model never computes our metrics).
import { extractText, getDocumentProxy } from "unpdf";
import { callGateway } from "./terminal-ai";
import type { HoldingInput } from "./parse";
import type { WeightItem, PortfolioMetrics } from "./types";

export interface PdfExtraction {
  scheme_name: string | null;
  amc_name: string | null;
  period: string | null; // YYYY-MM
  as_of_date: string | null; // YYYY-MM-DD
  aum_cr: number | null;
  expense_ratio: number | null;
  holdings: HoldingInput[];
  partial: boolean;
  metrics: PortfolioMetrics;
  // Portfolio-wide breakdown by credit-rating class (Sovereign / AAA-A1+ / …)
  // — the one allocation table usually machine-readable in factsheet text.
  rating_breakdown: WeightItem[];
}

const SYSTEM = `You extract structured data from Indian mutual fund factsheet / monthly portfolio text.
Return STRICT JSON only (no markdown), matching exactly:
{"scheme_name":string|null,"amc_name":string|null,"period":"YYYY-MM"|null,"as_of_date":"YYYY-MM-DD"|null,"aum_cr":number|null,"expense_ratio":number|null,"ytm":number|null,"macaulay_days":number|null,"residual_days":number|null,"benchmark":string|null,"inception":string|null,"fund_managers":string|null,"rating_breakdown":[{"name":string,"weight":number}],"partial":boolean,"holdings":[{"name":string,"isin":string|null,"industry":string|null,"weight":number,"market_value_cr":number|null,"quantity":number|null,"type":string|null}]}
RULES:
- Use ONLY values present in the text. Never invent numbers or ISINs. Missing field => null (empty array [] for rating_breakdown).
- weight = the holding's % of portfolio/NAV as a number (7.84 means 7.84%).
- "type" = the instrument type, classified from context (e.g. a Liquid/Debt fund's bank/NBFC papers are money-market). One of EXACTLY: equity, foreign_equity, gsec, tbill, cp, cd, corporate_debt, treps, cash, reit, fund, arbitrage. A bank/NBFC name with a credit rating in a liquid/debt fund is usually "cd" (Certificate of Deposit) or "cp" (Commercial Paper); treasury bills => "tbill"; TREPS/repo => "treps".
- "industry" = the sector (for equities) or the credit rating (for debt) as printed.
- "as_of_date" = the PORTFOLIO date (e.g. "as on April 30, 2026"), NOT the document/publication month. "period" = that same portfolio month as YYYY-MM (April 30 2026 => "2026-04"), even if the sheet header says a later month.
- "ytm" = annualised portfolio YTM as a number (6.24 means 6.24%). "macaulay_days"/"residual_days" = duration / average residual maturity in DAYS (convert years×365 if printed in years). "benchmark", "inception", "fund_managers" = copy the printed text.
- "rating_breakdown" = the "Portfolio Classification by Rating Class" (or asset-class) table as printed: each {name, weight}. Keep negative weights (e.g. Cash -6.65) as-is. [] if absent.
- Include EVERY holding row you can read. If only top/summary holdings are shown (a marketing/"Top 10" factsheet), set "partial": true.
- If multiple schemes appear, extract the one best matching the hint. aum_cr in ₹ crore (convert lakhs ÷100).`;

const NUM = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : null;
};

export async function extractPdf(
  buffer: ArrayBuffer,
  embedToken: string,
  hint: string,
): Promise<{ ok: true; value: PdfExtraction } | { ok: false; reason: "scanned" | "ai_failed" }> {
  // 1) local text extraction
  let text = "";
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const res = await extractText(pdf, { mergePages: true });
    text = (Array.isArray(res.text) ? res.text.join("\n") : res.text) || "";
  } catch {
    return { ok: false, reason: "scanned" };
  }
  if (text.replace(/\s/g, "").length < 200) return { ok: false, reason: "scanned" }; // image-only PDF

  // 2) gateway structured extraction (string content — the reliable path)
  let content = "";
  try {
    const trimmed = text.slice(0, 60000); // keep well within context
    const r = await callGateway(
      [{ role: "user", content: `Scheme hint: ${hint || "(none)"}\n\nFactsheet text:\n${trimmed}` }],
      embedToken,
      { category: "coding", tier: "quality", system: SYSTEM },
    );
    content = r.content;
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "INSUFFICIENT_CREDITS") throw e; // surfaced as 402 upstream
    return { ok: false, reason: "ai_failed" };
  }

  const value = parseExtraction(content);
  if (!value) return { ok: false, reason: "ai_failed" };
  return { ok: true, value };
}

function parseExtraction(text: string): PdfExtraction | null {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    const o = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
    const rawH = Array.isArray(o.holdings) ? (o.holdings as Record<string, unknown>[]) : [];
    const holdings: HoldingInput[] = rawH
      .filter((h) => h && typeof h.name === "string" && NUM(h.weight) != null)
      .map((h) => ({
        name: String(h.name),
        isin: h.isin ? String(h.isin) : "",
        industry: h.industry ? String(h.industry) : "",
        weight: NUM(h.weight) ?? 0,
        market_value_cr: NUM(h.market_value_cr) ?? 0,
        quantity: NUM(h.quantity) ?? 0,
        type: h.type ? String(h.type) : undefined,
      }));
    if (holdings.length === 0) return null;
    const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
    const rawR = Array.isArray(o.rating_breakdown) ? (o.rating_breakdown as Record<string, unknown>[]) : [];
    const rating_breakdown: WeightItem[] = rawR
      .filter((r) => r && typeof r.name === "string" && NUM(r.weight) != null)
      .map((r) => ({ name: String(r.name).trim(), weight: NUM(r.weight) ?? 0 }));
    return {
      scheme_name: str(o.scheme_name),
      amc_name: str(o.amc_name),
      period: str(o.period),
      as_of_date: str(o.as_of_date),
      aum_cr: NUM(o.aum_cr),
      expense_ratio: NUM(o.expense_ratio),
      holdings,
      partial: Boolean(o.partial),
      metrics: {
        ytm: NUM(o.ytm),
        macaulay_days: NUM(o.macaulay_days),
        residual_days: NUM(o.residual_days),
        benchmark: str(o.benchmark),
        inception: str(o.inception),
        fund_managers: str(o.fund_managers),
      },
      rating_breakdown,
    };
  } catch {
    return null;
  }
}
