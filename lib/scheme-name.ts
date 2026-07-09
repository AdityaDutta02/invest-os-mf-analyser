// Per-AMC scheme-name extraction recipe — ported from
// scripts/bulk/parse.ts (the one-off historical backfill parser) into the
// live ingest path so every month's new disclosures get the same quality
// resolution the backfill corpus needed 3 rounds of live debugging to reach,
// instead of the old single-heuristic detectName. See
// scripts/bulk/scheme-name-recipes.json for the full per-AMC diagnosis this
// was built from.
//
// Priority chain (first hit wins): an explicit in-sheet "SCHEME NAME:"
// label > an Index-tab code->name lookup (Tata/Nippon/Axis-style RTA
// templates) > early-cell plain-text title (Mirae-style, no label at all,
// with a boilerplate/column-header guard) > caller-supplied fallback hint
// (filename/link text) > the raw sheet/tab name.
import * as XLSX from "xlsx";
import { sheetRows } from "./parse";

const SCHEME_LABEL_RE = /scheme\s*name/i;

function schemeNameFromSheetLabel(rows: unknown[][]): string | null {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = (rows[i] || []).map((c) => String(c ?? "").trim());
    const idx = cells.findIndex((c) => SCHEME_LABEL_RE.test(c));
    if (idx === -1) continue;
    const sameRow = cells.slice(idx + 1).find((c) => c && !SCHEME_LABEL_RE.test(c));
    if (sameRow) return stripTrailingParenthetical(sameRow);
    const nextRow = (rows[i + 1] || []).map((c) => String(c ?? "").trim()).find((c) => c);
    if (nextRow) return stripTrailingParenthetical(nextRow);
  }
  return null;
}

// Extended from the bulk backfill's regex with the launch-critical gaps it
// surfaced live: HDFC ("Coupon (%)"), Invesco/PPFAS/360-ONE ("Market/Fair
// Value..."), JM Financial ("Quantity/Face Value"), Unifi ("Name of
// Instrument"), Zerodha ("Rating / Industry"). See scheme-name-recipes.json.
// Deliberately does NOT include "exchange traded" / "open-ended" — those
// describe scheme TYPE and appear in disclaimer boilerplate, but also
// appear as a legitimate substring of real ETF names ("HDFC Banking
// Exchange Traded Fund") once the trailing "(An Open Ended...)"
// parenthetical descriptor is stripped (which now happens before this
// check runs) — including them here false-rejected genuine ETF titles.
const EARLY_TEXT_BOILERPLATE_RE =
  /monthly portfolio|portfolio statement|as on |nse symbol|bse scrip|scheme replicating|name of the instrument|name of instrument|equity & equity|grand total|pursuant to regulation|securities (and|&) exchange board|coupon\s*\(|market\s*\/\s*fair value|quantity\s*\/\s*face value|rating\s*\/\s*industry|industry\s*\/\s*rating|registration no\.?/i;

function stripTrailingParenthetical(name: string): string {
  return name.split("(")[0].replace(/\s+/g, " ").trim() || name;
}

// Some AMCs' CMS glues a short scheme-type prefix code directly onto the
// name with a hyphen and no space (e.g. "IB02-Groww Liquid Fund",
// "WCSC-THE WEALTH COMPANY SMALL CAP FUND") — strip a leading 2-6
// uppercase-letter/digit code + '-' before it dilutes any downstream match.
function stripPrefixCode(name: string): string {
  return name.replace(/^[A-Z0-9]{2,6}-/, "").trim();
}

// When the "SCHEME NAME:" label and its value live in the same cell (not
// split across cells, which schemeNameFromSheetLabel handles), that whole
// cell falls through to the early-text scan as a candidate — strip the
// label prefix so the result doesn't read "Scheme Name: Invesco India Tax
// Plan" instead of just "Invesco India Tax Plan".
function stripLabelPrefix(name: string): string {
  return name.replace(/^scheme\s*name\s*[:\-]\s*/i, "").trim();
}

// Column-header vocabulary is far more varied than any fixed phrase list
// can chase (confirmed live: "Industry+ /Rating" with a stray glyph,
// "% to Net Assets", "Top 10 holdings by issuer" all slipped past the
// original phrase-only regex). Rather than whack-a-mole every variant,
// require a positive signal instead: a real scheme name almost always
// contains either the AMC's own name or common fund vocabulary
// (Fund/Plan/Scheme/ETF/FMP) — reject anything that has neither, on the
// assumption a column header won't happen to contain those either.
const FUND_VOCAB_RE = /\b(fund|plan|scheme|etf|fmp|yojana)\b/i;

function schemeNameFromEarlyText(rows: unknown[][], amcName: string): string | null {
  const bareAmc = amcName.replace(/\s*mutual fund\s*$/i, "").trim().toLowerCase();
  const amcTokens = bareAmc.split(/\s+/).filter((t) => t.length > 2);
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i] || [];
    // A real title/label row is near-empty except the title itself — often
    // a merged cell, which the XLSX reader duplicates as the SAME text
    // across every column of the merge (so a plain non-empty-cell count
    // would wrongly reject it); a holdings-table row has many genuinely
    // DIFFERENT populated columns (name, ISIN, quantity, value, rating...).
    // Count distinct values, not raw non-empty count. Without this, a
    // holding whose name happens to contain the AMC's own name (e.g. "HDFC
    // Bank Ltd." inside an HDFC-AMC sheet) satisfies the AMC-token check
    // below and gets mistaken for the scheme name — confirmed live on real
    // corpus files.
    const distinctCount = new Set(row.map((c) => String(c ?? "").trim()).filter(Boolean)).size;
    if (distinctCount > 3) continue;
    for (const raw of row) {
      const c = String(raw ?? "").trim();
      if (c.length < 8 || c.length > 400) continue; // upper bound is just a sanity cap; real check is post-strip below
      if (c.startsWith("(")) continue;
      if (/^[\d%]/.test(c)) continue;
      if (!/\s/.test(c)) continue;
      // Strip the trailing "(An Open-Ended Exchange Traded Fund...)"-style
      // descriptor BEFORE the boilerplate/length checks. Some AMCs put the
      // descriptor on the same cell as the title separated by a newline
      // (not a space), pushing the raw cell's length over 100 chars even
      // though the real name underneath is short — confirmed live:
      // Invesco's title cells were being skipped entirely by a pre-strip
      // length check for exactly this reason. Stripping first also avoids
      // false-rejecting real ETF names that legitimately contain "Exchange
      // Traded"/"Open Ended" as part of the fund name itself (e.g. "HDFC
      // Banking Exchange Traded Fund") once the descriptor is gone.
      const stripped = stripLabelPrefix(stripPrefixCode(stripTrailingParenthetical(c)));
      if (stripped.length < 8 || stripped.length > 100) continue;
      if (EARLY_TEXT_BOILERPLATE_RE.test(stripped)) continue;
      const strippedLower = stripped.toLowerCase();
      if (strippedLower === amcName.toLowerCase() || strippedLower === bareAmc || strippedLower === `${bareAmc} mutual fund`) continue;
      // AMC name + registration boilerplate ("Union Mutual Fund - Registration No. ...")
      if (strippedLower.startsWith(bareAmc) && /registration/i.test(stripped)) continue;
      const hasAmcToken = amcTokens.some((t) => strippedLower.includes(t));
      if (!hasAmcToken && !FUND_VOCAB_RE.test(stripped)) continue;
      return stripped;
    }
  }
  return null;
}

