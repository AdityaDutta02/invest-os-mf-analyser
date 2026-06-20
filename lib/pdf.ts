// PDF factsheet extraction via the Terminal AI gateway. Claude reads the PDF
// natively (multimodal message); we then derive every number deterministically
// from the holdings it returns (the model never computes our metrics).
import type { HoldingInput } from "./parse";

const GATEWAY_URL = process.env.TERMINAL_AI_GATEWAY_URL!;

export interface PdfExtraction {
  scheme_name: string | null;
  amc_name: string | null;
  period: string | null; // YYYY-MM
  as_of_date: string | null; // YYYY-MM-DD
  aum_cr: number | null;
  expense_ratio: number | null;
  holdings: HoldingInput[];
  partial: boolean; // true if only top/summary holdings were disclosed
}

const PROMPT = `You are extracting structured data from an Indian mutual fund monthly factsheet / portfolio PDF.
Return STRICT JSON only (no markdown), matching exactly:
{
  "scheme_name": string|null,
  "amc_name": string|null,
  "period": "YYYY-MM"|null,
  "as_of_date": "YYYY-MM-DD"|null,
  "aum_cr": number|null,
  "expense_ratio": number|null,
  "partial": boolean,
  "holdings": [ { "name": string, "isin": string|null, "industry": string|null, "weight": number, "market_value_cr": number|null, "quantity": number|null } ]
}
RULES:
- Use ONLY values printed in the document. Never invent numbers or ISINs. If a field is absent, use null.
- "weight" is the holding's % of the portfolio/NAV as a number (e.g. 7.84 for 7.84%).
- Include EVERY holding row you can read. If the document only shows top/summary holdings (a marketing factsheet), set "partial": true and include those.
- "industry" = the sector/rating column if present.
- If the document covers multiple schemes, extract the one that best matches: "{HINT}". If no hint, pick the first scheme.
- aum_cr in ₹ crore; convert if the document uses lakhs (÷100) or absolute (÷1e7).`;

interface GatewayMsgContent {
  type: string;
  text?: string;
  file?: { filename: string; file_data: string };
}

export async function extractPdf(
  buffer: ArrayBuffer,
  embedToken: string,
  hint: string,
): Promise<PdfExtraction | null> {
  const b64 = Buffer.from(buffer).toString("base64");
  const content: GatewayMsgContent[] = [
    { type: "text", text: PROMPT.replace("{HINT}", hint || "(none)") },
    { type: "file", file: { filename: "factsheet.pdf", file_data: `data:application/pdf;base64,${b64}` } },
  ];

  const res = await fetch(`${GATEWAY_URL}/v1/generate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${embedToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "anthropic/claude-sonnet-4-6", messages: [{ role: "user", content }] }),
  });
  if (res.status === 402) {
    const body = (await res.json().catch(() => ({}))) as { redirect?: string };
    throw Object.assign(new Error("Insufficient credits to read the PDF."), {
      code: "INSUFFICIENT_CREDITS",
      redirect: body.redirect ?? "/pricing",
    });
  }
  if (!res.ok) return null;
  const out = (await res.json()) as { content?: string };
  return parseExtraction(out.content ?? "");
}

function parseExtraction(text: string): PdfExtraction | null {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    const o = JSON.parse(t.slice(start, end + 1)) as Partial<PdfExtraction> & { holdings?: unknown[] };
    const holdings: HoldingInput[] = Array.isArray(o.holdings)
      ? (o.holdings as Record<string, unknown>[])
          .filter((h) => h && typeof h.name === "string" && (typeof h.weight === "number" || typeof h.weight === "string"))
          .map((h) => ({
            name: String(h.name),
            isin: h.isin ? String(h.isin) : "",
            industry: h.industry ? String(h.industry) : "",
            weight: Number(h.weight) || 0,
            market_value_cr: h.market_value_cr != null ? Number(h.market_value_cr) : 0,
            quantity: h.quantity != null ? Number(h.quantity) : 0,
          }))
      : [];
    if (holdings.length === 0) return null;
    return {
      scheme_name: o.scheme_name ?? null,
      amc_name: o.amc_name ?? null,
      period: o.period ?? null,
      as_of_date: o.as_of_date ?? null,
      aum_cr: o.aum_cr != null ? Number(o.aum_cr) : null,
      expense_ratio: o.expense_ratio != null ? Number(o.expense_ratio) : null,
      holdings,
      partial: Boolean(o.partial),
    };
  } catch {
    return null;
  }
}
