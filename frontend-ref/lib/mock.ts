// ─────────────────────────────────────────────────────────────
// Types — mirror the /api/* data contract (Brief §6)
// ─────────────────────────────────────────────────────────────
export type AssetClass = "equity" | "debt" | "hybrid" | "other";

export interface WeightItem {
  name: string;
  weight: number;
}
export interface CashItem {
  section: string;
  weight: number;
}
export interface TopHolding {
  name: string;
  isin: string;
  sector: string;
  weight: number;
}
export interface Holding {
  name: string;
  isin: string;
  instrument_type: string;
  sector: string;
  weight: number;
  market_value: number; // ₹ cr
  quantity: number;
}

export interface AnalyseData {
  scheme_name: string;
  amc_name: string;
  category: string;
  isin: string;
  asset_class: AssetClass;
  period: string;
  period_label: string;
  as_of_date: string;
  source_org: string;
  source_url: string;
  aum: number | null; // ₹ cr
  nav: number | null;
  expense_ratio: number | null;
  holdings_count: number;
  total_weight: number;
  deployable_cash: number; // %
  asset_allocation: WeightItem[];
  category_breakdown: WeightItem[];
  market_cap_breakdown: WeightItem[]; // equity only; may be []
  cash_breakdown: CashItem[];
  top_holdings: TopHolding[];
  holdings: Holding[];
}

export interface AIInsight {
  generated_at: string;
  headline: string;
  sections: { title: string; bullets: string[] }[];
  flags: string[];
}

export interface SchemeSummary {
  id: string;
  scheme_name: string;
  amc_name: string;
  category: string;
  nav: number | null;
  asset_class: AssetClass;
  errors?: boolean; // forces an ingestion-error state, for demoing §7 error
}

export interface PeriodOption {
  period: string;
  label: string;
  hasData: boolean;
}

// ─────────────────────────────────────────────────────────────
// Scheme universe (drives SchemeSearch autocomplete)
// ─────────────────────────────────────────────────────────────
export const SCHEMES: SchemeSummary[] = [
  { id: "ppfas-flexi", scheme_name: "Parag Parikh Flexi Cap Fund", amc_name: "PPFAS Mutual Fund", category: "Flexi Cap", nav: 78.91, asset_class: "equity" },
  { id: "hdfc-liquid", scheme_name: "HDFC Liquid Fund", amc_name: "HDFC Mutual Fund", category: "Liquid", nav: 4789.24, asset_class: "debt" },
  { id: "mirae-largecap", scheme_name: "Mirae Asset Large Cap Fund", amc_name: "Mirae Asset MF", category: "Large Cap", nav: 102.46, asset_class: "equity" },
  { id: "axis-midcap", scheme_name: "Axis Midcap Fund", amc_name: "Axis Mutual Fund", category: "Mid Cap", nav: 96.12, asset_class: "equity" },
  { id: "sbi-smallcap", scheme_name: "SBI Small Cap Fund", amc_name: "SBI Mutual Fund", category: "Small Cap", nav: 168.33, asset_class: "equity" },
  { id: "icici-balanced", scheme_name: "ICICI Pru Balanced Advantage", amc_name: "ICICI Prudential MF", category: "Dynamic Asset Allocation", nav: 71.84, asset_class: "hybrid" },
  { id: "nippon-gilt", scheme_name: "Nippon India Gilt Securities Fund", amc_name: "Nippon India MF", category: "Gilt", nav: 38.27, asset_class: "debt" },
  { id: "quant-active", scheme_name: "Quant Active Fund", amc_name: "Quant Mutual Fund", category: "Multi Cap", nav: 712.55, asset_class: "equity" },
  { id: "kotak-corp", scheme_name: "Kotak Corporate Bond Fund", amc_name: "Kotak Mahindra MF", category: "Corporate Bond", nav: 3621.9, asset_class: "debt", errors: true },
];

const PERIODS_WITH_DATA: Record<string, string[]> = {
  "ppfas-flexi": ["2025-05", "2025-04"],
  "hdfc-liquid": ["2025-05"],
};

