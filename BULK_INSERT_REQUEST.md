# Request: bulk-insert endpoint on the DB gateway

## Why
App "Lookr" (appId `a0f1e781-1e36-417a-be07-7018aff26437`) needs to load a one-time
historical backfill of ~28,200 disclosure files (parsed into an unknown-but-large number
of scheme×period snapshot rows, plus dimension rows for schemes/securities/scheme_latest).
The current `/db/*` gateway only accepts one row per HTTP call, so a backfill of this size
is millions of HTTP round-trips even before hitting the existing 600 calls/min per
app+viewer rate limit. A bulk-insert endpoint removes the bottleneck at its root instead of
just running more (rate-limited) small calls faster.

## Ask
Add one endpoint, mirroring the existing single-row insert:

```
POST {GATEWAY_URL}/db/<table>/bulk
Authorization: Bearer <embed token | task token>
Content-Type: application/json

{ "rows": [ { ...row1 }, { ...row2 }, ... ] }
```

Response, mirroring single-row insert shape:
```
200 OK
{ "inserted": [ { ...row1WithId }, { ...row2WithId }, ... ], "errors": [ { "index": 3, "error": "unique_violation" }, ... ] }
```

## Requirements
- **Same auth model as today** — embed token or task token, same per-app schema
  isolation. No new credential type needed.
- **Partial success, not all-or-nothing** — a duplicate/unique-violation on row 500 of
  2000 should not fail rows 1-499 and 501-2000. Return per-row success/error so the
  caller can treat unique-violations as "already written" and move on (this backfill is
  idempotent/resumable by design).
- **Batch size cap** — whatever the gateway's request-body size limit already implies is
  fine (suggest starting at 500-1000 rows/call to stay well under it); the caller will
  chunk to whatever cap is set.
- **Counts against the same 600/min bucket, but as ONE call** — a 1000-row bulk insert
  should cost 1 call against the rate limit, not 1000. That's the entire point.
- **Same validation as row-by-row insert** — whatever column/type checks the existing
  single insert does, apply per-row here too.

## Tables this will hit (from app's own `db-migrations.sql`)
`snapshots` (JSONB payload, largest volume), `schemes`, `securities`, `scheme_latest`. No
change to schema is being asked for — same tables, same columns, just batched insert.

## Fallback if this can't be built soon
If a bulk endpoint isn't feasible in the near term, the next-best asks (in order) are a
temporary rate-limit exception for this app+viewer during the migration window, or a
long-lived non-embed service credential so a local script can drive existing single-row
inserts continuously without a 15-minute token refresh loop — but both leave the
row-per-call bottleneck in place and would take substantially longer to drain the
backlog. Bulk insert is the actual fix.
