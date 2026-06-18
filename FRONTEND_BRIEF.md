# Frontend Design Brief — Indian Mutual Fund Factsheet Analyser

> Hand this whole file to the frontend agent. It is self-contained. Reference implementation lives in `reference/original/` (verbatim source recovered from the app we are reimagining). Backend contract is in `ARCHITECTURE.md`; view/AI spec in `DASHBOARD.md`.

---

## 1. Mission

Build the **frontend** for a web app that reads Indian mutual fund monthly portfolio data and presents it as an instant, skimmable research dashboard with an AI interpretation layer. The original (`reference/original/`) only handled one fund (PPFAS Flexi Cap) via PDF upload. **We generalise to any Indian MF scheme**, sourced from a database, with upload as a fallback.

Keep the original's distinctive **terminal / research-desk aesthetic**. Do not drift to generic SaaS or "AI app" looks.

Deliver production-grade React (Next.js App Router) components, fully styled, wired to the data contract in §6, with all states handled (§7).

---

## 2. Tech stack (fixed)

- **Next.js (App Router)** + React, TypeScript.
- **Tailwind CSS** for styling (original used Tailwind utility classes — preserve them).
- **shadcn/ui** primitives for tabs, table, tooltip, button, sonner (toasts) — original used these (Radix under the hood).
- **recharts** for charts (donut/bars) — original used it.
- **@phosphor-icons/react** for icons (original icon set: ChartLine, Stack, GitDiff, Lightning, ArrowClockwise, UploadSimple, Warning, Info, CaretUpDown, ArrowUp/Down, FilePdf, X).
- Fonts: **Chivo** (display, weights 300/400/700/900) and **IBM Plex Mono** (mono, 300–700). Inter only as fallback.
- Server Components by default; `'use client'` only for interactive views (search, upload, sort, tab state).

---

## 3. Design system (extracted exactly from `reference/original/`)

### Colour tokens
| Token | Hex | Use |
|---|---|---|
| bg | `#050505` | page background |
| surface | `#0A0A0C` | cards, toasts |
| accent (gold) | `#EAB308` | primary accent, active states, CTA |
| accent-hover | `#FBBF24` | CTA hover |
| positive (green) | `#22C55E` | live dot, gains, "added/increased" |
| border | `rgba(255,255,255,0.10)` | hairline borders |
| text | `#FFFFFF` / `#FAFAFA` | primary text |
| text-dim | `zinc-400` | body copy |
| text-mute | `zinc-500 / 600` | labels, footnotes |

Category/sector palette (keep this colour language; generalise the names):
gold `#EAB308`, blue `#3B82F6`, pink `#EC4899`, emerald `#10B981`, orange `#F97316`, violet `#8B5CF6`, grey `#71717A` (cash), green `#22C55E` (others). See `reference/original/format.js`.

### Type & shape
- Display headings: Chivo, `font-black`, tight tracking, large (hero up to `text-6xl`).
- Labels/meta: IBM Plex Mono, **uppercase**, wide letter-spacing (`tracking-[0.2em]`–`[0.3em]`), tiny (`text-[10px]`–`text-xs`).
- **Square corners everywhere** (`rounded-none`). No soft radii.
- Hairline 1px borders (`border-white/10`), generous dark negative space, dense data tables.
- Max content width `1400px`, `px-6` gutters.
- Layout primitives to reuse: sticky header (gold square logo + title + "live · v1.0"), hero (headline + mono subcopy), underline-style tabs (active = gold bottom-border), footer with mono disclaimers.

Study `reference/original/App.js` for the header/hero/tabs/footer markup and exact classes — **reuse them**, only changing copy (see §8).

---

## 4. Information architecture (4 views)

Top-level tabs (underline style, like original):

1. **Analyse** (single month) — primary.
2. **Compare** (two months).
3. **Screen** (cross-fund) — Phase 2; build the shell + empty state now, wire later.
4. **Upload** — escape-hatch (XLS or factsheet PDF).

Above the tabs sits a **fund context bar**: SchemeSearch (select fund) + PeriodPicker. Selecting a fund + month drives Analyse/Compare. (Original jumped straight to upload; we add search-first.)

Full per-view data points are in `DASHBOARD.md §View 0–3`. Summary below.

---

## 5. Components

### Reuse / re-skin from reference (`reference/original/`)
- **Header / Hero / Tabs / Footer** — from `App.js`.
- **SingleMonthView** composition — from `SingleMonthView.jsx` (KPI grid → charts row → holdings table).
- **KpiTile** — `{label, value, hint, tooltip?, accent?}`. Mono uppercase label, big value, dim hint, optional info-tooltip, gold left-accent when `accent`.
- **CategoryDonut** — recharts donut of `{name, weight}[]`, legend, uses category palette.
- **TopHoldings** — ranked list of top 10 `{name, weight, sector}`.
- **HoldingsTable** — sortable table (click column header; CaretUpDown icons), columns: name · isin · type · sector · weight.
- **ChangesList** — four buckets (Added / Exited / Increased / Reduced) with coloured deltas.
- **UploadZone** — drag/drop + click, `{label, sublabel, file, onFile, disabled}`.
- **ProgressTerminal** — faux-terminal loading log shown while analysing.
- shadcn ui: button, tabs, table, tooltip, sonner.

