// Moneycontrol enrichment source (F-series follow-up): fills in current-month
// NAV/AUM/holdings for schemes via Moneycontrol's public site — no auth,
// no cookies, plain unauthenticated GET requests throughout. Used as an
// enrichment/backfill layer alongside the full SEBI-disclosure corpus, not a
// replacement for it (see project memory: Moneycontrol's holdings endpoint
// returns ~85-130 stock positions summing to ~100% weight — near-complete,
// but not guaranteed to be the exhaustive per-instrument SEBI disclosure).
//
// Chain (all confirmed live, unauthenticated):
// 1. autosuggestion_solr.php?type=2 — free-text fund search, JSONP-wrapped.
// 2. The fund's own NAV page embeds a Next.js __NEXT_DATA__ script tag with
//    a fully structured overview (NAV/AUM/expense ratio/category/company)
//    plus planOptionMap listing every plan variant with an explicit
//    optionName ("Growth" vs "IDCW") — this is how we honor "growth
//    distribution only, nothing else".
// 3. api.moneycontrol.com/swiftapi/v1/mutualfunds/{holdings,portfolio}
//    keyed by ISIN — the actual stock-level holdings + asset allocation.
import type { AnalyseData, AssetClass, CashItem, Holding, TopHolding, WeightItem } from "./types";
import type { SchemeIdentity } from "./mfapi";

// Moneycontrol 403s any UA string that self-identifies as a bot (confirmed
// live) but has no other gate — a plain browser UA is required, not
// optional. Worth knowing: this is "public API, no auth" only in the sense
// that no token/cookie is needed, not that it's bot-agnostic.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Safari/605.1.15";
const FETCH_TIMEOUT_MS = 10_000;

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export interface McSearchHit {
  imid: string;
  slug: string;
  name: string;
}

// type=2 is Moneycontrol's mutual-fund search bucket (1=stocks, 4=stocks alt,
// 14=unlisted, etc. — found by capturing the site's own live autosuggest
// traffic). Response is JSONP (`suggest1(...)`) regardless of the
// `format=json` param, so strip the callback wrapper ourselves.
export async function searchFunds(query: string): Promise<McSearchHit[]> {
  const url = `https://www.moneycontrol.com/mccode/common/autosuggestion_solr.php?classic=true&query=${encodeURIComponent(query)}&type=2&format=json&callback=suggest1`;
  const raw = await fetchText(url);
  const m = raw.match(/^suggest1\((.*)\)$/s);
  if (!m) return [];
  let arr: Array<{ link_src?: string; name?: string }>;
  try {
    arr = JSON.parse(m[1]);
  } catch {
    return [];
  }
  return arr
    .filter((e) => e.link_src && /\/mutual-funds\/nav\//.test(e.link_src))
    .map((e) => {
      const src = e.link_src!;
      const parts = src.split("/").filter(Boolean);
      const imid = parts[parts.length - 1];
      const slug = parts[parts.length - 2];
      return { imid, slug, name: e.name ?? "" };
    });
}

export interface McPlanOption {
  isin: string;
  imid: string;
  planName: string; // "Direct" | "Regular"
  optionName: string; // "Growth" | "IDCW" | ...
  schemeName: string;
  schemeUrl?: string;
}

export interface McFundOverview {
  isin: string;
  imid: string;
  planName: string;
  optionName: string;
  schemeName: string;
  categoryName: string;
  companyName: string;
  latestNAV: number | null;
  navDate: string;
  aum: number | null; // ₹ Cr
  expenseRatio: number | null; // %
  morningstarId: string | null;
  planOptions: McPlanOption[]; // every plan/option variant for this fund (for growth-only filtering)
}

function parseNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/[,%\s]/g, ""));
  return isFinite(n) ? n : null;
}

