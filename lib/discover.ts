// Scheme discovery for the direct-fetch AMCs (M2): mfapi has no "list all
// schemes for AMC X" endpoint, only free-text search (/mf/search?q=) and
// per-scheme detail (/mf/{code}, the source of fund_house). So: search by a
// keyword drawn from the AMC name, then keep only matches whose scheme name
// resolves (via inferAmcName's same heuristic recipeFor's callers rely on)
// to that AMC, de-duped to one representative code per distinct scheme
// (holdings are identical across an AMC's plan/option variants of the same
// scheme — only NAV differs, and that's fetched separately).
import { inferAmcName, cleanSchemeName, type MfApiSearchRow } from "./mfapi";

const BASE = "https://api.mfapi.in";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

async function rawSearch(q: string): Promise<MfApiSearchRow[]> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(`${BASE}/mf/search?q=${encodeURIComponent(q)}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return [];
    return (await res.json()) as MfApiSearchRow[];
  } catch {
    return [];
  }
}

export interface DiscoveredScheme {
  scheme_code: string;
  scheme_name: string;
}

// amcName: the canonical name used by lib/registry.ts recipes (e.g. "PPFAS
// Mutual Fund"). searchTerm: a keyword mfapi's search will actually match
// against scheme names (e.g. "Parag Parikh" — AMC legal names don't always
// appear verbatim in scheme names, so callers supply the term explicitly).
export async function discoverSchemes(amcName: string, searchTerm: string): Promise<DiscoveredScheme[]> {
  const rows = await rawSearch(searchTerm);
  const seen = new Map<string, DiscoveredScheme>(); // clean name -> best code
  for (const r of rows) {
    if (inferAmcName(r.schemeName) !== amcName) continue;
    const name = cleanSchemeName(r.schemeName);
    const key = name.toLowerCase();
    const isDirectGrowth = /direct/i.test(r.schemeName) && /growth/i.test(r.schemeName);
    const existing = seen.get(key);
    if (existing && !isDirectGrowth) continue; // keep first unless this one is the preferred direct-growth variant
    seen.set(key, { scheme_code: String(r.schemeCode), scheme_name: name });
  }
  return [...seen.values()];
}

// Search terms for the 13 direct-fetch AMCs — mfapi's free-text search needs
// a term that actually appears in scheme names, not always the legal AMC name.
export const DIRECT_AMC_SEARCH_TERMS: Record<string, string> = {
  "PPFAS Mutual Fund": "Parag Parikh",
  "Unifi Mutual Fund": "Unifi",
  "Helios Mutual Fund": "Helios",
  "Groww Mutual Fund": "Groww",
  "Bank of India Mutual Fund": "Bank of India",
  "NJ Mutual Fund": "NJ",
  "Shriram Mutual Fund": "Shriram",
  "Capitalmind Mutual Fund": "Capitalmind",
  "Old Bridge Mutual Fund": "Old Bridge",
  "Abakkus Mutual Fund": "Abakkus",
  "Samco Mutual Fund": "Samco",
  "Quantum Mutual Fund": "Quantum",
  "ICICI Prudential Mutual Fund": "ICICI Prudential",
};

export async function discoverAllDirectSchemes(): Promise<DiscoveredScheme[]> {
  // Was sequential (13 AMCs x up to 15s timeout each = up to ~195s worst
  // case, run fresh on *every* hourly invocation before any ingest work
  // even started) — a likely contributor to the cron timeouts observed in
  // production. mfapi's search endpoint has no shared rate limit concern
  // here (13 independent GETs), so fan them out concurrently instead.
  const perAmc = await Promise.all(
    Object.entries(DIRECT_AMC_SEARCH_TERMS).map(([amc, term]) => discoverSchemes(amc, term)),
  );
  return perAmc.flat();
}
