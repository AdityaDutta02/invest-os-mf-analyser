// Shared write path for the multi-AMC corpus (M1). Reuses the exact
// "purge-then-insert" upsert pattern app/api/upload/route.ts already uses
// (the gateway DB has no native upsert) and fans the same normalized
// AnalyseData out to the search-support tables added in db-migrations.sql.
import { dbInsert, dbList, dbDelete } from "./db";
import type { AnalyseData } from "./types";

export interface IngestRunLog {
  amc_name: string;
  scheme_code: string | null;
  period: string;
  status: "success" | "not_published" | "parse_failed" | "transient";
  source_url?: string;
  error?: string;
  run_id?: string;
}

async function purge(table: string, filters: Record<string, string>, token: string): Promise<void> {
  try {
    const rows = await dbList<{ id: string }>(table, filters, token);
    await Promise.all(rows.map((r) => dbDelete(table, r.id, token).catch(() => {})));
  } catch {
    /* best-effort */
  }
}

// Records one ingest attempt. Upsert-by-purge on (amc_name, scheme_code,
// period) so re-running a period (e.g. re-ingest after a parser fix) never
// accumulates duplicate ledger rows.
export async function logIngestRun(log: IngestRunLog, token: string): Promise<void> {
  await purge("ingest_runs", { amc_name: log.amc_name, scheme_code: log.scheme_code ?? "", period: log.period }, token);
  try {
    await dbInsert("ingest_runs", { ...log }, token);
  } catch {
    /* best-effort */
  }
}

// Has this (amc, scheme, period) already been ingested successfully?
// Used by the cron/worker to skip re-parsing already-done tuples.
export async function alreadyIngested(amcName: string, schemeCode: string, period: string, token: string): Promise<boolean> {
  try {
    const rows = await dbList<{ status: string }>("ingest_runs", { amc_name: amcName, scheme_code: schemeCode, period }, token);
    return rows.some((r) => r.status === "success");
  } catch {
    return false;
  }
}

// Writes a parsed+normalized snapshot into the full corpus: snapshots
// (source of truth), schemes (identity dimension), holdings_index (sparse
// ISIN search), securities (name->ISIN dimension). Mirrors the upload
// route's snapshot write, plus the new search-support fan-out.
export async function writeSnapshot(
  amcName: string,
  schemeCode: string,
  period: string,
  data: AnalyseData,
  source: string,
  token: string,
): Promise<void> {
  await purge("snapshots", { scheme_code: schemeCode, period }, token);
  await purge("ai_cache", { scheme_code: schemeCode, period }, token);
  await dbInsert("snapshots", { scheme_code: schemeCode, period, source, data }, token);

  await purge("schemes", { scheme_code: schemeCode }, token);
  await dbInsert(
    "schemes",
    {
      scheme_code: schemeCode,
      amc_name: amcName,
      scheme_name: data.scheme_name,
      isin: data.isin || null,
      category: data.category,
      asset_class: data.asset_class,
    },
    token,
  );

  await purge("holdings_index", { scheme_code: schemeCode, period }, token);
  const equityHoldings = data.holdings.filter((h) => h.isin && /equity/i.test(h.instrument_type));
  await Promise.all(
    equityHoldings.map((h) =>
      dbInsert("holdings_index", { isin: h.isin, scheme_code: schemeCode, period, weight: h.weight }, token).catch(() => {}),
    ),
  );

  await Promise.all(
    equityHoldings.map(async (h) => {
      const existing = await dbList<{ id: string }>("securities", { isin: h.isin }, token).catch(() => []);
      if (existing.length === 0) await dbInsert("securities", { isin: h.isin, name: h.name }, token).catch(() => {});
    }),
  );
}
