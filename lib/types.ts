// Canonical data contract shared by API routes and the frontend.
// Mirrors ARCHITECTURE.md "snapshots.data" and the original frontend-ref mock types.

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

// Portfolio-wide characteristics stated as aggregates on a factsheet
// (not derivable from disclosed holdings). All optional — XLS snapshots omit them.
export interface PortfolioMetrics {
  ytm: number | null; // annualised portfolio YTM, %
  macaulay_days: number | null; // Macaulay duration, days
  residual_days: number | null; // average residual maturity, days
  benchmark: string | null;
  inception: string | null; // as printed
  fund_managers: string | null; // as printed
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
  // ── factsheet extras (optional; present mainly for uploaded PDFs) ──
  partial?: boolean; // only top-N holdings disclosed (coverage = total_weight)
  rating_breakdown?: WeightItem[]; // portfolio-wide by credit-rating class
  metrics?: PortfolioMetrics;
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
  errors?: boolean;
}

// ready  = already stored in DB (instant)
// fetchable = an auto-fetch AMC + a published month (we'll fetch on demand)
// upload = not auto-fetched / not published — user can upload the file
export type PeriodStatus = "ready" | "fetchable" | "upload";
export interface PeriodOption {
  period: string;
  label: string;
  status: PeriodStatus;
  /** convenience: true when status !== "upload" (a month we expect to resolve) */
  hasData: boolean;
}

// Compare payload — both snapshots + computed deltas (server-derived).
export interface ChangeRow {
  name: string;
  isin: string;
  weight_a: number;
  weight_b: number;
  delta: number;
}
export interface CompareData {
  a: AnalyseData;
  b: AnalyseData;
  kpis: { cash_delta: number; count_delta: number; equity_delta: number; aum_delta: number | null };
  changes: { added: ChangeRow[]; exited: ChangeRow[]; increased: ChangeRow[]; reduced: ChangeRow[] };
  category_drift: WeightItem[];
}

export interface ScreenerRow {
  id: string;
  scheme_name: string;
  amc_name: string;
  category: string;
  asset_class: AssetClass;
  aum: number;
  nav: number;
  expense_ratio: number;
  holdings_count: number;
  deployable_cash: number;
  top10_concentration: number;
  errors?: boolean;
}

// M6: /api/search response shapes (see app/api/search/route.ts).
export interface SearchHolding {
  scheme_code: string;
  scheme_name: string;
  amc_name: string;
  period: string;
  weight: number | null;
}

export interface IsinSearchResult {
  type: "isin";
  isin: string;
  security_name: string | null;
  holder_count: number;
  holdings: SearchHolding[];
}

export interface SecurityMatch {
  isin: string;
  name: string;
  score: number;
}

export interface SchemeMatch {
  scheme_code: string;
  amc_name: string;
  scheme_name: string;
  category: string;
  asset_class: string;
  score: number;
}

export interface NameSearchResult {
  type: "name";
  query: string;
  securities: SecurityMatch[];
  schemes: SchemeMatch[];
}

export type SearchResult = IsinSearchResult | NameSearchResult | { type: "empty" };
