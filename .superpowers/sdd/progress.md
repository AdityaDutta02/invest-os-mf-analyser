# Progress — full searchability plan (iridescent-percolating-swing.md)

M0: complete — confirmed via get_sdk_docs (no live spike needed): DB insert/update single-row only, dbList equality-only filters, /db/* capped 600/min.
M1: complete (schema + cron ingest route) — but redesigned mid-implementation: dropped secret-bearer /api/ingest (DB gateway has no static service-token path, only viewer/task tokens), replaced with `/api/cron/ingest` fed by a Terminal AI create_scheduled_task callback (task token). Schema additions (amcs, schemes, ingest_runs, holdings_index, securities) added to db-migrations.sql. lib/ingest-write.ts (writeSnapshot/logIngestRun/alreadyIngested) added, reusing upload route's purge-then-insert pattern. app/api/cron/ingest/route.ts added — processes CURATED scheme list (4 schemes) via existing lib/registry.ts recipes + lib/ingest.ts parseWorkbook, current period by default. Build + tsc clean.
  Task not yet registered via create_scheduled_task. Live app_id = a0f1e781-1e36-417a-be07-7018aff26437 (Lookr, channel Invest OS, deploys from branch main) — nothing pushed/merged/deployed yet, all work is on worktree-full-searchability, unpushed.
M2 (full scheme discovery + worker for direct AMCs): complete. lib/discover.ts enumerates all schemes per direct AMC via mfapi search (no bulk-by-AMC endpoint exists) + de-dupe to one Direct-Growth code per scheme. Wired into /api/cron/ingest as default candidate set (was: 4 curated only), capped per invocation via `limit` (default 20), skips already-'success' ingest_runs tuples so backlog drains over repeat scheduled runs. No separate GitHub Actions worker needed for these 13 (plain fetch, no bot-gating).
Scope note: user confirmed target is "since 2020" (not just 5yr) — plan doc's backfill milestones (M3) should target back to 2020 where each AMC's archive_depth allows.
M3 (Playwright worker + backfill): not started.
M4 (registry completion): not started.
M5 (/api/search): not started.
M6 (search UI): not started.
