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
import { writeSnapshot, logIngestRun, alreadyIngested } from "@/lib/ingest-write";
import { navOnOrBefore } from "@/lib/mfapi";
import { searchSchemes } from "@/lib/mfapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

async function fetchManifest(): Promise<ManifestEntry[]> {
  try {
    const res = await fetch(`${RAW_BASE}/staging/manifest.json`, { cache: "no-store" });
    if (!res.ok) return [];
    return (await res.json()) as ManifestEntry[];
  } catch {
    return [];
  }
}

async function fetchStagedFile(stagedPath: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(`${RAW_BASE}/staging/${stagedPath}`, { cache: "no-store" });
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

  for (const entry of manifest) {
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
      const buf = await fetchStagedFile(entry.staged_path);
      if (!buf) {
        await logIngestRun({ amc_name: entry.amc, scheme_code: null, period: "unknown", status: "transient", error: `fetch failed: ${entry.staged_path}`, source_url: entry.source_url }, token);
        results.push({ staged_path: entry.staged_path, amc: entry.amc, status: "fetch_failed" });
        continue;
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
          results.push({ staged_path: entry.staged_path, amc: entry.amc, status: "unreadable_zip" });
          continue;
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
        results.push({ staged_path: entry.staged_path, amc: entry.amc, status: `zip(${memberNames.length} members: ${memberStatuses.join(",")})` });
        continue;
      }

      const status = await processWorkbook(entry.amc, buf, entry.source_url, entry.link_text || entry.staged_path, entry.staged_path, token);
      results.push({ staged_path: entry.staged_path, amc: entry.amc, status });
    } catch (e) {
      await logIngestRun({ amc_name: entry.amc, scheme_code: null, period: "unknown", status: "transient", error: e instanceof Error ? e.message : String(e), source_url: entry.source_url }, token);
      results.push({ staged_path: entry.staged_path, amc: entry.amc, status: "transient" });
    }
  }

  return NextResponse.json({ manifest_size: manifest.length, results });
}
