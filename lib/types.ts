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
  errors?: boolean;
}

export interface PeriodOption {
  period: string;
  label: string;
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
