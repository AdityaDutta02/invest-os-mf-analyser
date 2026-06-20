// lib/parse-sdk.ts — Terminal AI Document Parsing SDK (server-side only)
// Converts a PDF (including scanned/image-only PDFs) into Markdown + structured JSON via the
// gateway /parse route. Deterministic extraction is free-tier; OCR runs automatically on image
// pages; an optional AI pass cleans up structure. Small PDFs return inline; large/scanned ones
// return a jobId to poll with getParseResult().
const GATEWAY_URL = process.env.TERMINAL_AI_GATEWAY_URL!;

export interface ParseDone {
  status: "done";
  jobId: string;
  markdown: string;
  json: { pageCount: number; pages: Array<{ pageNum: number; textItems: number; chars: number }> };
  pages: unknown;
  credits_charged?: number;
}
export interface ParseProcessing {
  status: "processing";
  jobId: string;
}

/**
 * Parse a PDF. Pass either an uploaded file (Buffer) or the storage key of a PDF already uploaded
 * via the storage SDK. Returns the result inline when it finishes quickly, otherwise a
 * { status: 'processing', jobId } you poll with getParseResult().
 */
export async function parseDocument(
  embedToken: string,
  input: { file: Buffer; filename?: string } | { key: string },
  opts: { aiCleanup?: boolean; ocr?: boolean } = {},
): Promise<ParseDone | ParseProcessing> {
  let res: Response;
  if ("file" in input) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(input.file)], { type: "application/pdf" }), input.filename ?? "document.pdf");
    if (opts.aiCleanup) form.append("aiCleanup", "true");
    if (opts.ocr === false) form.append("ocr", "false");
    res = await fetch(`${GATEWAY_URL}/parse`, { method: "POST", headers: { Authorization: `Bearer ${embedToken}` }, body: form });
  } else {
    res = await fetch(`${GATEWAY_URL}/parse`, {
      method: "POST",
      headers: { Authorization: `Bearer ${embedToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ key: input.key, aiCleanup: opts.aiCleanup, ocr: opts.ocr }),
    });
  }
  if (res.status === 402) {
    const body = (await res.json().catch(() => ({}))) as { redirect?: string };
    throw Object.assign(new Error("Insufficient credits"), { code: "INSUFFICIENT_CREDITS", redirect: body.redirect ?? "/pricing" });
  }
  if (!res.ok && res.status !== 202) throw new Error(`Parse failed: ${res.status}`);
  return res.json() as Promise<ParseDone | ParseProcessing>;
}

/** Fetch the status/result of a parse job (poll until status === 'done'). */
export async function getParseResult(embedToken: string, jobId: string): Promise<ParseDone | ParseProcessing> {
  const res = await fetch(`${GATEWAY_URL}/parse/${jobId}`, { headers: { Authorization: `Bearer ${embedToken}` } });
  if (res.status === 402) {
    const body = (await res.json().catch(() => ({}))) as { redirect?: string };
    throw Object.assign(new Error("Insufficient credits"), { code: "INSUFFICIENT_CREDITS", redirect: body.redirect ?? "/pricing" });
  }
  if (!res.ok && res.status !== 202) throw new Error(`Parse status failed: ${res.status}`);
  return res.json() as Promise<ParseDone | ParseProcessing>;
}