const ALL_PERIODS: { period: string; label: string }[] = [
  { period: "2025-05", label: "May 2025" },
  { period: "2025-04", label: "Apr 2025" },
  { period: "2025-03", label: "Mar 2025" },
  { period: "2025-02", label: "Feb 2025" },
];

export function getPeriods(schemeId: string | null): PeriodOption[] {
  const has = (schemeId && PERIODS_WITH_DATA[schemeId]) || [];
  return ALL_PERIODS.map((p) => ({ ...p, hasData: has.includes(p.period) }));
}

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────
const ppfasHoldings: Holding[] = [
  { name: "HDFC Bank Ltd.", isin: "INE040A01034", instrument_type: "Equity", sector: "Banking & Finance", weight: 7.84, market_value: 7065.3, quantity: 38450000 },
  { name: "Bajaj Holdings & Investment Ltd.", isin: "INE118A01012", instrument_type: "Equity", sector: "Banking & Finance", weight: 6.91, market_value: 6227.4, quantity: 4820000 },
  { name: "Power Grid Corp of India Ltd.", isin: "INE752E01010", instrument_type: "Equity", sector: "Power & Utilities", weight: 5.42, market_value: 4884.9, quantity: 16210000 },
  { name: "Coal India Ltd.", isin: "INE522F01014", instrument_type: "Equity", sector: "Energy & Materials", weight: 5.13, market_value: 4623.4, quantity: 11040000 },
  { name: "ICICI Bank Ltd.", isin: "INE090A01021", instrument_type: "Equity", sector: "Banking & Finance", weight: 4.78, market_value: 4307.9, quantity: 3650000 },
  { name: "Alphabet Inc. (Class C)", isin: "US02079K1079", instrument_type: "Foreign Equity", sector: "Foreign Equity", weight: 4.21, market_value: 3794.3, quantity: 245000 },
  { name: "Microsoft Corp.", isin: "US5949181045", instrument_type: "Foreign Equity", sector: "Foreign Equity", weight: 3.94, market_value: 3550.9, quantity: 102000 },
  { name: "ITC Ltd.", isin: "INE154A01025", instrument_type: "Equity", sector: "FMCG", weight: 3.62, market_value: 3262.5, quantity: 71500000 },
  { name: "Maruti Suzuki India Ltd.", isin: "INE585B01010", instrument_type: "Equity", sector: "Auto & Ancillaries", weight: 3.31, market_value: 2983.1, quantity: 2410000 },
  { name: "Kotak Mahindra Bank Ltd.", isin: "INE237A01028", instrument_type: "Equity", sector: "Banking & Finance", weight: 3.08, market_value: 2775.9, quantity: 15600000 },
  { name: "Axis Bank Ltd.", isin: "INE238A01034", instrument_type: "Equity", sector: "Banking & Finance", weight: 2.86, market_value: 2577.6, quantity: 22300000 },
  { name: "Cipla Ltd.", isin: "INE059A01026", instrument_type: "Equity", sector: "Pharma & Healthcare", weight: 2.64, market_value: 2379.3, quantity: 15800000 },
  { name: "Hero MotoCorp Ltd.", isin: "INE158A01026", instrument_type: "Equity", sector: "Auto & Ancillaries", weight: 2.41, market_value: 2172.0, quantity: 4350000 },
  { name: "Amazon.com Inc.", isin: "US0231351067", instrument_type: "Foreign Equity", sector: "Foreign Equity", weight: 2.18, market_value: 1964.7, quantity: 118000 },
  { name: "Dr. Reddy's Laboratories Ltd.", isin: "INE089A01023", instrument_type: "Equity", sector: "Pharma & Healthcare", weight: 1.97, market_value: 1775.4, quantity: 2760000 },
  { name: "Meta Platforms Inc.", isin: "US30303M1027", instrument_type: "Foreign Equity", sector: "Foreign Equity", weight: 1.88, market_value: 1694.2, quantity: 36000 },
  { name: "Wipro Ltd.", isin: "INE075A01022", instrument_type: "Equity", sector: "Technology", weight: 1.74, market_value: 1568.0, quantity: 31200000 },
  { name: "Infosys Ltd.", isin: "INE009A01021", instrument_type: "Equity", sector: "Technology", weight: 1.62, market_value: 1460.1, quantity: 9300000 },
  { name: "Indian Energy Exchange Ltd.", isin: "INE022Q01020", instrument_type: "Equity", sector: "Power & Utilities", weight: 1.43, market_value: 1288.7, quantity: 7100000 },
  { name: "TREPS / Net Receivables", isin: "—", instrument_type: "Cash & Equivalent", sector: "Cash", weight: 8.42, market_value: 7588.0, quantity: 0 },
];

