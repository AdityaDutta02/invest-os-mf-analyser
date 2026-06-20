// Deterministic SEBI monthly-portfolio XLS parser + derivation engine.
// Code computes every number; the LLM never does. Handles the column/header
// variation seen across AMC disclosure spreadsheets (see registry _meta).
import * as XLSX from "xlsx";
import type {
  AnalyseData,
  AssetClass,
  CashItem,
  Holding,
  WeightItem,
} from "./types";
import type { SchemeIdentity } from "./mfapi";

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

// ── instrument classification ────────────────────────────────
export type InstrumentType =
  | "equity"
  | "foreign_equity"
  | "gsec"
  | "tbill"
  | "cp"
  | "cd"
  | "debt"
  | "arbitrage"
  | "reit"
  | "fund"
  | "treps"
  | "cash";

// Classify from the row's own text. Returns null when nothing specific matches
// (so the caller can fall back to the section context, then to equity default).
function classifyText(t: string): InstrumentType | null {
  if (/treps|tri[- ]?party|triparty|reverse repo|^repo\b|collateral.*borrow/.test(t)) return "treps";
  if (/net receivable|net current asset|cash margin|cash\s*&|cash and|cash at bank|other current|bank balance/.test(t))
    return "cash";
  if (/treasury bill|t-bill|tbill|^t bill/.test(t)) return "tbill";
  if (/certificate of deposit|\bcd\b/.test(t)) return "cd";
  if (/commercial paper|\bcp\b/.test(t)) return "cp";
  if (/g-?sec|government (of india )?stock|govt |goi |sovereign|gilt|state development|\bsdl\b/.test(t)) return "gsec";
  if (/arbitrage/.test(t)) return "arbitrage";
  if (/reit|invit|infrastructure investment trust|real estate investment/.test(t)) return "reit";
  if (/\betf\b|index fund|units? of |mutual fund units|liquid fund/.test(t)) return "fund";
  if (/debenture|\bncd\b|bond|notes?\b|perpetual|\bzcb\b|pass through|securit/.test(t)) return "debt";
  if (/\b(adr|gdr)\b|overseas|foreign (equity|securit)/.test(t)) return "foreign_equity";
  return null;
}

// Map a section-header label (e.g. "Reverse Repo / TREPS", "Money Market") to a type.
function classifySection(section: string): InstrumentType | null {
  if (!section) return null;
  const s = section.toLowerCase();
  if (/treps|repo|tri[- ]?party/.test(s)) return "treps";
  if (/certificate of deposit/.test(s)) return "cd";
  if (/commercial paper/.test(s)) return "cp";
  if (/treasury bill/.test(s)) return "tbill";
  if (/money market/.test(s)) return "cp";
  if (/receivable|net current|cash|margin/.test(s)) return "cash";
  if (/government|g-?sec|gilt|sovereign|\bsdl\b/.test(s)) return "gsec";
  if (/arbitrage/.test(s)) return "arbitrage";
  if (/reit|invit/.test(s)) return "reit";
  if (/mutual fund unit|units of/.test(s)) return "fund";
  if (/debt|bond|debenture|\bncd\b/.test(s)) return "debt";
  if (/equity/.test(s)) return "equity";
  return null;
}

export function classify(name: string, isin: string, industry: string, section = ""): InstrumentType {
  const t = `${name} ${industry}`.toLowerCase();
  const own = classifyText(t);
  if (own) return own;
  // foreign equity: a valid non-Indian ISIN (Indian = INE/INF/IN0…)
  if (isin && ISIN_RE.test(isin) && !/^IN[EFD0-9]/.test(isin)) return "foreign_equity";
  const sec = classifySection(section);
  if (sec) return sec;
  // valid Indian ISIN with no other signal → equity
  return "equity";
}

const CASH_TYPES = new Set<InstrumentType>(["treps", "cash"]);
const MM_TYPES = new Set<InstrumentType>(["cp", "cd", "tbill"]);
const DEBT_TYPES = new Set<InstrumentType>(["gsec", "debt"]);

// ── raw row extraction ───────────────────────────────────────
interface RawRow {
  name: string;
  isin: string;
  industry: string;
  quantity: number;
  market_value_cr: number; // converted from lakhs
  weight: number; // % to NAV
  section: string; // section-header context (e.g. "Reverse Repo / TREPS")
}

interface ColMap {
  name: number;
  isin: number;
  industry: number;
  quantity: number;
  marketValue: number;
  weight: number;
}

const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const num = (v: unknown): number => {
  if (v == null || v === "") return 0;
  const s = String(v).trim();
  const neg = /^\(.*\)$/.test(s); // accounting negatives
  // strip everything except digits, dot, minus (handles "7.84%", "1,234.5", "₹...")
  const cleaned = s.replace(/[^0-9.\-]/g, "");
  const n = Number(cleaned);
  if (!isFinite(n)) return 0;
  return neg ? -Math.abs(n) : n;
};