function buildIndexMap(wb: XLSX.WorkBook): Map<string, string> {
  const map = new Map<string, string>();
  const sheetNames = new Set(wb.SheetNames.map((n) => n.toUpperCase()));
  for (const sn of wb.SheetNames) {
    if (!/index/i.test(sn)) continue;
    const rows = sheetRows(wb.Sheets[sn]);
    for (const row of rows) {
      const cells = (row || []).map((c) => String(c ?? "").trim()).filter(Boolean);
      if (cells.length < 2) continue;
      const codeCell = cells.find((c) => sheetNames.has(c.toUpperCase()) && c.toUpperCase() !== sn.toUpperCase());
      if (!codeCell) continue;
      const nameCell = cells.filter((c) => c !== codeCell).sort((a, b) => b.length - a.length)[0];
      if (!nameCell) continue;
      const clean = stripTrailingParenthetical(nameCell);
      if (clean) map.set(codeCell.toUpperCase(), clean);
    }
  }
  return map;
}

export type SchemeNameMethod = "label_in_sheet" | "index_sheet_lookup" | "early_text" | "fallback" | "tab_name";

export interface SchemeNameResolution {
  name: string;
  method: SchemeNameMethod;
}

// wb is needed only for the index-tab lookup; pass the same workbook +
// sheet name pickSheet() returned. fallbackHint is whatever the caller
// already had before this resolver existed (filename, link text, etc.).
export function resolveSchemeName(
  wb: XLSX.WorkBook,
  sheetName: string,
  rows: unknown[][],
  amcName: string,
  fallbackHint: string,
): SchemeNameResolution {
  const labelHint = schemeNameFromSheetLabel(rows);
  if (labelHint) return { name: labelHint, method: "label_in_sheet" };

  const indexHint = buildIndexMap(wb).get(sheetName.toUpperCase());
  if (indexHint) return { name: indexHint, method: "index_sheet_lookup" };

  const earlyTextHint = schemeNameFromEarlyText(rows, amcName);
  if (earlyTextHint) return { name: earlyTextHint, method: "early_text" };

  if (fallbackHint && fallbackHint.trim()) return { name: fallbackHint.trim(), method: "fallback" };

  return { name: sheetName, method: "tab_name" };
}
