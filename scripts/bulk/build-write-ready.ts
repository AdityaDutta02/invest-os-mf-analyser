// Piece 3 prep: join parsed.jsonl (holdings/derived data) with scheme-map.json
// (resolved scheme_code) into write-ready snapshot rows, matching the exact
// `AnalyseData` contract (lib/types.ts) the app already writes via
// writeSnapshot(). Chunks output into ~2000-record JSONL files so the app's
// bulk-load route can pull one chunk per invocation without downloading the
// whole corpus each time.
//
// NAV/category/ISIN enrichment (F5) is deliberately deferred — same
// "trust the file, never mislabel" default lib/detect.ts's synthIdentity()
// already uses for unmapped schemes (category: "", isin: "", nav: null).
// A follow-up enrichment pass can backfill these later without touching
// holdings data (see project_status_full_disclosure_archive memory).
//
// Run: npx tsx scripts/bulk/build-write-ready.ts
import { readFileSync, writeFileSync, mkdirSync, createReadStream } from "fs";
import { createInterface } from "readline";
import { homedir } from "os";
import { join } from "path";

const OUT_DIR = join(homedir(), "mf-corpus-tools", "bulk-artifacts");
const PARSED_PATH = join(OUT_DIR, "parsed.jsonl");
const MAP_PATH = join(OUT_DIR, "scheme-map.json");
const CHUNKS_DIR = join(OUT_DIR, "chunks");
const INDEX_PATH = join(CHUNKS_DIR, "index.json");

// Lowered from 2000: the app's bulk-load route re-fetches a chunk's ENTIRE
// raw file from GitHub every invocation it touches that chunk (no
// byte-range support), so a large ~20MB chunk that can't be fully
// processed within one invocation's time budget gets re-downloaded in
// full on the next cycle too — and that repeated large fetch is the
// prime suspect for the self-rescheduling chain dying at cycle 2 in
// production (confirmed: budget-timing fixes on the write side alone
// didn't solve it). At ~150 records/chunk (~1-1.5MB), one invocation can
// reliably finish an entire chunk (or several) well within budget,
// eliminating the re-fetch-of-a-huge-partial-file case in the common path.
const CHUNK_SIZE = 150;

interface MapEntry {
  scheme_code: string;
  scheme_name: string;
  mapped: boolean;
  score: number;
  record_count: number;
}

async function main() {
  mkdirSync(CHUNKS_DIR, { recursive: true });
  const map: Record<string, MapEntry> = JSON.parse(readFileSync(MAP_PATH, "utf8"));

  let chunkIndex = 0;
  let buf: string[] = [];
  const chunkFiles: string[] = [];
  let total = 0;

  function flush() {
    if (buf.length === 0) return;
    const name = `chunk-${String(chunkIndex).padStart(4, "0")}.jsonl`;
    writeFileSync(join(CHUNKS_DIR, name), buf.join("\n") + "\n");
    chunkFiles.push(name);
    chunkIndex++;
    buf = [];
  }

  await new Promise<void>((resolve, reject) => {
    const rl = createInterface({ input: createReadStream(PARSED_PATH, "utf8"), crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (!line) return;
      const r = JSON.parse(line);
      const hint = String(r.scheme_name_hint || "").trim();
      const key = `${r.amc}||${hint.toLowerCase()}`;
      const m = map[key];
      const scheme_code = m?.scheme_code ?? `corpus-${slug(r.amc)}-${slug(hint)}`;
      const scheme_name = m?.scheme_name ?? hint;

      const row = {
        scheme_code,
        period: r.period,
        source: "bulk",
        data: {
          scheme_name,
          amc_name: r.amc,
          category: "",
          isin: "",
          asset_class: r.asset_class,
          period: r.period,
          period_label: periodLabel(r.period),
          as_of_date: r.as_of_date,
          source_org: r.amc,
          source_url: r.source_url,
          aum: r.aum,
          nav: null,
          expense_ratio: null,
          holdings_count: r.holdings_count,
          total_weight: r.total_weight,
          deployable_cash: r.deployable_cash,
          asset_allocation: r.asset_allocation,
          category_breakdown: r.category_breakdown,
          market_cap_breakdown: r.market_cap_breakdown,
          cash_breakdown: r.cash_breakdown,
          top_holdings: r.top_holdings,
          holdings: r.holdings,
        },
      };
      buf.push(JSON.stringify(row));
      total++;
      if (buf.length >= CHUNK_SIZE) flush();
    });
    rl.on("close", () => {
      flush();
      resolve();
    });
    rl.on("error", reject);
  });

  writeFileSync(INDEX_PATH, JSON.stringify({ chunkFiles, totalRecords: total, chunkSize: CHUNK_SIZE }, null, 2));
  console.log(`wrote ${chunkFiles.length} chunks, ${total} records`);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] ?? "";
  return `${mon} ${y}`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
