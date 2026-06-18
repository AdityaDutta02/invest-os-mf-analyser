import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { dbInsert } from "@/lib/db";
import { assemble, buildFromRows, pickSheet, validate, periodLabel } from "@/lib/parse";
import type { SchemeIdentity } from "@/lib/mfapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function detectPeriod(rows: unknown[][]): { period: string; asOf: string } | null {
  const text = rows.slice(0, 12).flat().join(" ").toLowerCase();
  // "as on 31st may, 2026" / "as on 31-may-2026" / "31 may 2026"
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
  // "may 2026"
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
  for (const row of rows.slice(0, 10)) {
    for (const cell of row) {
      const s = String(cell ?? "").trim();
      if (/fund\b/i.test(s) && s.length < 90 && !/portfolio|disclosure|as on|monthly/i.test(s)) return s.replace(/\s+/g, " ");
    }
  }
  return fallback;
}

function hashCode(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
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

  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();

  if (name.endsWith(".pdf")) {
    return NextResponse.json(
      { error: "PDF factsheets aren't supported in this build yet — upload the SEBI monthly portfolio spreadsheet (.xls/.xlsx)." },
      { status: 415 },
    );
  }
  if (!/\.(xls|xlsx)$/.test(name)) {
    return NextResponse.json({ error: "Unsupported file type. Upload a .xls or .xlsx monthly portfolio." }, { status: 415 });
  }

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  } catch {
    return NextResponse.json({ error: "Could not read the spreadsheet." }, { status: 422 });
  }
  const sheet = pickSheet(wb);
  if (!sheet) return NextResponse.json({ error: "No recognisable holdings table found in the file." }, { status: 422 });

  const parsed = buildFromRows(sheet.rows);
  if (!parsed.ok || !validate(parsed.data).ok) {
    return NextResponse.json({ error: "The file parsed but failed validation (holdings/weights look off)." }, { status: 422 });
  }

  const detected = detectPeriod(sheet.rows);
  const period = detected?.period ?? "uploaded";
  const asOf = detected?.asOf ?? "";
  const schemeName = detectName(sheet.rows, file.name.replace(/\.(xls|xlsx)$/i, ""));
  const schemeCode = `upload-${hashCode(schemeName + period)}`;

  const id: SchemeIdentity = {
    scheme_code: schemeCode,
    scheme_name: schemeName,
    amc_name: "Uploaded factsheet",
    fund_house: "Uploaded factsheet",
    category: "",
    asset_class: "other",
    isin: "",
    latest_nav: null,
    latest_nav_date: null,
  };
  const data = assemble(parsed, id, period, asOf, "uploaded by user");

  if (token) {
    try {
      await dbInsert("snapshots", { scheme_code: schemeCode, period, source: "upload", data }, token);
    } catch {
      /* best-effort persistence */
    }
  }

  return NextResponse.json({
    scheme_id: schemeCode,
    scheme_name: schemeName,
    period,
    period_label: period === "uploaded" ? "Uploaded" : periodLabel(period),
    holdings_count: data.holdings_count,
  });
}