function findHeader(rows: unknown[][]): { row: number; cols: ColMap } | null {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = (rows[i] || []).map(norm);
    const isinIdx = cells.findIndex((c) => c === "isin" || c.includes("isin"));
    if (isinIdx === -1) continue;
    const find = (pred: (c: string) => boolean) => cells.findIndex(pred);
    const name = find((c) => c.includes("name of the instrument") || c.includes("name of instrument") || c.includes("instrument / issuer") || c.includes("instrument/issuer") || (c.includes("instrument") && !c.includes("type")) || c.includes("issuer") || c.includes("security"));
    const industry = find((c) => c.includes("industry") || c.includes("rating"));
    const quantity = find((c) => c.includes("quantity") || c === "qty");
    const marketValue = find((c) => c.includes("market") && c.includes("value") || c.includes("market/fair") || c.includes("fair value") || c.includes("market value"));
    const weight = find((c) => c.includes("% to net") || c.includes("% to nav") || c.includes("% to aum") || (c.includes("%") && (c.includes("net asset") || c.includes("nav") || c.includes("aum"))) || c.includes("percentage to net"));
    if (name === -1 || weight === -1) continue;
    return {
      row: i,
      cols: { name, isin: isinIdx, industry, quantity, marketValue, weight },
    };
  }
  return null;
}

const CASHISH = /treps|tri[- ]?party|reverse repo|receivable|net current|cash|margin/i;

interface ExtractResult {
  rows: RawRow[];
  aumCr: number | null; // from the GRAND TOTAL market value (Rs. in Lakhs → Cr)
}

function extractRows(rows: unknown[][]): ExtractResult {
  const hdr = findHeader(rows);
  if (!hdr) return { rows: [], aumCr: null };
  const { cols } = hdr;
  const out: RawRow[] = [];
  let aumCr: number | null = null;
  let section = "";
  for (let i = hdr.row + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const name = String(r[cols.name] ?? "").replace(/\s+/g, " ").trim();
    const isin = String(r[cols.isin] ?? "").replace(/\s+/g, "").trim().toUpperCase();
    const weight = num(r[cols.weight]);
    if (!name) continue;
    const low = name.toLowerCase();

    // Stop at the grand total — everything after it is notes/derivatives schedules.
    if (/grand total/.test(low)) {
      if (cols.marketValue >= 0) {
        const mv = num(r[cols.marketValue]) / 100; // lakhs -> crore
        if (mv > 0) aumCr = round2(mv);
      }
      break;
    }
    // Aggregate rows — skip (their weight is already in the constituent rows).
    if (/^(sub ?total|total|net asset)/.test(low)) continue;

    const hasISIN = ISIN_RE.test(isin);
    const hasWeight = weight > 0;
    const isCashish = CASHISH.test(low);

    // A labelled row with no ISIN and no weight is a section header → set context.
    if (!hasISIN && !hasWeight) {
      section = low;
      continue;
    }
    // Keep instrument rows: any ISIN row, any cash-ish line, or a weighted row
    // sitting under a recognised section (e.g. a TREPS line named by a code).
    if (!hasISIN && !isCashish && !(hasWeight && classifySection(section))) continue;

    const mvCell = cols.marketValue >= 0 ? num(r[cols.marketValue]) : 0;
    out.push({
      name,
      isin: hasISIN ? isin : "",
      industry: cols.industry >= 0 ? String(r[cols.industry] ?? "").replace(/\s+/g, " ").trim() : "",
      quantity: cols.quantity >= 0 ? num(r[cols.quantity]) : 0,
      market_value_cr: mvCell / 100, // lakhs -> crore
      weight,
      section,
    });
  }
  return { rows: out, aumCr };
}