// Fetches the fund's own NAV page and extracts the embedded Next.js data
// blob — no separate API call needed for identity/NAV/AUM/category.
export async function fetchFundOverview(imid: string, slug: string): Promise<McFundOverview | null> {
  const html = await fetchText(`https://www.moneycontrol.com/mutual-funds/nav/${slug}/${imid}`);
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!m) return null;
  let json: { props?: { pageProps?: { data?: Record<string, unknown> } } };
  try {
    json = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const page = json.props?.pageProps?.data;
  if (!page) return null;
  const ov = page.overview as Record<string, unknown> | undefined;
  if (!ov) return null;

  const planOptions: McPlanOption[] = [];
  const pom = ov.planOptionMap as Record<string, McPlanOption[]> | undefined;
  if (pom) for (const opts of Object.values(pom)) planOptions.push(...opts);

  return {
    isin: String(page.isin ?? ov.isin ?? ""),
    imid: String(ov.imid ?? imid),
    planName: String(ov.planName ?? ""),
    optionName: String(ov.optionName ?? ""),
    schemeName: String(ov.schemeName ?? ""),
    categoryName: String(ov.categoryName ?? ""),
    companyName: String(ov.companyName ?? ""),
    latestNAV: parseNum(ov.latestNAV),
    navDate: String(ov.navDate ?? ""),
    aum: parseNum(ov.aum),
    expenseRatio: parseNum(ov.expenseRatio),
    morningstarId: (page.morningstarid as string) || null,
    planOptions,
  };
}

// "Only take growth distribution, nothing else" — IDCW/payout/dividend
// variants are excluded by requiring optionName === "Growth" exactly.
export function isGrowthOption(o: { optionName: string }): boolean {
  return o.optionName.trim().toLowerCase() === "growth";
}

export interface McStockHolding {
  name: string;
  sector: string;
  weight: number;
}

export async function fetchHoldings(isin: string): Promise<McStockHolding[]> {
  const url = `https://api.moneycontrol.com/swiftapi/v1/mutualfunds/holdings?isin=${encodeURIComponent(isin)}&deviceType=W&responseType=json`;
  const raw = await fetchText(url);
  let json: { success?: number; data?: { stock?: Array<{ name: string; sector: string; weighting: string }> } };
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  const stocks = json.data?.stock ?? [];
  return stocks
    .map((s) => ({ name: s.name, sector: s.sector || "", weight: parseNum(s.weighting) ?? 0 }))
    .filter((s) => s.name && s.weight > 0);
}

export interface McAssetAllocation {
  equityPct: number | null;
  bondPct: number | null;
  cashPct: number | null;
  otherPct: number | null;
  numHoldings: number | null;
}

export async function fetchAssetAllocation(isin: string): Promise<McAssetAllocation | null> {
  const url = `https://api.moneycontrol.com/swiftapi/v1/mutualfunds/portfolio?isin=${encodeURIComponent(isin)}&deviceType=W&responseType=json`;
  const raw = await fetchText(url);
  let json: { success?: number; data?: Array<Record<string, unknown>> };
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const first = json.data?.[0] as { asset_alloc?: Record<string, string>; concentration?: { number_of_holding?: number } } | undefined;
  if (!first?.asset_alloc) return null;
  const a = first.asset_alloc;
  return {
    equityPct: parseNum(a.equity_alloc),
    bondPct: parseNum(a.bond_alloc),
    cashPct: parseNum(a.cash_alloc),
    otherPct: parseNum(a.other_alloc),
    numHoldings: first.concentration?.number_of_holding ?? null,
  };
}

