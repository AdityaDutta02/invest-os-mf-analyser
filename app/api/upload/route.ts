import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { dbInsert } from "@/lib/db";
import { assemble, buildFromHoldings, buildFromRows, pickSheet, validate, periodLabel } from "@/lib/parse";
import { getIdentity } from "@/lib/identity";
import { navOnOrBefore, type SchemeIdentity } from "@/lib/mfapi";
import { extractPdf } from "@/lib/pdf";
import type { ParseResult } from "@/lib/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function detectPeriod(rows: unknown[][]): { period: string; asOf: string } | null {
  const text = rows.slice(0, 14).flat().join(" ").toLowerCase();
  const m = text.match(/(\d{1,2})\s*(?:st|nd|rd|th)?[\s,\-]+([a-z]+)[\s,\-]+(\d{4})/);
  if (m) {
    const day = Number(m[1]);
    const mon = MONTHS.findIndex((x) => x.startsWith(m[2].slice(0, 3)));
    const year = Number(m[3]);
    if (mon >= 0) {
      const period = `${year}-${String(mon + 1).padStart(2, "0")}`;
      return { period, asOf: `${period}-${String(day).padStart(2, "0")}` };
    }
  }
  const m2 = text.match(/\b([a-z]+)[\s,\-]+(\d{4})\b/);
  if (m2) {
    const mon = MONTHS.findIndex((x) => x.startsWith(m2[1].slice(0, 3)));
    const year = Number(m2[2]);
    if (mon >= 0) {
      const last = new Date(year, mon + 1, 0).getDate();
      const period = `${year}-${String(mon + 1).padStart(2, "0")}`;
      return { period, asOf: `${period}-${last}` };
    }
  }
  return null;
}

function detectName(rows: unknown[][], fallback: string): string {
  for (const row of rows.slice(0, 12)) {
    for (const cell of row) {
      const s = String(cell ?? "").trim();
      if (/fund\b/i.test(s) && s.length < 90 && !/portfolio|disclosure|as on|monthly|report/i.test(s)) return s.replace(/\s+/g, " ");
    }
  }
  return fallback;
}

function tokens(name: string): Set<string> {
  return new Set(
    (name || "")
      .toLowerCase()
      .replace(/\b(fund|plan|growth|direct|regular|the|scheme|mutual)\b/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3),
  );
}
function overlaps(a: string, b: string): boolean {
  const ta = tokens(a), tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return true; // can't tell → don't flag
  for (const t of ta) if (tb.has(t)) return true;
  return false;
}