// ── sector labelling ─────────────────────────────────────────
function sectorFor(row: RawRow, type: InstrumentType): string {
  if (type === "foreign_equity") return "Foreign Equity";
  if (CASH_TYPES.has(type)) return "Cash & Equivalent";
  if (MM_TYPES.has(type)) return type === "tbill" ? "Treasury Bills" : type === "cp" ? "Commercial Paper" : "Certificate of Deposit";
  if (type === "gsec") return "Government Securities";
  if (type === "debt") return "Corporate Debt";
  if (type === "arbitrage") return "Arbitrage";
  if (type === "reit") return "REITs / InvITs";
  if (type === "fund") return "Mutual Fund Units";
  // equity → use industry column, cleaned
  const ind = row.industry.replace(/[*^#~]/g, "").trim();
  return ind || "Other";
}

const TYPE_LABEL: Record<InstrumentType, string> = {
  equity: "Equity",
  foreign_equity: "Foreign Equity",
  gsec: "Government Security",
  tbill: "Treasury Bill",
  cp: "Commercial Paper",
  cd: "Certificate of Deposit",
  debt: "Corporate Debt",
  arbitrage: "Arbitrage",
  reit: "REIT / InvIT",
  fund: "Fund Units",
  treps: "TREPS",
  cash: "Cash & Equivalent",
};

function agg(items: { name: string; weight: number }[]): WeightItem[] {
  const m = new Map<string, number>();
  for (const it of items) m.set(it.name, (m.get(it.name) ?? 0) + it.weight);
  return [...m.entries()]
    .map(([name, weight]) => ({ name, weight: round2(weight) }))
    .filter((x) => x.weight > 0)
    .sort((a, b) => b.weight - a.weight);
}
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── main build ───────────────────────────────────────────────
export interface ParseResult {
  data: Omit<AnalyseData, "scheme_name" | "amc_name" | "category" | "isin" | "asset_class" | "period" | "period_label" | "as_of_date" | "source_org" | "source_url" | "aum" | "nav" | "expense_ratio">;
  asset_class: AssetClass; // derived from the holdings mix
  aum: number | null; // ₹ cr, from the grand-total net assets
  ok: boolean;
  reason?: string;
}

export function buildFromRows(rawRows: unknown[][]): ParseResult {
  const { rows, aumCr } = extractRows(rawRows);
  return deriveRows(rows, aumCr);
}

// PDF / AI-extraction path: rows already structured → derive deterministically.
export interface HoldingInput {
  name: string;
  isin?: string;
  industry?: string;
  weight: number;
  market_value_cr?: number;
  quantity?: number;
  section?: string;
}
export function buildFromHoldings(items: HoldingInput[], aumCr: number | null = null): ParseResult {
  const rows: RawRow[] = (items || [])
    .filter((h) => h && h.name && typeof h.weight === "number")
    .map((h) => ({
      name: String(h.name).trim(),
      isin: h.isin && ISIN_RE.test(String(h.isin).toUpperCase()) ? String(h.isin).toUpperCase() : "",
      industry: h.industry ?? "",
      quantity: h.quantity ?? 0,
      market_value_cr: h.market_value_cr ?? 0,
      weight: h.weight ?? 0,
      section: h.section ?? "",
    }));
  return deriveRows(rows, aumCr);
}

function deriveRows(rows: RawRow[], aumCr: number | null): ParseResult {
  if (rows.length === 0) return { data: emptyDerived(), asset_class: "other", aum: null, ok: false, reason: "no holdings rows found" };

  const holdings: Holding[] = rows.map((r) => {
    const type = classify(r.name, r.isin, r.industry, r.section);
    return {
      name: r.name,
      isin: r.isin || "—",
      instrument_type: TYPE_LABEL[type],
      sector: sectorFor(r, type),
      weight: round2(r.weight),
      market_value: round2(r.market_value_cr),
      quantity: r.quantity,
    };
  });
  const types = rows.map((r) => classify(r.name, r.isin, r.industry, r.section));

  const totalWeight = round2(rows.reduce((s, r) => s + r.weight, 0));

  // asset allocation buckets
  const bucket = (pred: (t: InstrumentType) => boolean) =>
    round2(rows.reduce((s, r, i) => (pred(types[i]) ? s + r.weight : s), 0));
  const allocRaw: WeightItem[] = [
    { name: "Equity", weight: bucket((t) => t === "equity") },
    { name: "Foreign Equity", weight: bucket((t) => t === "foreign_equity") },
    { name: "Government Securities", weight: bucket((t) => t === "gsec") },
    { name: "Corporate Debt", weight: bucket((t) => t === "debt") },
    { name: "Money Market", weight: bucket((t) => MM_TYPES.has(t)) },
    { name: "Arbitrage", weight: bucket((t) => t === "arbitrage") },
    { name: "REITs / InvITs", weight: bucket((t) => t === "reit") },
    { name: "Cash & Equivalent", weight: bucket((t) => CASH_TYPES.has(t)) },
  ];
  const asset_allocation = allocRaw.filter((a) => a.weight > 0);

  const equityWeight = bucket((t) => t === "equity" || t === "foreign_equity");
  const debtWeight = bucket((t) => DEBT_TYPES.has(t) || MM_TYPES.has(t));
  const asset_class: AssetClass =
    equityWeight >= 65 ? "equity" : debtWeight >= 65 ? "debt" : equityWeight > 15 && debtWeight > 15 ? "hybrid" : equityWeight > debtWeight ? "equity" : "debt";

  // category breakdown: equity-ish → by sector; debt → by instrument type
  let category_breakdown: WeightItem[];
  if (asset_class === "debt") {
    category_breakdown = agg(holdings.map((h, i) => ({ name: TYPE_LABEL[types[i]], weight: h.weight })));
  } else {
    category_breakdown = agg(holdings.map((h) => ({ name: h.sector, weight: h.weight })));
  }

  // cash breakdown
  const cashItems: CashItem[] = [];
  rows.forEach((r, i) => {
    const t = types[i];
    if (CASH_TYPES.has(t)) {
      const label = t === "treps" ? "TREPS" : /receivable|current asset/i.test(r.name) ? "Net Receivables" : "Cash";
      cashItems.push({ section: label, weight: round2(r.weight) });
    }
  });
  const cash_breakdown = aggCash(cashItems);

  const deployable_cash = round2(
    rows.reduce((s, r, i) => (CASH_TYPES.has(types[i]) || types[i] === "arbitrage" ? s + r.weight : s), 0),
  );

  const top_holdings = holdings
    .filter((h) => h.isin !== "—")
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 10)
    .map((h) => ({ name: h.name, isin: h.isin, sector: h.sector, weight: h.weight }));

  return {
    ok: true,
    asset_class,
    aum: aumCr,
    data: {
      holdings_count: holdings.length,
      total_weight: totalWeight,
      deployable_cash,
      asset_allocation,
      category_breakdown,
      market_cap_breakdown: [], // requires AMFI large/mid/small list — deferred (frontend hides when [])
      cash_breakdown,
      top_holdings,
      holdings,
    },
  };
}

function aggCash(items: CashItem[]): CashItem[] {
  const m = new Map<string, number>();
  for (const it of items) m.set(it.section, (m.get(it.section) ?? 0) + it.weight);
  return [...m.entries()].map(([section, weight]) => ({ section, weight: round2(weight) })).sort((a, b) => b.weight - a.weight);
}

function emptyDerived(): ParseResult["data"] {
  return {
    holdings_count: 0,
    total_weight: 0,
    deployable_cash: 0,
    asset_allocation: [],
    category_breakdown: [],
    market_cap_breakdown: [],
    cash_breakdown: [],
    top_holdings: [],
    holdings: [],
  };
}

// ── workbook helpers ─────────────────────────────────────────
export function sheetRows(ws: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }) as unknown[][];
}