// Deliberately does NOT run these stocks through lib/parse.ts's
// buildFromHoldings()/classify() — that engine expects SEBI-disclosure rows
// with explicit industry/rating/section signals to tell equity from debt
// from cash; Moneycontrol's flat stock list has none of that, so every row
// (even a bond or REIT that slipped in) gets classified as generic equity.
// Confirmed live: doing so inflated "Equity" to 96.67% when Moneycontrol's
// own authoritative asset_alloc for the same fund says 85.23% — a ~17%
// overstatement, the same class of bug just fixed in lib/parse.ts. Use
// fetchAssetAllocation()'s numbers as the authoritative allocation instead.
//
// Separately: each stock's `weighting` is normalized to 100% WITHIN the
// equity sleeve, not the whole portfolio (the full stock list already sums
// to ~100% on its own, even though equity is only ~85% of NAV) — scale by
// equityPct/100 to get true portfolio-level weight before using it anywhere
// weight is assumed to mean "% of fund NAV" (holdings/top_holdings, same
// convention the SEBI-disclosure path uses throughout).
export function scaleToPortfolioWeight(stocks: McStockHolding[], equityPct: number | null): McStockHolding[] {
  if (equityPct == null) return stocks;
  const factor = equityPct / 100;
  return stocks.map((s) => ({ ...s, weight: Math.round(s.weight * factor * 100) / 100 }));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Assembles the AnalyseData subset Moneycontrol can actually support —
// allocation/cash from the authoritative asset_alloc fields, holdings/
// top_holdings from the (portfolio-weight-scaled) equity stock list. Always
// marks `partial: true`: the stock list is equity-only, not the exhaustive
// per-instrument SEBI disclosure (debt/cash lines aren't individually
// itemized here, only their aggregate %), so holdings_count/total_weight
// intentionally cover the equity sleeve only, same "coverage" semantics the
// partial-PDF-factsheet path already uses elsewhere in this schema.
export function assembleFromMoneycontrol(
  identity: SchemeIdentity,
  ov: McFundOverview,
  alloc: McAssetAllocation | null,
  rawStocks: McStockHolding[],
  period: string,
  asOfDate: string,
  sourceUrl: string,
): AnalyseData {
  const stocks = alloc ? scaleToPortfolioWeight(rawStocks, alloc.equityPct) : rawStocks;

  const holdings: Holding[] = stocks.map((s) => ({
    name: s.name,
    isin: "—",
    instrument_type: "Equity",
    sector: s.sector || "Other",
    weight: s.weight,
    market_value: 0,
    quantity: 0,
  }));
  const top_holdings: TopHolding[] = [...holdings]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 10)
    .map((h) => ({ name: h.name, isin: h.isin, sector: h.sector, weight: h.weight }));

  const sectorMap = new Map<string, number>();
  for (const s of stocks) sectorMap.set(s.sector || "Other", (sectorMap.get(s.sector || "Other") ?? 0) + s.weight);
  const category_breakdown: WeightItem[] = [...sectorMap.entries()]
    .map(([name, weight]) => ({ name, weight: round2(weight) }))
    .filter((x) => x.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  const asset_allocation: WeightItem[] = alloc
    ? [
        { name: "Equity", weight: alloc.equityPct ?? 0 },
        { name: "Corporate Debt", weight: alloc.bondPct ?? 0 },
        { name: "Cash & Equivalent", weight: alloc.cashPct ?? 0 },
        { name: "Other", weight: alloc.otherPct ?? 0 },
      ].filter((a) => a.weight > 0)
    : [];
  const cash_breakdown: CashItem[] = alloc?.cashPct ? [{ section: "Cash & Equivalent", weight: alloc.cashPct }] : [];
  const deployable_cash = alloc?.cashPct ?? 0;

  const equityPct = alloc?.equityPct ?? 0;
  const debtPct = (alloc?.bondPct ?? 0) + (alloc?.cashPct ?? 0);
  const asset_class: AssetClass =
    equityPct >= 65 ? "equity" : debtPct >= 65 ? "debt" : equityPct > 15 && debtPct > 15 ? "hybrid" : equityPct > debtPct ? "equity" : "debt";

  const totalStockWeight = round2(stocks.reduce((s, x) => s + x.weight, 0));

  return {
    scheme_name: ov.schemeName || identity.scheme_name,
    amc_name: ov.companyName || identity.amc_name,
    category: ov.categoryName || identity.category,
    isin: ov.isin,
    asset_class,
    period,
    period_label: periodLabelFor(period),
    as_of_date: asOfDate,
    source_org: ov.companyName || identity.amc_name,
    source_url: sourceUrl,
    aum: ov.aum,
    nav: ov.latestNAV,
    expense_ratio: ov.expenseRatio,
    holdings_count: alloc?.numHoldings ?? holdings.length,
    total_weight: totalStockWeight,
    deployable_cash: round2(deployable_cash),
    asset_allocation,
    category_breakdown,
    market_cap_breakdown: [],
    cash_breakdown,
    top_holdings,
    holdings,
    partial: true,
  };
}

function periodLabelFor(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] ?? "";
  return `${mon} ${y}`;
}