const ppfasMay: AnalyseData = {
  scheme_name: "Parag Parikh Flexi Cap Fund",
  amc_name: "PPFAS Mutual Fund",
  category: "Flexi Cap",
  isin: "INF879O01027",
  asset_class: "equity",
  period: "2025-05",
  period_label: "May 2025",
  as_of_date: "2025-05-31",
  source_org: "PPFAS Mutual Fund",
  source_url: "https://amc.ppfas.com/schemes/parag-parikh-flexi-cap-fund/",
  aum: 90123.4,
  nav: 78.91,
  expense_ratio: 0.63,
  holdings_count: 73,
  total_weight: 100.0,
  deployable_cash: 8.42,
  asset_allocation: [
    { name: "Indian Equity", weight: 70.78 },
    { name: "Foreign Equity", weight: 12.21 },
    { name: "Debt & Arbitrage", weight: 8.59 },
    { name: "Cash & Equivalent", weight: 8.42 },
  ],
  category_breakdown: [
    { name: "Banking & Finance", weight: 25.47 },
    { name: "Foreign Equity", weight: 12.21 },
    { name: "Power & Utilities", weight: 6.85 },
    { name: "Energy & Materials", weight: 5.13 },
    { name: "Auto & Ancillaries", weight: 5.72 },
    { name: "Pharma & Healthcare", weight: 4.61 },
    { name: "FMCG", weight: 3.62 },
    { name: "Technology", weight: 3.36 },
  ],
  market_cap_breakdown: [
    { name: "Large Cap", weight: 60.24 },
    { name: "Mid Cap", weight: 14.82 },
    { name: "Small Cap", weight: 7.93 },
  ],
  cash_breakdown: [
    { section: "TREPS", weight: 5.11 },
    { section: "Treasury Bills", weight: 2.08 },
    { section: "Net Receivables", weight: 1.23 },
  ],
  top_holdings: ppfasHoldings.slice(0, 10).map((h) => ({ name: h.name, isin: h.isin, sector: h.sector, weight: h.weight })),
  holdings: ppfasHoldings,
};

