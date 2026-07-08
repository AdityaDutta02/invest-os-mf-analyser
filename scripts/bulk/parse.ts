// Piece 1 of the bulk-direct-DB-load plan (see project memory
// project_plan_bulk_direct_db_load / ama_bulk_direct_db_load).
//
// Walks ~/mf-corpus/staging/manifest.json, runs the exact same deterministic
// parser + validation gate the platform's own cron ingest uses (lib/parse.ts),
// and emits one JSONL line per (workbook, sheet) that clears the gate —
// scheme-code resolution and NAV join are deliberately NOT done here (that's
// the mapping pass, tracked separately) — this stage only proves "can we
// deterministically parse this file's holdings and pass the validation gate,"
// which is the dry-run count + report the plan calls for before any DB write.
//
// Run: npx tsx scripts/bulk/parse.ts
import { readFileSync, writeFileSync, mkdirSync, createWriteStream } from "fs";
import { homedir } from "os";
import { join, basename, extname } from "path";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { buildFromRows, validate, sheetRows } from "../../lib/parse";

const CORPUS_DIR = join(homedir(), "mf-corpus");
const MANIFEST_PATH = join(CORPUS_DIR, "staging", "manifest.json");
const OUT_DIR = join(homedir(), "mf-corpus-tools", "bulk-artifacts");
const PARSED_PATH = join(OUT_DIR, "parsed.jsonl");
const FAILED_PATH = join(OUT_DIR, "parse-failed.jsonl");
const REPORT_PATH = join(OUT_DIR, "parse-report.json");

interface ManifestEntry {
  amc: string;
  source_url: string;
  link_text: string;
  staged_path: string;
  format?: string;
  packaging?: "zip" | "per_scheme" | "single_workbook" | null;
  period: string;
  period_source: string;
}

const SPREADSHEET_EXT = new Set([".xlsx", ".xls", ".xlsb"]);

function isPdf(entry: ManifestEntry): boolean {
  return /^pdf\b/i.test(entry.format ?? "") || extname(entry.staged_path).toLowerCase() === ".pdf";
}

// Strip CMS timestamp prefixes ("1783075438406_0_"), month/date boilerplate,
// and generic disclosure-doc phrasing so a filename-derived hint doesn't get
// polluted with "as on 31st may 2026" — that would poison the mfapi match.
const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december";
function schemeHintFrom(name: string): string {
  let s = basename(name, extname(name)).replace(/[_\-]+/g, " ").trim();
  s = s.replace(/^\d{6,}\s*\d*\s*/, ""); // leading CMS timestamp id
  s = s.replace(new RegExp(`\\b(${MONTHS})\\b`, "gi"), " ");
  s = s.replace(/\b(19|20)\d{2}\b/g, " "); // 4-digit year
  s = s.replace(/\b\d{1,2}(st|nd|rd|th)\b/gi, " "); // "31st"
  s = s.replace(/\b(all schemes?|monthly portfolio|portfolio disclosure|scheme wise|as on|disclosure)\b/gi, " ");
  // Some AMCs' CMS glues a long hex hash directly onto the last word with no
  // delimiter (e.g. "...tax-savercaabfc07eee8616aaa28ff00007d74af" — a real
  // corpus filename). basename cleanup above can't split it (no separator),
  // so strip any trailing all-hex run of 16+ chars — long enough that no
  // genuine English word collides with it.
  s = s.replace(/[0-9a-f]{16,}\s*$/i, "");
  return s.replace(/\s+/g, " ").trim();
}

// Look for an explicit "SCHEME NAME :" (or similar) label in the sheet's own
// text — far more reliable than the Excel tab name (often a cryptic ticker
// code like "SMEEF") or the filename (identical across every scheme in a
// bundled all-schemes workbook).
const SCHEME_LABEL_RE = /scheme\s*name/i;
function schemeNameFromSheetLabel(rows: unknown[][]): string | null {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = (rows[i] || []).map((c) => String(c ?? "").trim());
    const idx = cells.findIndex((c) => SCHEME_LABEL_RE.test(c));
    if (idx === -1) continue;
    // value is usually the next non-empty cell on the same row; some layouts
    // put it on the following row instead.
    const sameRow = cells.slice(idx + 1).find((c) => c && !SCHEME_LABEL_RE.test(c));
    if (sameRow) return sameRow;
    const nextRow = (rows[i + 1] || []).map((c) => String(c ?? "").trim()).find((c) => c);
    if (nextRow) return nextRow;
  }
  return null;
}

