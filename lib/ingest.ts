// Orchestrates: scheme identity (mfapi) → registry fetch → parse → assemble.
// Returns the canonical AnalyseData, or null when the period isn't resolvable
// (caller maps null → HTTP 404 "no data — upload"). Throws only on real errors.
import * as XLSX from "xlsx";
import { schemeIdentity, type SchemeIdentity } from "./mfapi";
import { recipeFor } from "./registry";
import { assemble, buildFromRows, pickSheet, validate } from "./parse";
import type { AnalyseData } from "./types";

export async function ingestFromBuffer(
  buffer: ArrayBuffer,
  id: SchemeIdentity,
  period: string,
  asOfDate: string,
  sourceUrl: string,
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
  if (!parsed.ok) return null;
  const v = validate(parsed.data);
  if (!v.ok) return null;
  // Prefer the parsed asset_class derivation when it disagrees with the name heuristic.
  const built = assemble(parsed, id, period, asOfDate, sourceUrl);
  return built;
}

// Full lazy-fetch path used by /api/analyse on a cache miss.
export async function lazyIngest(schemeCode: string, period: string): Promise<AnalyseData | null> {
  const id = await schemeIdentity(schemeCode);
  const recipe = recipeFor(id.fund_house);
  if (!recipe) return null; // not a Phase-1 direct AMC → upload only
  const resolved = await recipe.fetchPortfolio(period, id);
  if (!resolved) return null;
  return ingestFromBuffer(resolved.buffer, id, period, resolved.asOfDate, resolved.sourceUrl);
}

// Upload path — caller already has the file bytes + a chosen scheme identity.
export async function ingestUpload(
  buffer: ArrayBuffer,
  id: SchemeIdentity,
  period: string,
  asOfDate: string,
): Promise<AnalyseData | null> {
  return ingestFromBuffer(buffer, id, period, asOfDate, "uploaded by user");
}