// April snapshot — its own holdings so Compare shows a real month-on-month diff
// vs May: TCS exited, Infosys + IEX entered, cash raised 7.22 → 8.42, several trims/adds.
const ppfasAprHoldings: Holding[] = [
  { name: "HDFC Bank Ltd.", isin: "INE040A01034", instrument_type: "Equity", sector: "Banking & Finance", weight: 7.51, market_value: 6658.0, quantity: 37100000 },
  { name: "Bajaj Holdings & Investment Ltd.", isin: "INE118A01012", instrument_type: "Equity", sector: "Banking & Finance", weight: 7.10, market_value: 6294.0, quantity: 4980000 },
  { name: "Coal India Ltd.", isin: "INE522F01014", instrument_type: "Equity", sector: "Energy & Materials", weight: 5.66, market_value: 5018.0, quantity: 12200000 },
  { name: "Power Grid Corp of India Ltd.", isin: "INE752E01010", instrument_type: "Equity", sector: "Power & Utilities", weight: 5.20, market_value: 4610.0, quantity: 15500000 },
  { name: "ICICI Bank Ltd.", isin: "INE090A01021", instrument_type: "Equity", sector: "Banking & Finance", weight: 4.55, market_value: 4034.0, quantity: 3490000 },
  { name: "Alphabet Inc. (Class C)", isin: "US02079K1079", instrument_type: "Foreign Equity", sector: "Foreign Equity", weight: 4.40, market_value: 3901.0, quantity: 256000 },
  { name: "Microsoft Corp.", isin: "US5949181045", instrument_type: "Foreign Equity", sector: "Foreign Equity", weight: 4.02, market_value: 3564.0, quantity: 104000 },
  { name: "ITC Ltd.", isin: "INE154A01025", instrument_type: "Equity", sector: "FMCG", weight: 3.80, market_value: 3369.0, quantity: 75000000 },
  { name: "Maruti Suzuki India Ltd.", isin: "INE585B01010", instrument_type: "Equity", sector: "Auto & Ancillaries", weight: 3.10, market_value: 2748.0, quantity: 2260000 },
  { name: "Kotak Mahindra Bank Ltd.", isin: "INE237A01028", instrument_type: "Equity", sector: "Banking & Finance", weight: 2.95, market_value: 2615.0, quantity: 14900000 },
  { name: "Cipla Ltd.", isin: "INE059A01026", instrument_type: "Equity", sector: "Pharma & Healthcare", weight: 2.80, market_value: 2482.0, quantity: 16700000 },
  { name: "Axis Bank Ltd.", isin: "INE238A01034", instrument_type: "Equity", sector: "Banking & Finance", weight: 2.70, market_value: 2394.0, quantity: 21000000 },
  { name: "Hero MotoCorp Ltd.", isin: "INE158A01026", instrument_type: "Equity", sector: "Auto & Ancillaries", weight: 2.55, market_value: 2261.0, quantity: 4600000 },
  { name: "Amazon.com Inc.", isin: "US0231351067", instrument_type: "Foreign Equity", sector: "Foreign Equity", weight: 2.30, market_value: 2039.0, quantity: 125000 },
  { name: "Tata Consultancy Services Ltd.", isin: "INE467B01029", instrument_type: "Equity", sector: "Technology", weight: 2.20, market_value: 1950.0, quantity: 4800000 },
  { name: "Dr. Reddy's Laboratories Ltd.", isin: "INE089A01023", instrument_type: "Equity", sector: "Pharma & Healthcare", weight: 2.10, market_value: 1862.0, quantity: 2940000 },
  { name: "Meta Platforms Inc.", isin: "US30303M1027", instrument_type: "Foreign Equity", sector: "Foreign Equity", weight: 1.95, market_value: 1729.0, quantity: 37500000 },
  { name: "Wipro Ltd.", isin: "INE075A01022", instrument_type: "Equity", sector: "Technology", weight: 1.90, market_value: 1684.0, quantity: 34100000 },
  { name: "TREPS / Net Receivables", isin: "—", instrument_type: "Cash & Equivalent", sector: "Cash", weight: 7.22, market_value: 6401.0, quantity: 0 },
];

const ppfasApr: AnalyseData = {
  ...ppfasMay,
  period: "2025-04",
  period_label: "Apr 2025",
  as_of_date: "2025-04-30",
  aum: 88654.2,
  nav: 77.04,
  holdings_count: 70,
  deployable_cash: 7.22,
  asset_allocation: [
    { name: "Indian Equity", weight: 71.94 },
    { name: "Foreign Equity", weight: 12.86 },
    { name: "Debt & Arbitrage", weight: 7.98 },
    { name: "Cash & Equivalent", weight: 7.22 },
  ],
  category_breakdown: [
    { name: "Banking & Finance", weight: 25.02 },
    { name: "Foreign Equity", weight: 13.07 },
    { name: "Energy & Materials", weight: 5.66 },
    { name: "Auto & Ancillaries", weight: 5.65 },
    { name: "Power & Utilities", weight: 5.20 },
    { name: "Pharma & Healthcare", weight: 4.90 },
    { name: "Technology", weight: 4.10 },
    { name: "FMCG", weight: 3.80 },
  ],
  market_cap_breakdown: [
    { name: "Large Cap", weight: 61.02 },
    { name: "Mid Cap", weight: 14.18 },
    { name: "Small Cap", weight: 7.51 },
  ],
  top_holdings: ppfasAprHoldings.slice(0, 10).map((h) => ({ name: h.name, isin: h.isin, sector: h.sector, weight: h.weight })),
  holdings: ppfasAprHoldings,
};