// Last resort before falling back to the filename/tab-name: some AMCs (e.g.
// Mirae's per-scheme ETF sheets) print the scheme name as plain text in an
// early cell with no "SCHEME NAME" label at all — just the name itself,
// often followed by a "(An open-ended...)" description line and an
// "NSE Symbol:.../BSE Scrip Code:..." line. Grab the first cell that looks
// like a title (multi-word, reasonable length) and isn't obvious boilerplate.
const EARLY_TEXT_BOILERPLATE_RE =
  /monthly portfolio|portfolio statement|as on |nse symbol|bse scrip|exchange traded|open[- ]ended|scheme replicating|name of the instrument|equity & equity|grand total|pursuant to regulation|securities (and|&) exchange board/i;
function schemeNameFromEarlyText(rows: unknown[][], amcName: string): string | null {
  // The AMC's own name repeated as a page header (bare, or "X Mutual Fund")
  // is common across formats and is never itself a valid scheme name —
  // reject it explicitly rather than let it masquerade as one.
  const bareAmc = amcName.replace(/\s*mutual fund\s*$/i, "").trim().toLowerCase();
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    for (const raw of rows[i] || []) {
      const c = String(raw ?? "").trim();
      if (c.length < 8 || c.length > 100) continue;
      if (c.startsWith("(")) continue;
      if (/^\d/.test(c)) continue;
      if (!/\s/.test(c)) continue; // require multi-word
      if (EARLY_TEXT_BOILERPLATE_RE.test(c)) continue;
      const cLower = c.toLowerCase();
      if (cLower === amcName.toLowerCase() || cLower === bareAmc || cLower === `${bareAmc} mutual fund`) continue;
      return c;
    }
  }
  return null;
}

// Several AMCs' RTA-templated workbooks (Tata, Nippon, and likely others)
// carry no per-sheet name label at all — instead an "Index"-named tab lists
// short tab-codes ("TSLVFOF", "IP", "ST"...) next to the full scheme name
// (sometimes with a trailing parenthetical scheme-type description to
// strip), and the data sheets are named by that same short code. Build a
// code -> clean-name map from any sheet whose name contains "index".
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
      const clean = nameCell.split("(")[0].replace(/\s+/g, " ").trim();
      if (clean) map.set(codeCell.toUpperCase(), clean);
    }
  }
  return map;
}

interface WorkbookItem {
  memberName: string | null; // set when this came out of a zip
  buffer: Buffer;
}

async function unpack(entry: ManifestEntry, fileBuf: Buffer): Promise<WorkbookItem[]> {
  if (entry.packaging === "zip" || extname(entry.staged_path).toLowerCase() === ".zip") {
    const zip = await JSZip.loadAsync(fileBuf);
    const items: WorkbookItem[] = [];
    for (const [name, file] of Object.entries(zip.files)) {
      if (file.dir) continue;
      if (!SPREADSHEET_EXT.has(extname(name).toLowerCase())) continue;
      items.push({ memberName: name, buffer: await file.async("nodebuffer") });
    }
    return items;
  }
  return [{ memberName: null, buffer: fileBuf }];
}

