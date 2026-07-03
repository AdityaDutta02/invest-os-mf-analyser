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

const DEFAULT_LIMIT = 15;

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

export async function POST(req: NextRequest) {
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
    if (entry.packaging === "zip") {
      // Multi-scheme zip archives aren't unpacked by this route yet (the
      // worker stages the zip as-is) — tracked as a follow-up; skip for now
      // rather than mis-parsing an archive as a single workbook.
      results.push({ staged_path: entry.staged_path, amc: entry.amc, status: "skipped_zip_unsupported" });
      continue;
    }
    if (processed >= limit) {
      results.push({ staged_path: entry.staged_path, amc: entry.amc, status: "deferred_limit" });
      continue;
    }

    // Provisional identity check (before we know the real period) just to
    // avoid re-downloading files we've already fully processed under any
    // period — cheap dbList against the ledger keyed by source_url would be
    // ideal, but ingest_runs is keyed by (amc, scheme, period); we instead
    // dedupe on staged_path via a synthetic "period" bucket below.
    processed++;
    try {
      const buf = await fetchStagedFile(entry.staged_path);
      if (!buf) {
        await logIngestRun({ amc_name: entry.amc, scheme_code: null, period: "unknown", status: "transient", error: `fetch failed: ${entry.staged_path}`, source_url: entry.source_url }, token);
        results.push({ staged_path: entry.staged_path, amc: entry.amc, status: "fetch_failed" });
        continue;
      }

      let wb: XLSX.WorkBook;
      try {
        wb = XLSX.read(new Uint8Array(buf), { type: "array" });
      } catch {
        await logIngestRun({ amc_name: entry.amc, scheme_code: null, period: "unknown", status: "parse_failed", error: "unreadable workbook", source_url: entry.source_url }, token);
        results.push({ staged_path: entry.staged_path, amc: entry.amc, status: "unreadable" });
        continue;
      }
      const sheet = pickSheet(wb, "");
      if (!sheet) {
        await logIngestRun({ amc_name: entry.amc, scheme_code: null, period: "unknown", status: "parse_failed", error: "no holdings table", source_url: entry.source_url }, token);
        results.push({ staged_path: entry.staged_path, amc: entry.amc, status: "no_holdings_table" });
        continue;
      }
      const parsed = buildFromRows(sheet.rows);
      if (!parsed.ok || !validate(parsed.data).ok) {
        await logIngestRun({ amc_name: entry.amc, scheme_code: null, period: "unknown", status: "parse_failed", error: "validation failed", source_url: entry.source_url }, token);
        results.push({ staged_path: entry.staged_path, amc: entry.amc, status: "validation_failed" });
        continue;
      }
      const det = detectPeriod(sheet.rows);
      const period = det?.period ?? "unknown";
      const asOf = det?.asOf ?? "";
      const guessedName = detectName(sheet.rows, entry.link_text || entry.staged_path);

      if (await alreadyIngested(entry.amc, `staged:${entry.staged_path}`, period, token)) {
        results.push({ staged_path: entry.staged_path, amc: entry.amc, status: "skipped_already_done" });
        continue;
      }

      const identity = await resolveIdentity(entry.amc, guessedName);
      const nav = identity.scheme_code.startsWith("upload-") ? null : (await navOnOrBefore(identity.scheme_code, asOf)) ?? identity.latest_nav;
      const data = assemble(parsed, identity, period, asOf, `Scraped from ${entry.amc}`, { nav });

      await writeSnapshot(entry.amc, identity.scheme_code, period, data, "worker", token);
      // Also log under the staged_path key so re-runs of this same file
      // (even if scheme resolution differs run-to-run) don't reprocess it.
      await logIngestRun({ amc_name: entry.amc, scheme_code: `staged:${entry.staged_path}`, period, status: "success", source_url: entry.source_url }, token);
      await logIngestRun({ amc_name: entry.amc, scheme_code: identity.scheme_code, period, status: "success", source_url: entry.source_url }, token);
      results.push({ staged_path: entry.staged_path, amc: entry.amc, status: "success" });
    } catch (e) {
      await logIngestRun({ amc_name: entry.amc, scheme_code: null, period: "unknown", status: "transient", error: e instanceof Error ? e.message : String(e), source_url: entry.source_url }, token);
      results.push({ staged_path: entry.staged_path, amc: entry.amc, status: "transient" });
    }
  }

  return NextResponse.json({ manifest_size: manifest.length, results });
}
