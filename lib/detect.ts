// Shared spreadsheet-content sniffing: period/name detection + synthetic
// identity for schemes not resolved against mfapi. Extracted from
// app/api/upload/route.ts so the staged-worker ingest path (scraped files,
// which don't come with a known mfapi scheme_code) can reuse the exact same
// detection logic instead of re-parsing filenames per AMC.
import type { SchemeIdentity } from "./mfapi";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function detectPeriod(rows: unknown[][]): { period: string; asOf: string } | null {
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

export function detectName(rows: unknown[][], fallback: string): string {
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
export function overlaps(a: string, b: string): boolean {
  const ta = tokens(a), tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return true; // can't tell → don't flag
  for (const t of ta) if (tb.has(t)) return true;
  return false;
}

export function hashCode(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

export function synthIdentity(code: string, name: string, amc: string): SchemeIdentity {
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