function hashCode(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function synthIdentity(code: string, name: string, amc: string): SchemeIdentity {
  return {
    scheme_code: code,
    scheme_name: name,
    amc_name: amc,
    fund_house: amc,
    category: "",
    asset_class: "other",
    isin: "",
    latest_nav: null,
    latest_nav_date: null,
    inception_date: null,
  };
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-embed-token");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart form data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no file provided" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 25 MB)." }, { status: 413 });

  const selectedCode = (form.get("scheme") as string) || "";
  const selectedPeriod = (form.get("period") as string) || "";
  const selectedNameForm = (form.get("schemeName") as string) || "";

  // Resolve the selected fund (for sheet-hint + attribution), best-effort.
  let selectedId: SchemeIdentity | null = null;
  if (selectedCode && !selectedCode.startsWith("upload-")) {
    try {
      selectedId = await getIdentity(selectedCode, token);
    } catch {
      /* ignore */
    }
  }
  const hintName = selectedId?.scheme_name || selectedNameForm;

  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();

  let parsed: ParseResult;
  let detectedName: string;
  let detectedPeriod: string | null = null;
  let asOf = "";
  let source: "upload" | "pdf" = "upload";
  let expenseRatio: number | null = null;
  let partial = false;
  let metrics: import("@/lib/types").PortfolioMetrics | undefined;
  let ratingBreakdown: import("@/lib/types").WeightItem[] = [];

  if (name.endsWith(".pdf")) {
    if (!token) return NextResponse.json({ error: "Sign-in required to read PDFs." }, { status: 401 });
    source = "pdf";
    let ex;
    try {
      ex = await extractPdf(buf, token, hintName, file.name);
    } catch (e) {
      const err = e as Error & { code?: string; redirect?: string };
      if (err.code === "INSUFFICIENT_CREDITS")
        return NextResponse.json({ error: err.message, code: "INSUFFICIENT_CREDITS", redirect: err.redirect }, { status: 402 });
      return NextResponse.json({ error: "Couldn't read this PDF. Try the SEBI portfolio spreadsheet instead." }, { status: 422 });
    }
    if (!ex.ok) {
      const msg =
        ex.reason === "scanned"
          ? "Couldn't read text from this PDF (it looks scanned/image-only). Try the spreadsheet."
          : "Read the PDF but couldn't extract the holdings. Try the SEBI portfolio spreadsheet.";
      return NextResponse.json({ error: msg }, { status: 422 });
    }
    const v = ex.value;
    parsed = buildFromHoldings(v.holdings, v.aum_cr);
    if (!parsed.ok || !validate(parsed.data, { lenient: true }).ok)
      return NextResponse.json({ error: "Read the PDF but couldn't make sense of the holdings." }, { status: 422 });
    detectedName = v.scheme_name || file.name.replace(/\.pdf$/i, "");
    asOf = v.as_of_date || "";
    // Period = the PORTFOLIO month. Prefer the as-on date (factsheets are titled a
    // month later than the holdings they disclose), falling back to the AI's period.
    detectedPeriod = (asOf && /^\d{4}-\d{2}/.test(asOf) ? asOf.slice(0, 7) : null) || v.period;
    if (!asOf && detectedPeriod) asOf = `${detectedPeriod}-28`;
    expenseRatio = v.expense_ratio;
    partial = v.partial;
    metrics = v.metrics;
    ratingBreakdown = v.rating_breakdown ?? [];
  } else if (/\.(xls|xlsx)$/.test(name)) {
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(new Uint8Array(buf), { type: "array" });
    } catch {
      return NextResponse.json({ error: "Could not read the spreadsheet (it may be corrupt or password-protected)." }, { status: 422 });
    }
    const sheet = pickSheet(wb, hintName);
    if (!sheet) return NextResponse.json({ error: "No recognisable holdings table found in this file." }, { status: 422 });
    parsed = buildFromRows(sheet.rows);
    if (!parsed.ok || !validate(parsed.data).ok)
      return NextResponse.json({ error: "The file parsed but failed validation (holdings/weights look off)." }, { status: 422 });
    const det = detectPeriod(sheet.rows);
    detectedPeriod = det?.period ?? null;
    asOf = det?.asOf ?? "";
    detectedName = detectName(sheet.rows, file.name.replace(/\.(xls|xlsx)$/i, ""));
  } else {
    return NextResponse.json({ error: "Unsupported file. Upload a .pdf, .xls or .xlsx." }, { status: 415 });
  }

  // ── reconciliation ───────────────────────────────────────
  const period = detectedPeriod || selectedPeriod || "uploaded";
  const nameMismatch = !!selectedId && !!detectedName && !overlaps(detectedName, selectedId.scheme_name);
  const periodMismatch = !!detectedPeriod && !!selectedPeriod && detectedPeriod !== selectedPeriod;
  const mismatch = nameMismatch || periodMismatch;

  // Trust the file. Attribute to the selected fund only when it agrees; otherwise
  // store under a synthetic code for the detected fund so we never mislabel data.
  let storeCode: string;
  let identity: SchemeIdentity;
  if (selectedId && !nameMismatch) {
    storeCode = selectedCode;
    identity = selectedId;
  } else {
    storeCode = `upload-${hashCode((detectedName || file.name) + period)}`;
    identity = synthIdentity(storeCode, detectedName, source === "pdf" ? "Uploaded factsheet (AI-extracted)" : "Uploaded factsheet");
  }

  const nav = selectedId && !nameMismatch && asOf ? (await navOnOrBefore(selectedCode, asOf)) ?? identity.latest_nav : identity.latest_nav;
  const sourceLabel = source === "pdf" ? "AI-extracted from uploaded PDF" : "Uploaded portfolio file";
  const data = assemble(parsed, identity, period, asOf, sourceLabel, {
    nav,
    aum: parsed.aum,
    expenseRatio,
    partial,
    ratingBreakdown,
    metrics,
  });

  if (token) {
    try {
      await dbInsert("snapshots", { scheme_code: storeCode, period, source, data }, token);
    } catch {
      /* best-effort persistence */
    }
  }

  return NextResponse.json({
    scheme_id: storeCode,
    scheme_name: data.scheme_name,
    amc_name: data.amc_name,
    category: data.category,
    asset_class: data.asset_class,
    nav: data.nav,
    period,
    period_label: period === "uploaded" ? "Uploaded" : periodLabel(period),
    holdings_count: data.holdings_count,
    source,
    partial,
    mismatch: mismatch
      ? {
          detected_name: detectedName,
          detected_period: detectedPeriod,
          selected_name: selectedId?.scheme_name ?? null,
          selected_period: selectedPeriod || null,
        }
      : null,
    data,
  });
}
