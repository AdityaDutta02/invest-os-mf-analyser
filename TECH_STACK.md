# Tech Stack, Rationale, Capabilities & Roadmap

> Machine-readable project brief. One canonical fact per line where possible.
> Product: **Lookr** — Indian MF monthly-portfolio factsheet analyser.
> Host: **Terminal AI** (BaaS: Next.js runtime + isolated Postgres + object storage + AI gateway + cron).
> Live app id: `a0f1e781-1e36-417a-be07-7018aff26437`.
> Companion doc: `MARKET_FIT.md` (audience + positioning). Deep backend spec: `ARCHITECTURE.md`.

---

## 1. Stack at a glance

| Layer | Choice | Version | Why this choice |
|---|---|---|---|
| Framework | Next.js (App Router) | 14.2.15 | Server route handlers + RSC + client components in one deploy unit; matches Terminal AI's `framework: nextjs` contract. |
| Language | TypeScript (strict) | 5.6.3 | Single canonical data contract (`lib/types.ts`) shared server↔client; no `any`. |
| UI runtime | React | 18.3.1 | Client components only where state/effects needed; rest are server components. |
| Styling | Tailwind CSS | 3.4.14 | Palantir-style design tokens via CSS custom properties in `globals.css`. |
| Charts | Recharts | 2.12.7 | Donut/bar viz (`CategoryDonut`, `AssetAllocationBar`, `MarketCapBar`). |
| Icons | lucide-react | 0.451.0 | Lightweight, tree-shakeable. |
| Spreadsheet parse | SheetJS (`xlsx`) | 0.18.5 | Deterministic parse of SEBI monthly-portfolio XLS — the core holdings path. |
| Zip handling | jszip | 3.10.1 | Some AMCs ship portfolios as zip archives; unzip → split → parse. |
| Database | Postgres (Terminal AI managed) | — | Per-app isolated schema; helpers in `lib/db.ts` (`dbList/dbGet/dbInsert/dbUpdate/dbDelete`). |
| Storage | Terminal AI object storage | — | `lib/storage.ts`. Holds transient upload bytes only; never long-term raw files. |
| AI | Terminal AI gateway `/v1/generate` | gateway v2 | `lib/terminal-ai.ts callGateway()`; category `chat`, tier `good`. |
| Doc parse | Terminal AI parse SDK | — | `lib/parse-sdk.ts` — PDF→Markdown/JSON (OCR + optional AI cleanup) for factsheet uploads. |
| Auth | Terminal AI embed token | — | `useEmbedToken()` hook; viewer identity via postMessage. No sign-in flow. |
| Deploy | Coolify Dockerfile build | — | `Dockerfile`; redeploy via Terminal AI MCP (`redeploy_app` → poll `get_deployment_status`). |

No external SaaS (no Supabase/Firebase/Clerk/Neon). Terminal AI supplies DB, storage, auth, AI, cron, email.

---

## 2. Core architecture & data flow

**Canonical contract:** `AnalyseData` in `lib/types.ts`. Every API route and component speaks this one object. Stored as `snapshots.data` jsonb.

```
mfapi.in (identity: amfi_code, isin, amc, category, NAV history)
        │
        ▼
/api/schemes (search)  ──►  user picks scheme  ──►  /api/periods (months in DB)
        │
        ▼
/api/analyse?scheme=&period=
   1. getSnapshot(): DB cache hit?  ── yes ─►  return AnalyseData
                       │ no
                       ▼
   2. lazyIngest(): registry recipe (lib/registry.ts) → plain fetch() XLS
                    → SheetJS parse (lib/parse.ts) → derive → assemble → cache
        │
        ▼
/api/ai/insight  ──►  callGateway()  ──►  AIInsight (descriptive, cached in DB)
```

**Why two acquisition paths.** No public central holdings feed exists (SEBI hosts none; AMFI is JS/RSC-routed; RTAs are login-gated). So holdings come from **SEBI-mandated monthly portfolio XLS** published per-AMC, normalized to one contract.

