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
