# MF Analyser — Dashboard + AI Analysis Plan

Builds on the canonical `snapshots.data` contract (see ARCHITECTURE.md).
Visual language: keep the recovered original — dark `#050505`, gold `#EAB308`, IBM Plex Mono + Chivo, square corners, terminal feel.
Reuse recovered components: KpiTile, CategoryDonut, TopHoldings, HoldingsTable, ChangesList, UploadZone, ProgressTerminal, tabs/table/tooltip/sonner/button.
New components: SchemeSearch, PeriodPicker, AssetAllocationBar, MarketCapBar, SourceBadge, AIInsightPanel, ScreenTable (P2).

Guiding rule for AI: **deterministic code computes every number; the LLM only interprets.** AI output is structured JSON, labelled "AI interpretation", cached per snapshot. Tone analytical/descriptive, never advisory ("not investment advice" persists).

---

## View 0 — Search & Browse (entry point; the DB-first upgrade)

Data: `GET /api/schemes?q=` (mfapi-backed), `GET /api/periods?scheme=`.

- Search box → results: scheme name · AMC · category · latest NAV.
- Select fund → PeriodPicker (months available in DB; in P1, fetchable Tier-1 months; else prompt upload).
- Two actions: **Analyse** (one month) · **Compare** (two months).
- Upload tab remains as escape-hatch (XLS or factsheet PDF).

---

## View 1 — Single-Month Analysis

Data: `GET /api/analyse?scheme=&period=` → contract.

**KPI row (KpiTile):**
| KPI | field |
|---|---|
| Period | period_label |
| AUM | aum (₹ cr, "—" if null) |
| NAV | nav |
| Expense Ratio | expense_ratio |
| Total Holdings | holdings_count |
| Deployable Cash | deployable_cash (tooltip = cash_breakdown) |
| Equity % | asset_allocation.Equity |
| Total Weight | total_weight |

**Charts row:**
- AssetAllocationBar — asset_allocation (equity/debt/cash).
- CategoryDonut — category_breakdown (sector). (reused)
- MarketCapBar — market_cap_breakdown (equity only; hide if debt/liquid fund).

**Holdings:**
- TopHoldings — top_holdings (top 10, weight + sector). (reused)
- HoldingsTable — full holdings, sortable: name · isin · type · sector · weight. (reused)

**SourceBadge:** "Sourced from {source_org}" + as_of_date. No technical provenance.

**AIInsightPanel — "Portfolio Read":** see AI #1 below.

---

## View 2 — Compare Two Months

Data: `GET /api/compare?scheme=&a=&b=` → both contracts + computed deltas.

**KPI deltas:** Cash Movement (cashDelta, colored), Holdings Count Δ, Equity % Δ, AUM Δ.

**ChangesList (reused):** four buckets —
- **Added** (in B not A) · **Exited** (in A not B) · **Increased** (Δweight>0) · **Reduced** (Δweight<0), each sorted by |Δ|.

**Category drift:** sector weight deltas (bar, +/-).

**Holdings diff table:** name · weight_A · weight_B · delta (HoldingsTable + delta column).

**AIInsightPanel — "What Changed":** see AI #2 below.

---

## View 3 — Screen / Cross-Fund (Phase 2+, needs corpus)

Data: `GET /api/screen`, `GET /api/holders?isin=`, fund-overlap.

- **Screener:** pick category → ScreenTable ranking funds by metric (deployable cash, equity %, top-10 concentration, expense ratio, holdings count).
- **Stock holders:** ISIN/stock → funds holding it + weights (uses holdings index).
- **Fund overlap:** two funds → common holdings + overlap %.
- **AIInsightPanel — "Peer Context":** see AI #3.

---

## AI Analysis Layer

Engine: Terminal AI gateway `callGateway` (Claude), structured-output schema, cached per (scheme, period, prompt-version). Input = computed contract; output = interpretation JSON. Reject/strip any number in output not present in input.

### AI #1 — Portfolio Read (single month)
Input: full contract.
Output:
```jsonc
{
  "headline": "one line on the portfolio's posture",
  "concentration": "top-10 weight + how concentrated vs typical",
  "cash_stance": "what deployable_cash implies (defensive/deployed)",
  "sector_tilts": ["overweight Banking", "low FMCG", ...],
  "notable_positions": ["large foreign-equity sleeve", ...],
  "flags": ["high single-stock weight", "elevated cash", ...]
}
```

### AI #2 — What Changed (compare)
Input: two contracts + deltas.
Output:
```jsonc
{
  "headline": "summary of the month's moves",
  "conviction_moves": ["added X (+1.8%)", "exited Y", ...],
  "cash_deployment": "deployed cash into equity / raised cash",
  "sector_rotation": ["rotated into IT from FMCG", ...],
  "flags": ["new large position", "sharp cash jump", ...]
}
```

### AI #3 — Peer Context (Phase 2+)
Input: fund metrics + peer-group aggregates.
Output: positioning sentences (more/less cash than peers, concentration vs median, sector tilt vs category).

### AI #4 — Ask (optional, later)
Grounded Q&A over the contract(s); answers only from provided data, else "not in the factsheet."

**Controls:** label "AI interpretation"; numbers rendered from data, prose from AI; cache to avoid recompute/cost; descriptive not advisory; disclaimer persists.

---

## Build order (frontend)
1. Scaffold Next.js, port recovered components + theme, render with mock contract.
2. View 0 search (mfapi) + View 1 single-month wired to `/api/analyse`.
3. Add AssetAllocation/MarketCap components + SourceBadge.
4. View 2 compare + ChangesList.
5. AIInsightPanel #1 and #2 (gateway + cache).
6. (P2) View 3 screen/holders/overlap + AI #3 once corpus exists.

## Open decisions
- AI scope fixed to **descriptive/analytical, not advisory** (recommended; aligns with disclaimer). Revisit only if you want explicit recommendations.
- Charts lib: reuse recharts (already in recovered bundle).