const hdfcLiquidHoldings: Holding[] = [
  { name: "91-Day Treasury Bill (Jun 2025)", isin: "IN002025X017", instrument_type: "T-Bill", sector: "Sovereign", weight: 14.82, market_value: 9633.0, quantity: 0 },
  { name: "Reliance Industries Ltd. CP", isin: "INE002A14AB1", instrument_type: "Commercial Paper", sector: "Corporate", weight: 9.41, market_value: 6116.5, quantity: 0 },
  { name: "HDFC Securities Ltd. CP", isin: "INE700G14CD5", instrument_type: "Commercial Paper", sector: "Corporate", weight: 8.12, market_value: 5278.0, quantity: 0 },
  { name: "Small Industries Devp Bank CD", isin: "INE556F16BX9", instrument_type: "Certificate of Deposit", sector: "Banking", weight: 7.66, market_value: 4979.0, quantity: 0 },
  { name: "182-Day Treasury Bill (Aug 2025)", isin: "IN002025Y024", instrument_type: "T-Bill", sector: "Sovereign", weight: 6.93, market_value: 4504.5, quantity: 0 },
  { name: "Axis Bank Ltd. CD", isin: "INE238A16YT2", instrument_type: "Certificate of Deposit", sector: "Banking", weight: 6.21, market_value: 4036.5, quantity: 0 },
  { name: "LIC Housing Finance CP", isin: "INE115A14MN8", instrument_type: "Commercial Paper", sector: "Corporate", weight: 5.74, market_value: 3731.0, quantity: 0 },
  { name: "Kotak Mahindra Bank CD", isin: "INE237A16ZP1", instrument_type: "Certificate of Deposit", sector: "Banking", weight: 4.83, market_value: 3139.5, quantity: 0 },
  { name: "Bajaj Finance Ltd. CP", isin: "INE296A14RT7", instrument_type: "Commercial Paper", sector: "Corporate", weight: 4.27, market_value: 2775.5, quantity: 0 },
  { name: "TREPS / Net Receivables", isin: "—", instrument_type: "Cash & Equivalent", sector: "Cash", weight: 12.04, market_value: 7826.0, quantity: 0 },
];

const hdfcLiquidMay: AnalyseData = {
  scheme_name: "HDFC Liquid Fund",
  amc_name: "HDFC Mutual Fund",
  category: "Liquid",
  isin: "INF179KA1HY1",
  asset_class: "debt",
  period: "2025-05",
  period_label: "May 2025",
  as_of_date: "2025-05-31",
  source_org: "HDFC Mutual Fund",
  source_url: "https://www.hdfcfund.com/our-products/debt/hdfc-liquid-fund",
  aum: 65012.8,
  nav: 4789.24,
  expense_ratio: 0.2,
  holdings_count: 45,
  total_weight: 100.0,
  deployable_cash: 12.04,
  asset_allocation: [
    { name: "Money Market", weight: 56.71 },
    { name: "Government Securities", weight: 21.75 },
    { name: "Corporate Debt", weight: 9.5 },
    { name: "Cash & Equivalent", weight: 12.04 },
  ],
  category_breakdown: [
    { name: "Commercial Paper", weight: 38.21 },
    { name: "Treasury Bills", weight: 21.75 },
    { name: "Certificate of Deposit", weight: 18.7 },
    { name: "Corporate Bond", weight: 9.5 },
    { name: "TREPS / Cash", weight: 12.04 },
  ],
  market_cap_breakdown: [], // non-equity → MarketCapBar hides
  cash_breakdown: [
    { section: "TREPS", weight: 8.41 },
    { section: "Net Receivables", weight: 3.63 },
  ],
  top_holdings: hdfcLiquidHoldings.slice(0, 10).map((h) => ({ name: h.name, isin: h.isin, sector: h.sector, weight: h.weight })),
  holdings: hdfcLiquidHoldings,
};