### New components to build
- **SchemeSearch** — async autocomplete on `GET /api/schemes?q=`; result row: scheme name · AMC · category · latest NAV. Mono, dark, keyboard-navigable.
- **PeriodPicker** — choose month (single) or month A + month B (compare) from `GET /api/periods?scheme=`; show "no data — upload" when empty.
- **AssetAllocationBar** — horizontal stacked bar of `asset_allocation` (equity/debt/cash).
- **MarketCapBar** — large/mid/small split (equity funds only; hide otherwise).
- **SourceBadge** — "Sourced from {source_org}" + `as_of_date`. Subtle, mono. No technical provenance.
- **AIInsightPanel** — renders structured AI JSON (§ DASHBOARD AI #1/#2). Header chip "AI INTERPRETATION", bullet sections, collapsible. Must visually read as *commentary*, distinct from hard data tiles.
- **ScreenTable** (Phase 2) — ranked fund table; build with empty/"coming soon" state now.

Every interactive element keeps `data-testid` attributes (original convention) for testing.

---

## 6. Data contract (what every view receives)

Single source of truth object (`GET /api/analyse?scheme=&period=`):

```jsonc
{
  "scheme_name": "Parag Parikh Flexi Cap Fund",
  "amc_name": "PPFAS Mutual Fund",
  "category": "Flexi Cap",
  "isin": "INF879O01027",
  "asset_class": "equity",                 // equity | debt | hybrid | other
  "period": "2025-05",
  "period_label": "May 2025",
  "as_of_date": "2025-05-31",
  "source_org": "PPFAS Mutual Fund",
  "source_url": "https://...",
  "aum": 65432.1,                          // ₹ cr, may be null
  "nav": 78.91,                            // may be null
  "expense_ratio": 0.63,                   // may be null
  "holdings_count": 73,
  "total_weight": 100.0,
  "deployable_cash": 8.4,                  // %
  "asset_allocation":     [{ "name": "Equity", "weight": 91.6 }, { "name": "Cash", "weight": 8.4 }],
  "category_breakdown":   [{ "name": "Banking & Finance", "weight": 22.1 }],   // sector
  "market_cap_breakdown": [{ "name": "Large", "weight": 60.2 }],               // equity only; may be []
  "cash_breakdown":       [{ "section": "TREPS", "weight": 5.1 }],
  "top_holdings":         [{ "name": "...", "isin": "...", "sector": "...", "weight": 7.2 }],
  "holdings":             [{ "name", "isin", "instrument_type", "sector", "weight", "market_value", "quantity" }]
}
```

Compare (`GET /api/compare?scheme=&a=&b=`) returns both snapshots plus computed deltas:
```jsonc
{
  "a": <contract>, "b": <contract>,
  "kpis": { "cash_delta": 1.2, "count_delta": 3, "equity_delta": -0.8, "aum_delta": 1234 },
  "changes": { "added": [...], "exited": [...], "increased": [...], "reduced": [...] },  // each {name, isin, weight_a, weight_b, delta}
  "category_drift": [{ "name": "IT", "delta": 1.4 }]
}
```

AI insight objects (rendered by AIInsightPanel) — shapes in `DASHBOARD.md` AI #1/#2.

Build against these shapes with **mock fixtures** first (provide a `lib/mock.ts` with one equity fund, one debt/liquid fund, one compare pair). Null-handle `aum/nav/expense_ratio` and empty `market_cap_breakdown` gracefully (show "—").

---

## 7. States to handle (every view)

- **Idle / no fund selected** — prompt to search a fund.
- **No data for month** — "No stored data for {month}. Upload the factsheet/portfolio to analyse." → links to Upload.
- **Loading** — ProgressTerminal (faux log lines, e.g. "fetching portfolio…", "parsing holdings…", "classifying instruments…").
- **Error** — sonner toast (dark, square, mono) + inline message; surface `detail`/message.
- **Empty AI** — if AI insight unavailable, show data without the panel (never block data on AI).
- **Equity vs non-equity** — hide MarketCapBar for debt/liquid; relabel sector breakdown sensibly.
- **Upload progress / parse failure** — clear feedback; PDF path may take longer (AI extraction).

---

## 8. Generalisation changes from the original (do these)

- Header title `PPFAS · FACTSHEET ANALYSER` → generic, e.g. **`MF · FACTSHEET ANALYSER`**; subtitle becomes the selected fund (`{scheme_name} · {category}`) once chosen.
- Hero subcopy: drop "PPFAS Flexi Cap PDF"; → "Search any Indian mutual fund. Get the portfolio, category mix, deployable cash, and month-on-month deltas — without spreadsheets."
- UploadZone copy `DROP PPFAS FACTSHEET PDF` → "DROP ANY MF FACTSHEET / PORTFOLIO"; accept `.pdf,.xls,.xlsx`.
- Results header shows detected **fund name + AMC + period** (new), plus SourceBadge.
- Keep footer disclaimers verbatim: "Built for serious investors · No login · No data stored" and "Not investment advice · Verify against official factsheet".

---

## 9. Responsive & a11y

- Mobile-first; KPI grid `grid-cols-1 md:grid-cols-4`; charts stack on mobile; tables horizontally scrollable.
- Keyboard: search + tabs + sortable headers fully operable; visible focus rings (gold).
- Colour is never the only signal (deltas also use +/− and arrows).
- Respect contrast on the dark theme; mute greys must stay legible.

---

## 10. Deliverables expected from the frontend agent

1. Next.js + Tailwind project skeleton with the theme tokens wired (Tailwind config + globals).
2. All components in §5 (reused re-skinned + new), TypeScript, with props typed to §6.
3. The 4 views assembled with the fund context bar, fully styled, all §7 states.
4. `lib/mock.ts` fixtures + a storybook-style demo page rendering each view from mocks (so design is reviewable with no backend).
5. AIInsightPanel rendering from mock AI JSON.
6. Notes on any component that needs backend shape clarification.

## 11. Out of scope (do not build)
- Backend, ingestion, parsing, mfapi calls, AI gateway — all separate (ARCHITECTURE.md). Frontend talks only to the documented `/api/*` shapes and works fully on mocks.
- Auth/login (none — Terminal AI embed handles identity).
- Storing or displaying raw PDFs.
