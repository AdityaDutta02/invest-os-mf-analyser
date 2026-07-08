// M5: in-process fuzzy matching + a short-TTL wholesale cache for the
// `securities`/`schemes` dimension tables. No fuzzy-search library — the DB
// gateway has no ILIKE/trgm operator (see ARCHITECTURE.md / plan), so
// matching has to happen in Node over a table pulled wholesale. Both tables
// are bounded (low thousands of rows), so a plain substring/token scorer is
// enough; pulling in a dependency (e.g. Fuse.js) for this isn't warranted.
import { dbList } from "./db";

export const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i;

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

// Higher is better; 0 means "no match". Rewards an exact substring hit and,
// on top of that, how much of the candidate string the query covers — a
// short query that matches a large fraction of a short name should outrank
// the same query buried in a long one.
export function fuzzyScore(query: string, candidate: string): number {
  const q = normalize(query);
  const c = normalize(candidate);
  if (!q || !c) return 0;
  if (c === q) return 100;
  if (c.startsWith(q)) return 90 - Math.min(20, c.length - q.length);
  const idx = c.indexOf(q);
  if (idx >= 0) return 70 - Math.min(20, idx) - Math.min(10, c.length - q.length);

  // Fallback: token overlap (handles word-order swaps, e.g. "Flexi Cap
  // HDFC" matching "HDFC Flexi Cap Fund").
  const qTokens = q.split(" ").filter(Boolean);
  const cTokens = new Set(c.split(" ").filter(Boolean));
  const hits = qTokens.filter((t) => cTokens.has(t)).length;
  if (hits === 0) return 0;
  return Math.round((hits / qTokens.length) * 40);
}

interface CacheEntry<T> {
  rows: T[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60_000;
const securitiesCache = new Map<string, CacheEntry<{ isin: string; name: string }>>();
const schemesCache = new Map<
  string,
  CacheEntry<{ scheme_code: string; amc_name: string; scheme_name: string; isin: string | null; category: string; asset_class: string }>
>();

// `securities`/`schemes` are app-wide, not viewer-scoped, but the gateway
// still requires a token per call — cache keyed by token so a cold cache
// only costs one wholesale pull per distinct caller within the TTL window,
// not one per request.
export async function getSecuritiesCached(token: string) {
  const hit = securitiesCache.get(token);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.rows;
  const rows = await dbList<{ isin: string; name: string }>("securities", {}, token);
  securitiesCache.set(token, { rows, fetchedAt: Date.now() });
  return rows;
}

export async function getSchemesCached(token: string) {
  const hit = schemesCache.get(token);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.rows;
  const rows = await dbList<{
    scheme_code: string;
    amc_name: string;
    scheme_name: string;
    isin: string | null;
    category: string;
    asset_class: string;
  }>("schemes", {}, token);
  schemesCache.set(token, { rows, fetchedAt: Date.now() });
  return rows;
}