const DATA: Record<string, Record<string, AnalyseData>> = {
  "ppfas-flexi": { "2025-05": ppfasMay, "2025-04": ppfasApr },
  "hdfc-liquid": { "2025-05": hdfcLiquidMay },
};

export function getAnalyse(schemeId: string | null, period: string | null): AnalyseData | null {
  if (!schemeId || !period) return null;
  return DATA[schemeId]?.[period] ?? null;
}

// Periods (latest-first) that actually have ingested data for a scheme — drives Compare.
export function getComparePeriods(schemeId: string | null): { period: string; label: string }[] {
  const has = (schemeId && PERIODS_WITH_DATA[schemeId]) || [];
  return ALL_PERIODS.filter((p) => has.includes(p.period));
}

// ──────────────────────────────────────────────
// Screener — ranks the whole universe on a few comparable metrics (Screen view)
// ──────────────────────────────────────────────
export interface ScreenerRow {
  id: string;
  scheme_name: string;
  amc_name: string;
  category: string;
  asset_class: AssetClass;
  aum: number; // ₹ cr
  nav: number;
  expense_ratio: number; // %
  holdings_count: number;
  deployable_cash: number; // %
  top10_concentration: number; // % of book in top 10
  errors?: boolean;
}

export const SCREENER: ScreenerRow[] = [
  { id: "ppfas-flexi", scheme_name: "Parag Parikh Flexi Cap Fund", amc_name: "PPFAS Mutual Fund", category: "Flexi Cap", asset_class: "equity", aum: 90123.4, nav: 78.91, expense_ratio: 0.63, holdings_count: 73, deployable_cash: 8.42, top10_concentration: 47.44 },
  { id: "quant-active", scheme_name: "Quant Active Fund", amc_name: "Quant Mutual Fund", category: "Multi Cap", asset_class: "equity", aum: 9870.2, nav: 712.55, expense_ratio: 0.77, holdings_count: 49, deployable_cash: 14.20, top10_concentration: 41.05 },
  { id: "hdfc-liquid", scheme_name: "HDFC Liquid Fund", amc_name: "HDFC Mutual Fund", category: "Liquid", asset_class: "debt", aum: 65012.8, nav: 4789.24, expense_ratio: 0.20, holdings_count: 45, deployable_cash: 12.04, top10_concentration: 79.99 },
  { id: "mirae-largecap", scheme_name: "Mirae Asset Large Cap Fund", amc_name: "Mirae Asset MF", category: "Large Cap", asset_class: "equity", aum: 38450.6, nav: 102.46, expense_ratio: 0.54, holdings_count: 62, deployable_cash: 3.10, top10_concentration: 52.81 },
  { id: "axis-midcap", scheme_name: "Axis Midcap Fund", amc_name: "Axis Mutual Fund", category: "Mid Cap", asset_class: "equity", aum: 29870.1, nav: 96.12, expense_ratio: 0.58, holdings_count: 71, deployable_cash: 4.85, top10_concentration: 38.20 },
  { id: "sbi-smallcap", scheme_name: "SBI Small Cap Fund", amc_name: "SBI Mutual Fund", category: "Small Cap", asset_class: "equity", aum: 31210.9, nav: 168.33, expense_ratio: 0.69, holdings_count: 58, deployable_cash: 9.60, top10_concentration: 28.44 },
  { id: "icici-balanced", scheme_name: "ICICI Pru Balanced Advantage", amc_name: "ICICI Prudential MF", category: "Dynamic Asset Allocation", asset_class: "hybrid", aum: 61500.0, nav: 71.84, expense_ratio: 0.71, holdings_count: 88, deployable_cash: 5.40, top10_concentration: 31.52 },
  { id: "nippon-gilt", scheme_name: "Nippon India Gilt Securities Fund", amc_name: "Nippon India MF", category: "Gilt", asset_class: "debt", aum: 2140.3, nav: 38.27, expense_ratio: 0.62, holdings_count: 19, deployable_cash: 6.10, top10_concentration: 92.04 },
  { id: "kotak-corp", scheme_name: "Kotak Corporate Bond Fund", amc_name: "Kotak Mahindra MF", category: "Corporate Bond", asset_class: "debt", aum: 14320.7, nav: 3621.90, expense_ratio: 0.34, holdings_count: 64, deployable_cash: 4.30, top10_concentration: 35.06, errors: true },
];

