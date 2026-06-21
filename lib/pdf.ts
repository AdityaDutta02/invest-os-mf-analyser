// PDF factsheet extraction. Primary path: the Terminal AI gateway's document
// parser (/parse) — it OCRs image pages, so it recovers numbers that live inside
// chart bitmaps (e.g. a factsheet's asset-class bar chart) which a pure text
// extractor can't see. Fallback: local unpdf (serverless pdf.js, no native deps)
// when the gateway parser is unavailable, so we never regress. Either way the
// resulting text/markdown is handed to the gateway LLM for STRICT-JSON structuring,
// and every number we surface is then derived deterministically (the model never
// computes our metrics).
import { extractText, getDocumentProxy } from "unpdf";
import { callGateway } from "./terminal-ai";
import { parseDocument, getParseResult } from "./parse-sdk";
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const dense = (s: string) => s.replace(/\s/g, "").length;

// Gateway document parser → Markdown. OCRs image pages, so chart/bitmap numbers
// survive. Returns "" if the parser is unavailable (caller falls back to unpdf).
// Rethrows INSUFFICIENT_CREDITS so the route can surface a 402.
async function gatewayParseText(buffer: ArrayBuffer, embedToken: string, filename: string): Promise<string> {
  let r = await parseDocument(embedToken, { file: Buffer.from(buffer), filename }, { aiCleanup: true });
  for (let i = 0; r.status === "processing" && i < 25; i++) {
    await sleep(2000);
    r = await getParseResult(embedToken, r.jobId);
  }
  return r.status === "done" ? r.markdown || "" : "";
}

// Local text extraction (no gateway, no OCR). Fallback only.
async function localParseText(buffer: ArrayBuffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const res = await extractText(pdf, { mergePages: true });
  return (Array.isArray(res.text) ? res.text.join("\n") : res.text) || "";
}

export async function extractPdf(
  buffer: ArrayBuffer,
  embedToken: string,
  hint: string,
  filename = "factsheet.pdf",
): Promise<{ ok: true; value: PdfExtraction } | { ok: false; reason: "scanned" | "ai_failed" }> {
  // 1) text/markdown — gateway parser first (OCR-capable), local unpdf as fallback
  let text = "";
  try {
    text = await gatewayParseText(buffer, embedToken, filename);
  } catch (e) {
    if ((e as { code?: string }).code === "INSUFFICIENT_CREDITS") throw e;
    // any other gateway-parse failure → fall through to local extraction
  }
  if (dense(text) < 200) {
    try {
      const local = await localParseText(buffer);
      if (dense(local) > dense(text)) text = local;
    } catch {
      /* local extraction failed too */
    }
  }
  if (dense(text) < 200) return { ok: false, reason: "scanned" }; // image-only / unreadable

  // 2) gateway structured extraction (string content — the reliable path)
  let content = "";
  try {
    const trimmed = text.slice(0, 60000); // keep well within context
    const r = await callGateway(
      [{ role: "user", content: `Scheme hint: ${hint || "(none)"}\n\nFactsheet content (Markdown/OCR — values inside charts may appear as plain text, treat them as printed):\n${trimmed}` }],
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

// Dev-only diagnostic: run both text paths against a buffer and report what each
// produced, so we can see (in the deployed env, with a real token) whether the
// gateway document parser is actually working and whether OCR recovered the
// chart-only numbers. Not used by the product flow.
export interface PdfDiagnostics {
  gateway: { ok: boolean; markdown_len: number; head: string; error?: string };
  local: { len: number; head: string; error?: string };
  chosen: "gateway" | "local" | "none";
  chart_numbers_present: { "51.79": boolean; "32.46": boolean }; // asset-class chart (image-only) probe
  structured: PdfExtraction | { error: string };
}

export async function diagnosePdf(buffer: ArrayBuffer, embedToken: string, filename = "factsheet.pdf"): Promise<PdfDiagnostics> {
  let gw = "";
  const gatewayInfo: PdfDiagnostics["gateway"] = { ok: false, markdown_len: 0, head: "" };
  try {
    gw = await gatewayParseText(buffer, embedToken, filename);
    gatewayInfo.ok = dense(gw) > 0;
    gatewayInfo.markdown_len = gw.length;
    gatewayInfo.head = gw.slice(0, 1500);
  } catch (e) {
    gatewayInfo.error = (e as Error).message + ((e as { code?: string }).code ? ` [${(e as { code?: string }).code}]` : "");
  }

  let local = "";
  const localInfo: PdfDiagnostics["local"] = { len: 0, head: "" };
  try {
    local = await localParseText(buffer);
    localInfo.len = local.length;
    localInfo.head = local.slice(0, 600);
  } catch (e) {
    localInfo.error = (e as Error).message;
  }

  const chosen: PdfDiagnostics["chosen"] = dense(gw) >= 200 ? "gateway" : dense(local) >= 200 ? "local" : "none";
  const text = chosen === "gateway" ? gw : local;

  let structured: PdfDiagnostics["structured"] = { error: "not run" };
  if (dense(text) >= 200) {
    try {
      const r = await callGateway(
        [{ role: "user", content: `Scheme hint: HDFC Liquid Fund\n\nFactsheet content (Markdown/OCR):\n${text.slice(0, 60000)}` }],
        embedToken,
        { category: "coding", tier: "quality", system: SYSTEM },
      );
      structured = parseExtraction(r.content) ?? { error: "structuring returned no parseable JSON" };
    } catch (e) {
      structured = { error: (e as Error).message };
    }
  }

  return {
    gateway: gatewayInfo,
    local: localInfo,
    chosen,
    chart_numbers_present: { "51.79": text.includes("51.79"), "32.46": text.includes("32.46") },
    structured,
  };
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
