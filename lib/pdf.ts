// PDF factsheet extraction. We extract text locally (unpdf — serverless pdf.js,
// no native deps) and let the Terminal AI gateway (Claude) turn that text into
// structured holdings. Every number we surface is then derived deterministically
// from those holdings (the model never computes our metrics).
import { extractText, getDocumentProxy } from "unpdf";
import { callGateway } from "./terminal-ai";
import type { HoldingInput } from "./parse";

export interface PdfExtraction {
  scheme_name: string | null;
  amc_name: string | null;
  period: string | null; // YYYY-MM
  as_of_date: string | null; // YYYY-MM-DD
  aum_cr: number | null;
  expense_ratio: number | null;
  holdings: HoldingInput[];
  partial: boolean;
}

const SYSTEM = `You extract structured data from Indian mutual fund factsheet / monthly portfolio text.
Return STRICT JSON only (no markdown), matching exactly:
{"scheme_name":string|null,"amc_name":string|null,"period":"YYYY-MM"|null,"as_of_date":"YYYY-MM-DD"|null,"aum_cr":number|null,"expense_ratio":number|null,"partial":boolean,"holdings":[{"name":string,"isin":string|null,"industry":string|null,"weight":number,"market_value_cr":number|null,"quantity":number|null}]}
RULES:
- Use ONLY values present in the text. Never invent numbers or ISINs. Missing field => null.
- weight = the holding's % of portfolio/NAV as a number (7.84 means 7.84%).
- Include EVERY holding row you can read. If only top/summary holdings are shown (a marketing factsheet), set "partial": true.
- industry = sector/rating column if present.
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
      }));
    if (holdings.length === 0) return null;
    return {
      scheme_name: typeof o.scheme_name === "string" ? o.scheme_name : null,
      amc_name: typeof o.amc_name === "string" ? o.amc_name : null,
      period: typeof o.period === "string" ? o.period : null,
      as_of_date: typeof o.as_of_date === "string" ? o.as_of_date : null,
      aum_cr: NUM(o.aum_cr),
      expense_ratio: NUM(o.expense_ratio),
      holdings,
      partial: Boolean(o.partial),
    };
  } catch {
    return null;
  }
}
