// One-off: parse the two local detailed PPFAS disclosure files (May/June
// 2026, each tab a separate fund) and emit a small JSONL patch to replace
// whatever's currently in the DB for these periods with the full holdings
// list. Run: npx tsx scripts/bulk/build-ppfas-patch.ts
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import * as XLSX from "xlsx";
import { sheetRows, buildFromRows, assemble } from "../../lib/parse";

const CODES: Record<string, { code: string; name: string }> = {
  PPFCF: { code: "122639", name: "Parag Parikh Flexi Cap Fund" },
  PPLF: { code: "143269", name: "Parag Parikh Liquid Fund" },
  PPTSF: { code: "147481", name: "Parag Parikh ELSS Tax Saver Fund" },
  PPCHF: { code: "148958", name: "Parag Parikh Conservative Hybrid Fund" },
  PPAF: { code: "152109", name: "Parag Parikh Arbitrage Fund" },
  PPDAAF: { code: "152468", name: "Parag Parikh Dynamic Asset Allocation Fund" },
  PPLCF: { code: "154155", name: "Parag Parikh Large Cap Fund" },
};

const FILES: { path: string; period: string; asOf: string }[] = [
  { path: join(homedir(), "Downloads", "PPFAS_Monthly_Portfolio_Report_May_31_2026.xls"), period: "2026-05", asOf: "2026-05-31" },
  { path: join(homedir(), "Downloads", "PPFAS_Monthly_Portfolio_Report_June_30_2026.xls"), period: "2026-06", asOf: "2026-06-30" },
  // PPLCF (Large Cap) launched ~March 2026 — not in the scraped corpus at
  // all (confirmed: Feb 2026 and earlier 404 on the AMC's own site). Its
  // first two months have no sibling funds in the same workbook (PPLCF is
  // the only tab), unlike May/June's combined 7-tab reports above.
  { path: "/tmp/pplcf/PPLCF_March_2026.xlsx", period: "2026-03", asOf: "2026-03-31" },
  { path: "/tmp/pplcf/PPLCF_April_2026.xlsx", period: "2026-04", asOf: "2026-04-30" },
];

const OUT_DIR = join(homedir(), "mf-corpus-tools", "bulk-artifacts");
mkdirSync(OUT_DIR, { recursive: true });
const out: string[] = [];

for (const f of FILES) {
  const buf = readFileSync(f.path);
  const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  for (const sn of wb.SheetNames) {
    const rows = sheetRows(wb.Sheets[sn]);
    const parsed = buildFromRows(rows);
    if (!parsed.ok) {
      console.error(`SKIP ${f.period} ${sn}: ${parsed.reason}`);
      continue;
    }
    const meta = CODES[sn];
    if (!meta) {
      console.error(`SKIP ${f.period} ${sn}: no scheme_code mapping`);
      continue;
    }
    const identity = {
      scheme_code: meta.code,
      scheme_name: meta.name,
      amc_name: "PPFAS Mutual Fund",
      fund_house: "PPFAS Mutual Fund",
      category: "",
      asset_class: parsed.asset_class,
      isin: "",
      latest_nav: null,
      latest_nav_date: null,
      inception_date: null,
    };
    const data = assemble(parsed, identity, f.period, f.asOf, `https://amc.ppfas.com/downloads/portfolio-disclosure`, { aum: parsed.aum });
    out.push(JSON.stringify({ scheme_code: meta.code, period: f.period, source: "detailed_disclosure", data }));
    console.log(`OK ${f.period} ${sn} -> ${meta.code} holdings=${parsed.data.holdings_count} weight=${parsed.data.total_weight}`);
  }
}

writeFileSync(join(OUT_DIR, "ppfas-patch.jsonl"), out.join("\n") + "\n");
console.log(`\nWrote ${out.length} rows`);
