// Orchestrates: cached identity (mfapi) → registry fetch → parse → assemble.
// Returns a discriminated result so callers can show honest, specific copy.
import * as XLSX from "xlsx";
import { navOnOrBefore, type SchemeIdentity } from "./mfapi";
import { getIdentity } from "./identity";
import { recipeFor } from "./registry";
import { assemble, buildFromRows, pickSheet, validate } from "./parse";
import type { AnalyseData } from "./types";

export type IngestReason = "not_covered" | "not_published" | "parse_failed" | "transient";
export type IngestResult = { ok: true; data: AnalyseData } | { ok: false; reason: IngestReason };

export async function parseWorkbook(
  buffer: ArrayBuffer,
  id: SchemeIdentity,
  period: string,
  asOfDate: string,
  sourceUrl: string,
  opts?: { nav?: number | null },
): Promise<AnalyseData | null> {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
  } catch {
    return null;
  }
  const sheet = pickSheet(wb, id.scheme_name);
  if (!sheet) return null;
  const parsed = buildFromRows(sheet.rows);
  if (!parsed.ok || !validate(parsed.data).ok) return null;
  return assemble(parsed, id, period, asOfDate, sourceUrl, { nav: opts?.nav });
}

// Lazy-fetch path used by /api/analyse on a cache miss.
export async function lazyIngest(schemeCode: string, period: string, token: string | null): Promise<IngestResult> {
  let id: SchemeIdentity;
  try {
    id = await getIdentity(schemeCode, token);
  } catch {
    return { ok: false, reason: "transient" }; // mfapi unreachable
  }

  const recipe = recipeFor(id.fund_house);
  if (!recipe) return { ok: false, reason: "not_covered" };

  let resolved;
  try {
    resolved = await recipe.fetchPortfolio(period, id);
  } catch {
    return { ok: false, reason: "transient" }; // network error reaching the AMC
  }
  if (!resolved) return { ok: false, reason: "not_published" };

  // period-accurate NAV (month-end) from mfapi history; falls back to latest.
  const nav = (await navOnOrBefore(schemeCode, resolved.asOfDate)) ?? id.latest_nav;
  const data = await parseWorkbook(resolved.buffer, id, period, resolved.asOfDate, resolved.sourceUrl, { nav });
  if (!data) return { ok: false, reason: "parse_failed" };
  return { ok: true, data };
}
