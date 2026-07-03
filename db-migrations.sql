-- Runs once at deploy time against the app's isolated Postgres schema.
-- Stores ONLY normalized JSON snapshots (never raw PDFs/XLS). Provenance is the
-- source organisation only.

CREATE TABLE IF NOT EXISTS snapshots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_code TEXT NOT NULL,            -- mfapi scheme code, or "upload-<hash>"
  period      TEXT NOT NULL,            -- "YYYY-MM"
  source      TEXT,                     -- 'fetch' | 'upload'
  data        JSONB NOT NULL,           -- full normalized AnalyseData contract
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scheme_code, period)
);
CREATE INDEX IF NOT EXISTS snapshots_scheme_idx ON snapshots (scheme_code);

CREATE TABLE IF NOT EXISTS ai_cache (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_code TEXT NOT NULL,
  period      TEXT NOT NULL,
  insight     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scheme_code, period)
);

-- Cached scheme identity (category, NAV, ISIN, inception) from mfapi.
CREATE TABLE IF NOT EXISTS scheme_meta (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_code TEXT NOT NULL,
  data        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scheme_code)
);
CREATE INDEX IF NOT EXISTS scheme_meta_code_idx ON scheme_meta (scheme_code);

-- ── Full-searchability corpus (multi-AMC ingest) ────────────────────────
-- Additive to the above. snapshots.data stays the source of truth per
-- scheme+period; these support cross-fund/cross-period lookups the DB
-- gateway's exact-match-only filters can't do against a JSONB blob.

CREATE TABLE IF NOT EXISTS amcs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL UNIQUE,
  slug             TEXT NOT NULL UNIQUE,
  registry_status  TEXT,                 -- 'verified' | 'pending'
  fetch_method     TEXT,                 -- 'direct' | 'needs_js' | 'needs_form'
  archive_depth    TEXT,                 -- free text, e.g. "2013->present"
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schemes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_code  TEXT NOT NULL UNIQUE,     -- mfapi code, or "upload-<hash>"
  amc_name     TEXT NOT NULL,
  scheme_name  TEXT NOT NULL,
  isin         TEXT,
  category     TEXT,
  asset_class  TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS schemes_amc_idx ON schemes (amc_name);

-- One row per (amc, scheme, period) ingest attempt. Resumability ledger for
-- a multi-week backfill: the worker/cron diffs its target list against
-- rows already 'success' here instead of re-fetching/re-parsing.
CREATE TABLE IF NOT EXISTS ingest_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amc_name     TEXT NOT NULL,
  scheme_code  TEXT,                     -- null when the attempt failed pre-scheme
  period       TEXT NOT NULL,            -- "YYYY-MM"
  status       TEXT NOT NULL,            -- 'success' | 'not_published' | 'parse_failed' | 'transient'
  source_url   TEXT,
  error        TEXT,
  run_id       TEXT,                     -- GitHub Actions run id, for cross-referencing logs
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (amc_name, scheme_code, period)
);
CREATE INDEX IF NOT EXISTS ingest_runs_amc_period_idx ON ingest_runs (amc_name, period);

-- Sparse index: only (isin, scheme_code, period, weight) so "which funds
-- held ISIN X, and when" is a cheap exact-match dbList — not a full
-- per-holding table (that would be ~9M rows at 5yr x 50 AMCs).
CREATE TABLE IF NOT EXISTS holdings_index (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  isin         TEXT NOT NULL,
  scheme_code  TEXT NOT NULL,
  period       TEXT NOT NULL,
  weight       NUMERIC,
  UNIQUE (isin, scheme_code, period)
);
CREATE INDEX IF NOT EXISTS holdings_index_isin_idx ON holdings_index (isin);
CREATE INDEX IF NOT EXISTS holdings_index_scheme_period_idx ON holdings_index (scheme_code, period);

-- Small dimension for name->ISIN resolution. Pulled wholesale into memory
-- and fuzzy-matched in Node (the DB gateway has no ILIKE/trgm operator).
CREATE TABLE IF NOT EXISTS securities (
  isin        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
