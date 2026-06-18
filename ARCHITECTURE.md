# MF Factsheet Analyser — Backend Architecture (FINAL)

Platform: Terminal AI (Next.js app + Postgres + storage + AI gateway + cron).
Constraint: Terminal AI runtime allows plain `fetch()` but **no headless browser**.
Strategy: 2-phase. Holdings come from SEBI-mandated monthly portfolio spreadsheets (XLS), normalized to one canonical contract.

---

## Locked stack

| Layer | Source | Notes |
|---|---|---|
| Scheme master, search, AMFI code, ISIN, NAV history | **mfapi.in** (`api.mfapi.in`) | free, no key, 6x/day, 5yr+ history. Identity + NAV layer. |
| ISIN → Kuvera enrichment (optional) | mf.captnemo.in | CORS, plain fetch |
| Holdings / weights / sector | **AMC monthly portfolio XLS** (registry) | the only reliable holdings source; no public API/SEBI/AMFI central feed exists |
| Storage | normalized JSON only | no raw PDF/XLS retained, no rehosting |
| Provenance shown | source org only (e.g. "HDFC Mutual Fund") | no technical provenance |

Confirmed dead ends (do not pursue): SEBI hosts no portfolio repo; AMFI is JS/RSC routing-only; RTAs (CAMS/KFintech/MFCentral) are investor-login gated; free holdings APIs (mfdata.in) are down/unreliable.

---

## Phases

### Phase 1 — plain fetch + upload (runs entirely on Terminal AI)
- **mfapi search** → user picks scheme → identity {amfi_code, isin, amc, name, category}.
- **Lazy fetch on cache-miss** for the ~15 plain-fetch AMCs (registry `fetch:"direct"`):
  ICICI, PPFAS, HSBC, Quantum, Bank of India, Groww, Samco, Shriram, NJ, Helios, Old Bridge, Unifi, Capitalmind, Abakkus, Zerodha.
  Flow: registry recipe → plain `fetch()` of XLS (or `fetch()` static HTML listing + regex to get hashed filename) → SheetJS parse → normalize → cache to DB.
- **Upload escape-hatch** for everything else:
  - SEBI portfolio **XLS** upload → same deterministic parser (preferred).
  - Factsheet **PDF** upload → PDF text extract + AI gateway structured-extract → normalize (the only AI-extraction path; flagged `confidence<1`).
- No browser, no scraping. Covers PPFAS (original app's fund) + ICICI (top-3 AUM) + 13 more on day one; all others via upload.

### Phase 2 — browser-scrape worker (OFF Terminal AI)
- **GitHub Actions** monthly cron (free, allows puppeteer/headless):
  registry recipes → headless fetch of JS/bot-gated AMCs → unzip/split → SheetJS parse → normalize → **push to Terminal AI `/api/ingest`** (authenticated).
- Covers Tier-2: SBI, HDFC, Nippon, UTI, ABSL, Mirae, DSP, Tata, Motilal, Canara, Invesco, Angel One, Choice, Jio BlackRock, Wealth Co + the 19 pending AMCs once registry is completed.
- Terminal AI still **never scrapes** — it only stores + serves + analyses. Also seeds historical backfill (depth per AMC: ABSL ~2009, Nippon 2013, Quantum 2011, most ~2023+).

---

## DB schema (Postgres, `db-migrations.sql`)

```sql
create table amcs (id serial primary key, name text, slug text unique, source_url text, tier int); -- tier 1|2

create table schemes (
  id serial primary key, amc_id int references amcs(id),
  name text, isin text, amfi_code int, category text, asset_class text, slug text unique);

create table snapshots (
  id serial primary key, scheme_id int references schemes(id),
  period text,            -- "2025-05"
  as_of_date date, source_org text, source_url text,
  aum numeric, nav numeric, expense_ratio numeric,
  holdings_count int, total_weight numeric, deployable_cash numeric,
  data jsonb,             -- full normalized contract
  confidence numeric default 1, source text,   -- 'fetch'|'upload'|'worker'
  created_at timestamptz default now(),
  unique(scheme_id, period));

create table holdings (
  id serial primary key, snapshot_id int references snapshots(id) on delete cascade,
  name text, isin text, instrument_type text, sector text,
  weight numeric, market_value numeric, quantity numeric);
create index on holdings(isin);
create index on holdings(snapshot_id);
create index on snapshots(scheme_id, period);

create table ingest_runs (id serial primary key, amc_id int, period text, status text, parser text, error text, created_at timestamptz default now());
```

---

## Normalized contract (`snapshots.data` jsonb) — canonical object served everywhere

```jsonc
{
  "scheme_name","amc_name","category","isin","asset_class",
  "period":"2025-05","period_label":"May 2025","as_of_date":"2025-05-31",
  "source_org":"HDFC Mutual Fund","source_url":"https://...",
  "aum":null,"nav":null,"expense_ratio":null,
  "holdings_count":73,"total_weight":100.0,"deployable_cash":8.4,
  "asset_allocation":[{"name":"Equity","weight":91.6}],
  "category_breakdown":[{"name":"Banking & Finance","weight":22.1}],
  "market_cap_breakdown":[{"name":"Large","weight":60.2}],
  "cash_breakdown":[{"section":"TREPS","weight":5.1}],
  "top_holdings":[{"name","isin","sector","weight"}],
  "holdings":[{"name","isin","instrument_type","sector","weight","market_value","quantity"}]
}
```

---

## Derivation rules (deterministic; LLM never computes numbers)

- **instrument_type** from XLS Name/Industry keywords: equity (incl. foreign), debt, arbitrage, mm (CP/CD/T-bill), treps/repo, cash (net receivables), reit/invit.
- **deployable_cash** = Σ weight where type ∈ {cash, treps, mm, arbitrage, short debt}.
- **category_breakdown** = aggregate weight by XLS Industry column (SEBI-standard).
- **market_cap_breakdown** = equity ISINs joined to AMFI semi-annual large/mid/small list.
- **total_weight** = Σ all rows (sanity ≈100).

## Parser handles 3 packaging shapes
single all-schemes workbook · per-scheme files · ZIP archive → download → unzip if zip → split workbook by scheme → parse SEBI columns (`Name · ISIN · Industry/Rating · Quantity · Market Value · % to NAV`).

## Validation gate
total_weight ∈ [99,101]; holdings_count>0; required columns present. Fail → (P1) flag/upload; (P2) AI fallback + log to ingest_runs.

---

## API endpoints (Next.js route handlers)

```
GET  /api/schemes?q=                 → mfapi-backed search (proxy + cache)
GET  /api/periods?scheme=            → months available in DB
GET  /api/analyse?scheme=&period=    → snapshot contract (lazy-fetch on miss in P1)
GET  /api/compare?scheme=&a=&b=      → two snapshots + computed deltas
GET  /api/screen?category=&metric=   → cross-fund ranking (P2+, needs corpus)
GET  /api/holders?isin=&period=      → funds holding stock X (P2+)
POST /api/upload                     → user XLS/PDF → parse → normalize → cache
POST /api/ingest   (secret-auth)     → Phase-2 worker pushes normalized snapshots
```

`compare` computes deltas at read time from stored snapshots (per-holding delta, cash movement, added/removed/increased/reduced, category drift) — no parsing at request time.

---

## Deferred / open
1. Complete registry for 19 pending AMCs (Phase 2 prep).
2. AMFI market-cap list fetch (only for market_cap_breakdown).
3. Confirm SheetJS bundles in Terminal AI runtime; PDF lib for upload path.
4. Backfill historical seed (Phase 2 worker, one-time).
