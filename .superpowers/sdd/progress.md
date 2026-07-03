# Progress — full searchability plan (iridescent-percolating-swing.md)

M0: complete — confirmed via get_sdk_docs (no live spike needed): DB insert/update single-row only, dbList equality-only filters, /db/* capped 600/min.
M1: complete (schema + cron ingest route) — but redesigned mid-implementation: dropped secret-bearer /api/ingest (DB gateway has no static service-token path, only viewer/task tokens), replaced with `/api/cron/ingest` fed by a Terminal AI create_scheduled_task callback (task token). Schema additions (amcs, schemes, ingest_runs, holdings_index, securities) added to db-migrations.sql. lib/ingest-write.ts (writeSnapshot/logIngestRun/alreadyIngested) added, reusing upload route's purge-then-insert pattern. app/api/cron/ingest/route.ts added — processes CURATED scheme list (4 schemes) via existing lib/registry.ts recipes + lib/ingest.ts parseWorkbook, current period by default. Build + tsc clean.
  Follow-up not yet done: per-AMC scheme discovery (currently only CURATED's 4 codes or an explicit payload list — not all schemes under the 13 direct AMCs). Task not yet registered via create_scheduled_task (needs a deployed app_id).
M2 (worker for direct AMCs): effectively folded into M1's cron route — no separate GitHub Actions worker needed for the 13 direct-fetch AMCs.
M3 (Playwright worker + backfill): not started.
M4 (registry completion): not started.
M5 (/api/search): not started.
M6 (search UI): not started.
