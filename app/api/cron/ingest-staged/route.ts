// M3 write side: pulls files the GitHub Actions worker (worker/) staged on
// the `data-staging` branch (plain HTTPS, no token needed for a public
// repo) and parses+writes them through the exact same path
// app/api/upload/route.ts and app/api/cron/ingest/route.ts use. Registered
// as a Terminal AI scheduled task (task token in Authorization) — the same
// "pull, don't push" design as /api/cron/ingest, for the same reason: the
// DB gateway has no static service credential an external worker could
// present, only viewer/task tokens.
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { buildFromRows, pickSheet, validate } from "@/lib/parse";
import { assemble } from "@/lib/parse";
import { detectPeriod, detectName, hashCode, synthIdentity } from "@/lib/detect";
import { writeSnapshot, logIngestRun, alreadyIngested, getIngestCursor, setIngestCursor } from "@/lib/ingest-write";
import { navOnOrBefore } from "@/lib/mfapi";
import { searchSchemes } from "@/lib/mfapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CURSOR_KEY = "staged_manifest";
const GITHUB_REPO = "AdityaDutta02/invest-os-mf-analyser";
const STAGING_BRANCH = "data-staging";
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_REPO}/${STAGING_BRANCH}`;

interface ManifestEntry {
  amc: string;
  source_url: string;
  link_text: string;
  staged_path: string;
  format: string;
  packaging: string;
}

interface CronPayload {
  limit?: number;
}

// Lowered from 15 for the same reason as /api/cron/ingest — writeSnapshot's
// per-holding fan-out to holdings_index/securities makes each scheme cost
// far more than one gateway round trip. See lib/ingest-write.ts. The
// BUDGET_MS wall-clock guard below is the real backstop.
// Lowered from 5, same rationale as /api/cron/ingest.
const DEFAULT_LIMIT = 3;
// Same rationale as /api/cron/ingest's BUDGET_MS — bail out with time to
// spare so the route always returns instead of risking a mid-request kill.
// Lowered from 40s to leave more headroom below the callback's real ceiling.
const BUDGET_MS = 25_000;

// Neither of these fetches had a timeout — the try/catch below only guards
// against a real network error, not a hang. fetchManifest in particular
// runs once at the very top of the route, before BUDGET_MS's first check;
// a stalled connection to GitHub raw content would block the whole
// invocation indefinitely with no internal bail-out, which is consistent
// with ingest-staged still failing on live runs after both the route-level
// (a4bbb60c) and mfapi.ts (cfada772) timeout fixes — neither touched this
// path. Same 8s AbortController pattern as lib/registry.ts's fetchBuf.
const RAW_FETCH_TIMEOUT_MS = 8000;

async function fetchManifest(): Promise<ManifestEntry[]> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), RAW_FETCH_TIMEOUT_MS);
    const res = await fetch(`${RAW_BASE}/staging/manifest.json`, { cache: "no-store", signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return [];
    return (await res.json()) as ManifestEntry[];
  } catch {
    return [];
  }
}

async function fetchStagedFile(stagedPath: string): Promise<ArrayBuffer | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), RAW_FETCH_TIMEOUT_MS);
    const res = await fetch(`${RAW_BASE}/staging/${stagedPath}`, { cache: "no-store", signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

// Best-effort resolve a scraped scheme name to a real mfapi scheme_code (so
// it shares identity/search with the fetch/upload paths); falls back to a
// synthetic code — same "trust the file, never mislabel" rule as upload.
async function resolveIdentity(amcName: string, guessedName: string) {
  try {
    const matches = await searchSchemes(guessedName);
    const hit = matches.find((m) => m.amc_name === amcName);
    if (hit) {
      return {
        scheme_code: hit.id,
        scheme_name: hit.scheme_name,
        amc_name: amcName,
        fund_house: amcName,
        category: hit.category,
        asset_class: hit.asset_class,
        isin: "",
        latest_nav: hit.nav,
        latest_nav_date: null,
        inception_date: null,
      };
    }
  } catch {
    /* fall through to synthetic */
  }
  const code = `upload-${hashCode(guessedName + amcName)}`;
  return synthIdentity(code, guessedName, amcName);
}

// Parses+writes one workbook buffer (a standalone file, or one member of a
// multi-scheme zip archive). `dedupeKey` scopes the "already done" check —
// for zip members it's the member's own path so re-ingesting the same
// archive skips only the schemes already written, not the whole zip.
async function processWorkbook(
  amcName: string,
  buf: ArrayBuffer,
  sourceUrl: string,
  hintName: string,
  dedupeKey: string,
  token: string,
): Promise<string> {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  } catch {
    await logIngestRun({ amc_name: amcName, scheme_code: null, period: "unknown", status: "parse_failed", error: "unreadable workbook", source_url: sourceUrl }, token);
    return "unreadable";
  }
  const sheet = pickSheet(wb, "");
  if (!sheet) {
    await logIngestRun({ amc_name: amcName, scheme_code: null, period: "unknown", status: "parse_failed", error: "no holdings table", source_url: sourceUrl }, token);
    return "no_holdings_table";
  }
  const parsed = buildFromRows(sheet.rows);
  if (!parsed.ok || !validate(parsed.data).ok) {
    await logIngestRun({ amc_name: amcName, scheme_code: null, period: "unknown", status: "parse_failed", error: "validation failed", source_url: sourceUrl }, token);
    return "validation_failed";
  }
  const det = detectPeriod(sheet.rows);
  const period = det?.period ?? "unknown";
  const asOf = det?.asOf ?? "";
  const guessedName = detectName(sheet.rows, hintName);

  if (await alreadyIngested(amcName, `staged:${dedupeKey}`, period, token)) return "skipped_already_done";

  const identity = await resolveIdentity(amcName, guessedName);
  const nav = identity.scheme_code.startsWith("upload-") ? null : (await navOnOrBefore(identity.scheme_code, asOf)) ?? identity.latest_nav;
  const data = assemble(parsed, identity, period, asOf, `Scraped from ${amcName}`, { nav });

  await writeSnapshot(amcName, identity.scheme_code, period, data, "worker", token);
  // Logged under both the dedupe key (so a re-run always skips this exact
  // file/member regardless of scheme-resolution drift) and the resolved
  // scheme_code (so it participates in the normal ingest_runs ledger).
  await logIngestRun({ amc_name: amcName, scheme_code: `staged:${dedupeKey}`, period, status: "success", source_url: sourceUrl }, token);
  await logIngestRun({ amc_name: amcName, scheme_code: identity.scheme_code, period, status: "success", source_url: sourceUrl }, token);
  return "success";
}

// Handles one manifest entry (single workbook or zip archive). Extracted
// from the POST loop so it can be raced against a hard deadline below —
// three targeted timeout fixes (route BUDGET_MS in a4bbb60c, mfapi.ts's
// retry budget in cfada772, the raw-fetch AbortControllers above) each
// closed one specific hang source, but ingest-staged kept failing on live
// runs after every one of them. None of those fixes bounds the *total*
// per-entry wall-clock — a hang anywhere unaccounted for (gateway call,
// XLSX.read on a malformed workbook, JSZip decompression) still blocks the
// whole invocation past the callback's real execution ceiling with no
// internal escape. This deadline is the backstop of last resort: whatever
// is actually hanging, the route now always returns a response instead of
// getting killed mid-request.
async function processEntry(entry: ManifestEntry, token: string, startedAt: number): Promise<string> {
  const buf = await fetchStagedFile(entry.staged_path);
  if (!buf) {
    await logIngestRun({ amc_name: entry.amc, scheme_code: null, period: "unknown", status: "transient", error: `fetch failed: ${entry.staged_path}`, source_url: entry.source_url }, token);
    return "fetch_failed";
  }

  if (entry.packaging === "zip") {
    // Multi-scheme archive: unpack, parse+write each xls/xlsx member.
    // Counts as one `limit` slot at the entry level — a large archive's
    // member count doesn't blow the invocation's time budget unbounded,
    // but does mean a single zip can itself take a while; that's fine,
    // it still finishes within one request rather than needing to be
    // resumed member-by-member (dedupe is per-member so a retry after a
    // timeout just re-skips already-written members).
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(buf);
    } catch {
      await logIngestRun({ amc_name: entry.amc, scheme_code: null, period: "unknown", status: "parse_failed", error: "unreadable zip", source_url: entry.source_url }, token);
      return "unreadable_zip";
    }
    const memberNames = Object.keys(zip.files).filter((n) => /\.(xls|xlsx)$/i.test(n) && !zip.files[n].dir);
    const memberStatuses: string[] = [];
    for (const name of memberNames) {
      // A multi-scheme archive (e.g. ICICI's monthly ZIP) can have
      // dozens of members — the outer budget check only runs once per
      // manifest entry, so without this a single large zip could still
      // run past the callback's real execution ceiling. Dedupe (above,
      // per-member) means whatever's deferred here just resumes as
      // "not yet done" on the zip's next pass.
      if (Date.now() - startedAt > BUDGET_MS) {
        memberStatuses.push("deferred_budget");
        continue;
      }
      const memberBuf = await zip.files[name].async("arraybuffer");
      const status = await processWorkbook(entry.amc, memberBuf, `${entry.source_url}#${name}`, name, `${entry.staged_path}#${name}`, token);
      memberStatuses.push(status);
    }
    return `zip(${memberNames.length} members: ${memberStatuses.join(",")})`;
  }

  return processWorkbook(entry.amc, buf, entry.source_url, entry.link_text || entry.staged_path, entry.staged_path, token);
}