export function getScreener(): ScreenerRow[] {
  return SCREENER;
}

export function getSchemeById(id: string): SchemeSummary | undefined {
  return SCHEMES.find((s) => s.id === id);
}

// ─────────────────────────────────────────────────────────────
// AI interpretation fixtures (rendered by AIInsightPanel)
// ─────────────────────────────────────────────────────────────
const AI: Record<string, AIInsight> = {
  "ppfas-flexi": {
    generated_at: "2025-06-02T09:14:00Z",
    headline:
      "A defensive flexi-cap stance: bank-heavy core, a deliberate global sleeve, and an unusually large cash cushion signalling caution on domestic valuations.",
    sections: [
      {
        title: "Portfolio posture",
        bullets: [
          "Banking & Finance is the dominant tilt at 25.5% of the book, anchored by HDFC Bank (7.8%) and Bajaj Holdings (6.9%) — both long-held, low-churn positions.",
          "Deployable cash sits at 8.4%, well above the flexi-cap median (~4–5%), consistent with the manager's stated reluctance to chase a rich market.",
          "Large caps make up 60% of equity, with a measured 7.9% small-cap sleeve — risk is concentrated up the cap curve.",
        ],
      },
      {
        title: "Notable positioning",
        bullets: [
          "Foreign equity (12.2%) — Alphabet, Microsoft, Amazon, Meta — gives the fund a tech/quality exposure largely absent from the domestic universe.",
          "Energy & utilities (Coal India, Power Grid, IEX) read as a cash-flow / dividend ballast rather than a growth bet.",
        ],
      },
      {
        title: "Month-on-month read",
        bullets: [
          "Cash rose ~1.2pp vs April (7.2% → 8.4%) and holdings count climbed 70 → 73 — incremental trimming into strength rather than wholesale rotation.",
        ],
      },
    ],
    flags: [
      "Cash at 8.4% is a drag if markets rally — return is being traded for downside protection.",
      "Foreign-equity sleeve carries currency and overseas-regulatory exposure not present in pure-domestic peers.",
    ],
  },
  "hdfc-liquid": {
    generated_at: "2025-06-02T09:20:00Z",
    headline:
      "A textbook liquid-fund profile: short-dated money-market paper and sovereign bills, with capital preservation and same-day liquidity as the clear objective.",
    sections: [
      {
        title: "Portfolio posture",
        bullets: [
          "Commercial paper (38.2%) and T-bills (21.8%) dominate — high-grade, short-maturity instruments with minimal credit risk.",
          "12% in TREPS / net receivables keeps redemption liquidity comfortable.",
        ],
      },
      {
        title: "Credit & duration",
        bullets: [
          "No sub-AA exposure detected in the disclosed book; issuer mix skews to PSU banks and top-tier NBFCs.",
          "Effective maturity stays well inside the 91-day liquid-fund ceiling.",
        ],
      },
    ],
    flags: ["Yields track the overnight/short-end curve — returns will compress if the RBI eases."],
  },
};

export function getAIInsight(schemeId: string | null): AIInsight | null {
  if (!schemeId) return null;
  return AI[schemeId] ?? null;
}

// Category colour assignment — stable per name, from the light palette
const CAT_VARS = ["--cat-1", "--cat-2", "--cat-3", "--cat-4", "--cat-5", "--cat-6", "--cat-7", "--cat-8"];
export function catColor(index: number, name?: string): string {
  if (name && /cash|treps|receivable/i.test(name)) return "var(--cat-8)";
  return `var(${CAT_VARS[index % CAT_VARS.length]})`;
}

export const DEFAULT_SCHEME = SCHEMES[0];
export const DEFAULT_PERIOD = "2025-05";