function asOfDateFor(period: string): string {
  // Last calendar day of the disclosure month — same convention as
  // lib/registry.ts recipes use when the AMC doesn't state one explicitly.
  const [y, m] = period.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(lastDay).padStart(2, "0")}`;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  let manifest: ManifestEntry[] = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  manifest.sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0)); // newest-first
  const limit = process.env.BULK_LIMIT ? parseInt(process.env.BULK_LIMIT, 10) : undefined;
  if (limit) manifest = manifest.slice(0, limit);

  const parsedOut = createWriteStream(PARSED_PATH, { flags: "w" });
  const failedOut = createWriteStream(FAILED_PATH, { flags: "w" });

  let entriesTotal = 0;
  let entriesOk = 0; // at least one sheet cleared the gate
  let entriesFailed = 0;
  let sheetsEmitted = 0;
  const failReasons: Record<string, number> = {};
  const perAmc: Record<string, { entries: number; ok: number; sheets: number }> = {};

  const bump = (r: Record<string, number>, k: string) => (r[k] = (r[k] ?? 0) + 1);

  for (const entry of manifest) {
    entriesTotal++;
    perAmc[entry.amc] ??= { entries: 0, ok: 0, sheets: 0 };
    perAmc[entry.amc].entries++;
    try {
      await processEntry(entry);
    } catch (e) {
      entriesFailed++;
      bump(failReasons, "unexpected_error");
      failedOut.write(JSON.stringify({ ...entry, reason: "unexpected_error", detail: String(e) }) + "\n");
    }
  }

  async function processEntry(entry: ManifestEntry): Promise<void> {

    if (entriesTotal % 500 === 0) {
      process.stderr.write(
        `[${entriesTotal}/${manifest.length}] ok=${entriesOk} failed=${entriesFailed} sheets=${sheetsEmitted}\n`,
      );
    }

    if (isPdf(entry)) {
      entriesFailed++;
      bump(failReasons, "pdf_not_supported_in_bulk");
      failedOut.write(JSON.stringify({ ...entry, reason: "pdf_not_supported_in_bulk" }) + "\n");
      return;
    }

    if (!entry.period || !/^\d{4}-\d{2}$/.test(entry.period)) {
      entriesFailed++;
      bump(failReasons, "missing_or_invalid_period");
      failedOut.write(JSON.stringify({ ...entry, reason: "missing_or_invalid_period" }) + "\n");
      return;
    }

    const filePath = join(CORPUS_DIR, "staging", entry.staged_path);
    let fileBuf: Buffer;
    try {
      fileBuf = readFileSync(filePath);
    } catch {
      entriesFailed++;
      bump(failReasons, "file_missing");
      failedOut.write(JSON.stringify({ ...entry, reason: "file_missing" }) + "\n");
      return;
    }

    let items: WorkbookItem[];
    try {
      items = await unpack(entry, fileBuf);
    } catch {
      entriesFailed++;
      bump(failReasons, "unzip_failed");
      failedOut.write(JSON.stringify({ ...entry, reason: "unzip_failed" }) + "\n");
      return;
    }
    if (items.length === 0) {
      entriesFailed++;
      bump(failReasons, "zip_no_spreadsheet_members");
      failedOut.write(JSON.stringify({ ...entry, reason: "zip_no_spreadsheet_members" }) + "\n");
      return;
    }

    let entryHadOkSheet = false;
    for (const item of items) {
      let wb: XLSX.WorkBook;
      try {
        wb = XLSX.read(new Uint8Array(item.buffer), { type: "array" });
      } catch {
        bump(failReasons, "unreadable_workbook");
        failedOut.write(
          JSON.stringify({ ...entry, member: item.memberName, reason: "unreadable_workbook" }) + "\n",
        );
        continue;
      }

      const filenameHint = schemeHintFrom(item.memberName ?? entry.staged_path);
      const indexMap = buildIndexMap(wb);
      for (const sheetName of wb.SheetNames) {
        const rows = sheetRows(wb.Sheets[sheetName]);
        const parsed = buildFromRows(rows);
        if (!parsed.ok) continue; // not a holdings sheet (cover page, index, notes) — not a failure
        const v = validate(parsed.data);
        // Prefer an in-sheet "SCHEME NAME :" label (reliable per-scheme signal even
        // when many schemes share one workbook); then an Index-tab code->name
        // lookup (Tata/Nippon-style templates); then plain early-cell title
        // text (Mirae-style: name printed with no label at all); then the
        // filename hint (fine for genuinely single-scheme files); then the
        // raw tab name.
        const labelHint = schemeNameFromSheetLabel(rows);
        const indexHint = !labelHint ? indexMap.get(sheetName.toUpperCase()) : undefined;
        const earlyTextHint = !labelHint && !indexHint ? schemeNameFromEarlyText(rows, entry.amc) : undefined;
        const hint = labelHint || indexHint || earlyTextHint || filenameHint || sheetName;
        const hintMethod = labelHint
          ? "label_in_sheet"
          : indexHint
            ? "index_sheet_lookup"
            : earlyTextHint
              ? "early_text"
              : filenameHint
                ? "filename"
                : "tab_name";
        if (!v.ok) {
          bump(failReasons, `validation:${v.reason}`);
          failedOut.write(
            JSON.stringify({ ...entry, member: item.memberName, sheet: sheetName, reason: v.reason }) + "\n",
          );
          continue;
        }

        entryHadOkSheet = true;
        sheetsEmitted++;
        perAmc[entry.amc].sheets++;
        parsedOut.write(
          JSON.stringify({
            amc: entry.amc,
            staged_path: entry.staged_path,
            member: item.memberName,
            sheet: sheetName,
            scheme_name_hint: hint,
            hint_method: hintMethod,
            period: entry.period,
            period_source: entry.period_source,
            as_of_date: asOfDateFor(entry.period),
            source_url: entry.source_url,
            asset_class: parsed.asset_class,
            aum: parsed.aum,
            ...parsed.data,
          }) + "\n",
        );
      }
    }

    if (entryHadOkSheet) {
      entriesOk++;
      perAmc[entry.amc].ok++;
    } else {
      entriesFailed++;
      bump(failReasons, "no_sheet_cleared_gate");
      failedOut.write(JSON.stringify({ ...entry, reason: "no_sheet_cleared_gate" }) + "\n");
    }
  }

  parsedOut.end();
  failedOut.end();

  const report = {
    entriesTotal,
    entriesOk,
    entriesFailed,
    sheetsEmitted,
    failReasons,
    perAmc,
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
