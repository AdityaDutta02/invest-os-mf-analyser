// F4 of the bulk-direct-DB-load plan: turn each parsed record's
// `scheme_name_hint` (+ `amc`) into a real mfapi `scheme_code`. Unmapped
// schemes get a synthetic code (still searchable/analysable, re-mappable
// later) rather than being guessed at or dropped.
//
// Run: npx tsx scripts/bulk/map-schemes.ts
import { readFileSync, writeFileSync, mkdirSync, createReadStream } from "fs";
import { createInterface } from "readline";
import { homedir } from "os";
import { join } from "path";
import { cleanSchemeName, inferAmcName } from "../../lib/mfapi";

const OUT_DIR = join(homedir(), "mf-corpus-tools", "bulk-artifacts");
const PARSED_PATH = join(OUT_DIR, "parsed.jsonl");
const MAP_PATH = join(OUT_DIR, "scheme-map.json");
const REPORT_PATH = join(OUT_DIR, "mapping-report.json");
const SPOTCHECK_PATH = join(OUT_DIR, "mapping-spotcheck.json");

const BASE = "https://api.mfapi.in";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

interface SearchRow {
  schemeCode: number;
  schemeName: string;
}

// BUG THIS FIXES: a non-2xx response (429 under sustained concurrent load,
// transient 5xx) used to return [] immediately with no retry — only a thrown
// network exception got backed off and retried. That silently turned
// "mfapi throttled us for a moment" into a permanent "no candidates found,"
// which is indistinguishable from a genuine no-match in the mapping report.
// Confirmed by hand: a live single query for a pair the script marked
// unmapped (Invesco India ELSS) returns a perfect match — the corpus data
// and query logic were fine, the retry policy wasn't.
async function rawSearch(q: string): Promise<SearchRow[]> {
  let lastStatus: number | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(`${BASE}/mf/search?q=${encodeURIComponent(q)}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (res.ok) return (await res.json()) as SearchRow[];
      lastStatus = res.status;
      const retryAfter = parseInt(res.headers.get("retry-after") ?? "0", 10);
      await new Promise((r) => setTimeout(r, retryAfter > 0 ? retryAfter * 1000 : 700 * (attempt + 1)));
    } catch {
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
  }
  if (lastStatus) process.stderr.write(`giving up on "${q}" after 4 attempts, last status ${lastStatus}\n`);
  return [];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const normAmc = (s: string) => s.toLowerCase().replace(/mutual fund/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 2));
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// A search query built from the whole hint often over-constrains mfapi's
// substring search (plan/option words, stray punctuation); use the most
// distinctive tokens instead (drop generic words).
//
// Real source filenames often carry a trailing asset-class/category word for
// the AMC's own folder organization (e.g. "..._Equity.xls",
// "..._Fixed_Income.xls") that isn't part of the actual scheme name. mfapi's
// search appears to AND all query terms together, so one such stray word
// zeroes the whole result set even though the fund is a perfect, unambiguous
// match without it (confirmed live: "invesco india contra equity" -> [],
// "invesco india contra" -> 4 correct hits). Rather than blacklist specific
// category words (risky — "debt"/"income" are legitimately part of some real
// fund names), try progressively shorter token windows until one returns
// candidates.
const STOP = new Set(["fund", "plan", "scheme", "direct", "regular", "growth", "idcw", "the", "and", "of", "mutual"]);
function queryVariants(hint: string): string[] {
  const toks = hint.split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w.toLowerCase()));
  if (toks.length === 0) return [hint];
  const variants = [toks.slice(0, 4), toks.slice(0, 3), toks.slice(0, 2)]
    .map((t) => t.join(" "))
    .filter((q, i, arr) => q && arr.indexOf(q) === i); // dedupe (short hints repeat across window sizes)
  return variants.length ? variants : [hint];
}

interface Pair {
  amc: string;
  hint: string;
  count: number; // how many parsed records this covers
}

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
      if (i % 500 === 0) process.stderr.write(`[${i}/${items.length}]\n`);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return out;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const pairMap = new Map<string, Pair>();
  let lineCount = 0;
  await new Promise<void>((resolve, reject) => {
    const rl = createInterface({ input: createReadStream(PARSED_PATH, "utf8"), crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (!line) return;
      lineCount++;
      const r = JSON.parse(line);
      const hint = String(r.scheme_name_hint || "").trim();
      if (!hint) return;
      const key = `${r.amc}||${hint.toLowerCase()}`;
      const existing = pairMap.get(key);
      if (existing) existing.count++;
      else pairMap.set(key, { amc: r.amc, hint, count: 1 });
    });
    rl.on("close", resolve);
    rl.on("error", reject);
  });
  let pairs = [...pairMap.values()];
  const limit = process.env.BULK_LIMIT ? parseInt(process.env.BULK_LIMIT, 10) : undefined;
  if (limit) pairs = pairs.slice(0, limit);
  process.stderr.write(`${pairs.length} distinct (amc, hint) pairs from ${lineCount} records\n`);

  const results = await mapConcurrent(pairs, 5, async (pair) => {
    let candidates: SearchRow[] = [];
    for (const q of queryVariants(pair.hint)) {
      candidates = await rawSearch(q);
      if (candidates.length > 0) break;
    }
    const wantAmc = normAmc(pair.amc);
    const hintToks = tokens(pair.hint);

    let best: { schemeCode: number; schemeName: string; score: number } | null = null;
    for (const c of candidates) {
      const candAmc = normAmc(inferAmcName(c.schemeName));
      // Loose AMC match: exact after normalization, or one contains the other's
      // first significant word (handles inferAmcName's two-word fallback).
      const amcOk =
        candAmc === wantAmc ||
        (wantAmc.split(" ")[0] && candAmc.includes(wantAmc.split(" ")[0])) ||
        (candAmc.split(" ")[0] && wantAmc.includes(candAmc.split(" ")[0]));
      if (!amcOk) continue;
      const cleaned = cleanSchemeName(c.schemeName);
      let score = jaccard(hintToks, tokens(cleaned));
      if (/direct/i.test(c.schemeName) && /growth/i.test(c.schemeName)) score += 0.05; // tie-break preference
      if (!best || score > best.score) best = { schemeCode: c.schemeCode, schemeName: cleaned, score };
    }

    if (best && best.score >= 0.5) {
      return { ...pair, mapped: true, scheme_code: String(best.schemeCode), matched_name: best.schemeName, score: Math.min(best.score, 1) };
    }
    return { ...pair, mapped: false, scheme_code: `corpus-${slug(pair.amc)}-${slug(pair.hint)}`, matched_name: null, score: best?.score ?? 0 };
  });

  const map: Record<string, { scheme_code: string; scheme_name: string; mapped: boolean; score: number; record_count: number }> = {};
  const perAmc: Record<string, { pairs: number; mapped: number; unmapped: number; records: number; recordsMapped: number }> = {};
  for (const r of results) {
    const key = `${r.amc}||${r.hint.toLowerCase()}`;
    map[key] = { scheme_code: r.scheme_code, scheme_name: r.matched_name ?? r.hint, mapped: r.mapped, score: r.score, record_count: r.count };
    perAmc[r.amc] ??= { pairs: 0, mapped: 0, unmapped: 0, records: 0, recordsMapped: 0 };
    perAmc[r.amc].pairs++;
    perAmc[r.amc].records += r.count;
    if (r.mapped) {
      perAmc[r.amc].mapped++;
      perAmc[r.amc].recordsMapped += r.count;
    } else {
      perAmc[r.amc].unmapped++;
    }
  }

  writeFileSync(MAP_PATH, JSON.stringify(map));

  const totalPairs = results.length;
  const totalMapped = results.filter((r) => r.mapped).length;
  const totalRecords = results.reduce((s, r) => s + r.count, 0);
  const totalRecordsMapped = results.filter((r) => r.mapped).reduce((s, r) => s + r.count, 0);
  const report = {
    totalPairs,
    totalMapped,
    totalUnmapped: totalPairs - totalMapped,
    coveragePct: Math.round((totalMapped / totalPairs) * 10000) / 100,
    totalRecords,
    totalRecordsMapped,
    recordCoveragePct: Math.round((totalRecordsMapped / totalRecords) * 10000) / 100,
    perAmc,
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  // N=30 spot-check sample of MAPPED pairs, weighted toward high record_count
  // (the ones that matter most if wrong), for manual hand review before upload.
  const mappedSorted = results.filter((r) => r.mapped).sort((a, b) => b.count - a.count);
  const spotcheck = mappedSorted
    .filter((_, i) => i % Math.max(1, Math.floor(mappedSorted.length / 30)) === 0)
    .slice(0, 30)
    .map((r) => ({ amc: r.amc, hint: r.hint, matched_name: r.matched_name, scheme_code: r.scheme_code, score: r.score, record_count: r.count }));
  writeFileSync(SPOTCHECK_PATH, JSON.stringify(spotcheck, null, 2));

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