// Pick the most likely sheet: the one whose extracted rows count is highest,
// optionally biased toward a sheet matching the scheme hint tokens.
export function pickSheet(wb: XLSX.WorkBook, schemeHint?: string): { name: string; rows: unknown[][] } | null {
  const hintTokens = (schemeHint ?? "")
    .toLowerCase()
    .replace(/fund|plan|growth|direct|regular|the/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  let best: { name: string; rows: unknown[][]; score: number } | null = null;
  for (const name of wb.SheetNames) {
    const rows = sheetRows(wb.Sheets[name]);
    const extracted = extractRows(rows).rows.length;
    if (extracted === 0) continue;
    let score = extracted;
    if (hintTokens.length) {
      const hay = (name + " " + rows.slice(0, 6).flat().join(" ")).toLowerCase();
      const hits = hintTokens.filter((tk) => hay.includes(tk)).length;
      score += hits * 1000; // strong bias toward the matching scheme tab
    }
    if (!best || score > best.score) best = { name, rows, score };
  }
  return best ? { name: best.name, rows: best.rows } : null;
}

export function validate(data: ParseResult["data"], opts?: { lenient?: boolean }): { ok: boolean; reason?: string } {
  if (data.holdings_count <= 0) return { ok: false, reason: "no holdings" };
  // Lenient mode (PDF factsheets often disclose only top holdings → partial total).
  if (opts?.lenient) return data.total_weight > 0 ? { ok: true } : { ok: false, reason: "zero weight" };
  if (data.total_weight < 90 || data.total_weight > 110)
    return { ok: false, reason: `total weight ${data.total_weight} out of range` };
  return { ok: true };
}

// Merge parsed holdings with scheme identity + period meta into the full contract.
export function assemble(
  parsed: ParseResult,
  id: SchemeIdentity,
  period: string,
  asOfDate: string,
  sourceUrl: string,
  opts?: { nav?: number | null; aum?: number | null; expenseRatio?: number | null },
): AnalyseData {
  return {
    scheme_name: id.scheme_name,
    amc_name: id.amc_name,
    category: id.category,
    isin: id.isin,
    asset_class: id.asset_class && id.asset_class !== "other" ? id.asset_class : parsed.asset_class,
    period,
    period_label: periodLabel(period),
    as_of_date: asOfDate,
    source_org: id.fund_house || id.amc_name,
    source_url: sourceUrl,
    aum: opts?.aum ?? parsed.aum,
    nav: opts?.nav ?? id.latest_nav,
    expense_ratio: opts?.expenseRatio ?? null,
    ...parsed.data,
  };
}

export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] ?? "";
  return `${mon} ${y}`;
}