**Phase 1 — runs entirely on Terminal AI (plain `fetch()`, no browser):**
- ~15 "direct" AMCs have registry recipes (ICICI, PPFAS, HSBC, Quantum, BOI, Groww, Samco, Shriram, NJ, Helios, Old Bridge, Unifi, Capitalmind, Abakkus, Zerodha).
- Recipe strategies: `template` (construct URL, probe month-end days), `listing` (fetch static HTML, regex the hashed filename), `zip` (download + unzip + pick member).
- **Upload escape hatch** for everything else: XLS upload → same deterministic parser; PDF factsheet → parse-sdk text extract + AI structured-extract (only AI-extraction path, flagged `confidence<1`).

**Phase 2 — browser-scrape worker OFF Terminal AI (planned):**
- GitHub Actions monthly cron (allows puppeteer) → headless fetch of JS/bot-gated AMCs → normalize → POST `/api/ingest` (secret-auth).
- Covers Tier-2 (SBI, HDFC, Nippon, UTI, ABSL, Mirae, DSP, Tata, Motilal, etc.) + historical backfill.
- **Terminal AI never scrapes** — it stores, serves, analyses only.

---

## 3. Deterministic derivation (LLM never computes numbers)

| Field | Rule |
|---|---|
| `instrument_type` | Keyword classify from XLS Name/Industry: equity / debt / arbitrage / mm (CP/CD/T-bill) / treps-repo / cash / reit-invit. |
| `deployable_cash` | Σ weight where type ∈ {cash, treps, mm, arbitrage, short debt}. |
| `category_breakdown` | Aggregate weight by SEBI Industry column. |
| `market_cap_breakdown` | Equity ISINs joined to AMFI semi-annual large/mid/small list (equity only; may be `[]`). |
| `total_weight` | Σ all rows; validation gate requires ∈ [99,101]. |

**Validation gate:** `total_weight ∈ [99,101]` AND `holdings_count>0` AND required columns present. Fail → flag/upload (P1) or AI fallback + `ingest_runs` log (P2).

**The AI's job is bounded:** descriptive interpretation only (`app/api/ai/insight/route.ts` SYSTEM prompt). Never advisory, never invents figures, uses only supplied JSON. Output is strict JSON `{headline, sections[], flags[]}`, cached per `scheme_code+period`.

---

## 4. Capabilities (shipped)

| Capability | Surface | Notes |
|---|---|---|
| Single-fund analysis | `/` + `AnalyseView` | Asset allocation, sector/instrument breakdown, market-cap split, cash breakdown, top holdings, full sortable holdings table (internal scroll past 12 rows). |
| Curated fund picker | `CuratedPicker` / `lib/curated.ts` | 4 verified auto-fetch schemes (PPFAS, Helios, Samco, Capitalmind Flexi Cap) — usable without search. |
| Free-text search | `SchemeSearch` | mfapi-backed; **dev-gated** behind `NEXT_PUBLIC_SEARCH_DEV=1` until fully reliable. |
| Period selection | `PeriodPicker` / `/api/periods` | Statuses: `ready` (in DB), `fetchable` (auto-fetch AMC + published month), `upload`. |
| Lazy auto-fetch | `/api/analyse` → `lazyIngest` | Cache-miss triggers registry fetch for direct AMCs; result cached. |
| Upload (XLS) | `/api/upload` + `UploadView` | Deterministic parser; upsert (delete prior `scheme_code+period` rows so re-upload wins). |
| Upload (PDF factsheet) | `/api/upload` | parse-sdk + AI structured-extract; handles top-N-only disclosure (`partial`), rating breakdown, portfolio metrics (YTM/Macaulay/residual/benchmark/inception/managers). |
| AI insight | `AIInsightPanel` | Compact "signal strip": headline + metric chips + flag pills; expand for sections. Descriptive only. |
| Compare | `/api/compare` + `CompareView` | Two snapshots + server-computed deltas (added/exited/increased/reduced, cash/count/equity/AUM deltas, category drift). No parse at request time. |
| Screen | `/api/screen` + `ScreenView` | Cross-fund ranking. Thin until corpus grows (needs Phase-2 breadth). |
| Provenance | `SourceBadge` | Source **org** only (e.g. "HDFC Mutual Fund"); no technical provenance. |
| Health | `/api/health` | Deploy health-check path. |

