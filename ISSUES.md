# Dashboard issue log — HDFC Liquid Fund factsheet (2026-06-21)

Source PDF: `Fund Facts - HDFC Liquid Fund - May 2026` (2-page marketing factsheet; discloses **top-10 holdings only ≈ 46% of NAV**).

## Root cause (drives #1, #2-classify, #3-labels, #5-content, #6-missing)
**Stale cached upload snapshot.** `app/api/upload` did `dbInsert` (never overwrote) and `getSnapshot` returns the first/oldest row for a `scheme_code+period`, so a re-upload did NOT refresh. The AI insight (`ai_cache`) was also cached stale. The screenshots show pre-fix data (banks=Equity, empty top-10, no metrics) while today's gateway diagnostic classifies the same holdings correctly as CD/CP.
- **R1** Upsert snapshot: delete prior rows for same `scheme_code+period` before insert → latest upload wins.
- **R2** Bust cached AI insight for that `scheme_code+period` on re-upload.

## Issues
- **#1 Top-10 panel blank ("0.0% of portfolio").** Stale snapshot (old `top_holdings` required an ISIN; PDF rows have none). Current code already filters by non-cash, ISIN optional → fixed; R1 makes re-upload show it. Verify offline.
- **#2 Only ~46%, banks mis-typed as Equity.** (a) Coverage is inherent to the factsheet (top-10 only) → **decision: frame as top-10 + fund-wide breakdowns headline**. (b) Classification: current code types via AI hint (cd/cp/tbill) + RATING_RE fallback → never Equity for rated bank papers; stale data showed Equity. Verify `asset_class=debt`.
- **#3 Category donut illegible + rating-string categories.** (a) Tooltip overlaps centre label → redesign donut tooltip/centre (Palantir). (b) Categories were raw rating strings because stale `asset_class` wasn't debt → with debt, breakdown is by instrument type (CD/T-Bill/CP).
- **#5 AI Interpretation = wall of text.** Redesign → **compact Palantir signal strip** (headline + tagged metric chips + flag pills; expand for detail; ~1vh collapsed). Content also corrects itself once data is fresh.
- **#6 Fund-wide metric KPIs missing.** Metrics absent in stale snapshot → strip didn't render. **Decision: keep the metrics strip separate from the KPI row, redesign it Palantir-style** (compact table: YTM / Macaulay / residual / benchmark / inception / managers).

## Verify (decision: offline pipeline + live UI on curated fund)
- Offline: run full parse→derive on the HDFC holdings, assert no Equity, 10 top-holdings, asset_class=debt, metrics+rating present.
- Live (Terminal AI MCP `app_preview`): view a curated fund to confirm redesigned AI strip / donut / metrics strip render cleanly.
- User re-uploads HDFC PDF to confirm end-to-end.