// Zip member processing already self-bounds against BUDGET_MS inside its
// own loop (above), so this only needs to catch a genuine hang in a single
// fetch/parse/gateway call that no other checkpoint covers — not legitimate
// multi-member zip work. Kept short so even the worst case (limit entries
// each maxing out this deadline) stays under BUDGET_MS's already-tight
// headroom below the callback's real execution ceiling.
const ENTRY_DEADLINE_MS = 12_000;

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("deadline_exceeded")), ms)),
  ]);
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return NextResponse.json({ error: "missing task token" }, { status: 401 });

  let payload: CronPayload = {};
  try {
    payload = (await req.json()) as CronPayload;
  } catch {
    /* defaults */
  }
  const limit = payload.limit ?? DEFAULT_LIMIT;

  const manifest = await fetchManifest();
  const results: { staged_path: string; amc: string; status: string }[] = [];
  let processed = 0;

  // Rotate the manifest so this invocation starts where the last one left
  // off, instead of always re-scanning from index 0. With a fixed per-run
  // `limit` and dedup happening only after a full download+parse (inside
  // processWorkbook), always starting at 0 meant anything past the first
  // `limit` entries could never be reached — confirmed against production:
  // PPFAS alone has 315 staged historical files sitting untouched in the
  // manifest because they sort well past the first few entries.
  const startOffset = manifest.length > 0 ? (await getIngestCursor(CURSOR_KEY, token)) % manifest.length : 0;
  const ordered = manifest.length > 0 ? [...manifest.slice(startOffset), ...manifest.slice(0, startOffset)] : manifest;

  for (const entry of ordered) {
    if (Date.now() - startedAt > BUDGET_MS) {
      results.push({ staged_path: entry.staged_path, amc: entry.amc, status: "deferred_budget" });
      continue;
    }
    if (processed >= limit) {
      results.push({ staged_path: entry.staged_path, amc: entry.amc, status: "deferred_limit" });
      continue;
    }
    processed++;
    try {
      const status = await withDeadline(processEntry(entry, token, startedAt), ENTRY_DEADLINE_MS);
      results.push({ staged_path: entry.staged_path, amc: entry.amc, status });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logIngestRun({ amc_name: entry.amc, scheme_code: null, period: "unknown", status: "transient", error: msg, source_url: entry.source_url }, token);
      results.push({ staged_path: entry.staged_path, amc: entry.amc, status: msg === "deadline_exceeded" ? "timed_out" : "transient" });
    }
  }

  // Advance the cursor only past entries actually attempted this run
  // (`processed`) — entries marked deferred_budget/deferred_limit must be
  // retried first next time, not skipped over.
  if (manifest.length > 0) {
    await setIngestCursor(CURSOR_KEY, (startOffset + processed) % manifest.length, token);
  }

  return NextResponse.json({ manifest_size: manifest.length, start_offset: startOffset, processed, results });
}