---

## 5. API endpoints

```
GET  /api/schemes?q=                 mfapi-backed search (proxy + cache)
GET  /api/periods?scheme=            months available / fetchable / upload
GET  /api/analyse?scheme=&period=    AnalyseData (lazy-fetch on miss in P1)
GET  /api/compare?scheme=&a=&b=      two snapshots + computed deltas
GET  /api/screen?category=&metric=   cross-fund ranking (needs corpus)
GET  /api/scheme-meta?...            scheme metadata enrich
POST /api/upload                     XLS/PDF → parse → normalize → cache
GET  /api/health                     deploy health probe
(POST /api/ingest)                   Phase-2 worker push (secret-auth) — planned
```

---

## 6. Security & data constraints (hard rules)

- **No raw-file retention.** Store only normalized JSON. Never persist or display raw PDF/XLS.
- **Attribution to source org only** (AMFI / AMC). No technical provenance leakage.
- **AI is descriptive/analytical, never advisory.** "Not investment advice" disclaimer stays.
- **No secrets in source.** Env only. Embed token never in localStorage/cookies.
- **No headless browser / scraping on Terminal AI.** Any scraping lives in the off-platform Phase-2 worker.
- **No dev/diagnostic routes in the shipped app** (token-gated test pages were removed — treated as a security risk).

---

## 7. Roadmap

**Near-term (Phase 1 hardening):**
1. Re-verify end-to-end debt-fund render (HDFC Liquid PDF, top-N disclosure path).
2. Productionize free-text search; retire `NEXT_PUBLIC_SEARCH_DEV` gate.
3. Complete registry recipes for the remaining direct-fetchable AMCs.
4. AMFI semi-annual large/mid/small list fetch for `market_cap_breakdown`.

**Mid-term (Phase 2 — corpus & breadth):**
5. GitHub Actions monthly worker for JS/bot-gated Tier-2 AMCs → `/api/ingest`.
6. Historical backfill seed (one-time; depth varies per AMC, ~2009–2023+).
7. Screener becomes meaningful once corpus is broad (`top10_concentration`, cash, expense ranking).
8. `/api/holders?isin=` — "which funds hold stock X" (needs corpus).

**Later:**
9. Multi-period trend view per fund (holdings drift over time).
10. Alerting/digests via Terminal AI cron + email SDK.

---

## 8. Key files (navigation map)

| File | Role |
|---|---|
| `lib/types.ts` | Canonical `AnalyseData` + all shared contracts. |
| `lib/ingest.ts` | Orchestrates identity → registry fetch → parse → assemble. Discriminated `IngestResult`. |
| `lib/snapshot.ts` | DB cache → else lazy-fetch; caching is best-effort. |
| `lib/registry.ts` | Per-AMC URL resolver recipes (template/listing/zip). |
| `lib/parse.ts` | SheetJS sheet pick + row build + validate + assemble + derivations. |
| `lib/mfapi.ts` | mfapi.in identity + NAV history (`navOnOrBefore`). |
| `lib/curated.ts` | Curated picker list + `SEARCH_DEV` flag. |
| `lib/db.ts` / `lib/storage.ts` / `lib/terminal-ai.ts` / `lib/parse-sdk.ts` | Terminal AI BaaS helpers. |
| `app/api/*/route.ts` | Route handlers (see §5). |
| `components/AnalyseView.tsx` | Main dashboard composition. |
| `db-migrations.sql` | Postgres schema (amcs/schemes/snapshots/holdings/ingest_runs). |
| `ARCHITECTURE.md` | Full backend spec + dead-ends + phases. |
