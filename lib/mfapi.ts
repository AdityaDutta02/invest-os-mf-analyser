// mfapi.in client — scheme master, identity (fund house / ISIN / category) and NAV.
// Free, no key, AMFI-sourced. Holdings are NOT here (see lib/ingest.ts).
import type { AssetClass, SchemeSummary } from "./types";

const BASE = "https://api.mfapi.in";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

export interface MfApiSearchRow {
  schemeCode: number;
  schemeName: string;
}
export interface MfApiMeta {
  fund_house: string;
  scheme_type: string;
  scheme_category: string;
  scheme_name: string;
  isin_growth: string | null;
  isin_div_reinvestment: string | null;
}
export interface MfApiDetail {
  meta: MfApiMeta;
  data: { date: string; nav: string }[];
  status: string;
}

async function get<T>(path: string): Promise<T> {
  // Retry transient network/5xx failures — the runtime's outbound network to
  // mfapi can blip, and an unhandled "fetch failed" must not become a 500.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(`${BASE}${path}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: ctrl.signal,
        // mfapi updates ~6x/day; cache aggressively at the edge.
        next: { revalidate: 60 * 60 * 6 },
      });
      clearTimeout(t);
      if (res.status >= 500) throw new Error(`mfapi ${path} -> ${res.status}`);
      if (!res.ok) throw new Error(`mfapi ${path} -> ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`mfapi ${path} failed`);
}

export function inferAssetClass(text: string): AssetClass {
  const t = text.toLowerCase();
  if (/(liquid|overnight|gilt|bond|debt|money market|treasury|duration|credit risk|banking and psu|corporate bond|floater|gsec|g-sec)/.test(t))
    return "debt";
  if (/(hybrid|balanced|arbitrage|multi asset|asset alloc|equity savings)/.test(t)) return "hybrid";
  if (/(equity|flexi|focused|large cap|mid cap|small cap|multi cap|elss|tax saver|value|contra|dividend yield|index|nifty|sensex|etf|sectoral|thematic|infrastructure|technology|pharma|consumption|bluechip|opportunit)/.test(t))
    return "equity";
  return "other";
}

// mfapi names look like "Parag Parikh Flexi Cap Fund - Direct Plan - Growth".
// Strip plan/option suffixes for display.
export function cleanSchemeName(raw: string): string {
  return raw
    .replace(/\s*-\s*(direct|regular)\b.*$/i, "")
    .replace(/\s*-\s*(growth|idcw|income distribution|dividend|payout|reinvest|bonus).*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Heuristic AMC name from the scheme name's leading words (refined by detail meta when available).
const AMC_HINTS: [RegExp, string][] = [
  [/^parag parikh|^ppfas/i, "PPFAS Mutual Fund"],
  [/^icici/i, "ICICI Prudential Mutual Fund"],
  [/^hdfc/i, "HDFC Mutual Fund"],
  [/^sbi/i, "SBI Mutual Fund"],
  [/^nippon|^reliance/i, "Nippon India Mutual Fund"],
  [/^uti/i, "UTI Mutual Fund"],
  [/^aditya birla|^birla|^absl/i, "Aditya Birla Sun Life Mutual Fund"],
  [/^mirae/i, "Mirae Asset Mutual Fund"],
  [/^dsp/i, "DSP Mutual Fund"],
  [/^tata/i, "Tata Mutual Fund"],
  [/^motilal/i, "Motilal Oswal Mutual Fund"],
  [/^canara/i, "Canara Robeco Mutual Fund"],
  [/^hsbc/i, "HSBC Mutual Fund"],
  [/^invesco/i, "Invesco Mutual Fund"],
  [/^quantum/i, "Quantum Mutual Fund"],
  [/^bank of india|^boi/i, "Bank of India Mutual Fund"],
  [/^groww/i, "Groww Mutual Fund"],
  [/^samco/i, "Samco Mutual Fund"],
  [/^shriram/i, "Shriram Mutual Fund"],
  [/^nj /i, "NJ Mutual Fund"],
  [/^helios/i, "Helios Mutual Fund"],
  [/^zerodha/i, "Zerodha Mutual Fund"],
  [/^old bridge/i, "Old Bridge Mutual Fund"],
  [/^unifi/i, "Unifi Mutual Fund"],
  [/^capitalmind/i, "Capitalmind Mutual Fund"],
  [/^abakkus/i, "Abakkus Mutual Fund"],
];

export function inferAmcName(schemeName: string): string {
  for (const [re, name] of AMC_HINTS) if (re.test(schemeName.trim())) return name;
  // Fallback: first two words + "Mutual Fund"
  const words = schemeName.trim().split(/\s+/).slice(0, 2).join(" ");
  return `${words} Mutual Fund`;
}

export async function searchSchemes(q: string): Promise<SchemeSummary[]> {
  const rows = await get<MfApiSearchRow[]>(`/mf/search?q=${encodeURIComponent(q)}`);
  // Collapse to one entry per scheme name family is noisy; keep distinct codes but
  // prefer Direct-Growth where obvious. Keep it simple: return each, cleaned.
  const seen = new Set<string>();
  const out: SchemeSummary[] = [];
  for (const r of rows) {
    const name = cleanSchemeName(r.schemeName);
    const key = name.toLowerCase();
    // de-dupe by clean name, preferring direct+growth variants
    const isDirectGrowth = /direct/i.test(r.schemeName) && /growth/i.test(r.schemeName);
    if (seen.has(key) && !isDirectGrowth) continue;
    seen.add(key);
    out.push({
      id: String(r.schemeCode),
      scheme_name: name,
      amc_name: inferAmcName(name),
      category: "",
      nav: null,
      asset_class: inferAssetClass(r.schemeName),
    });
    if (out.length >= 25) break;
  }
  return out;
}

export async function schemeDetail(code: string): Promise<MfApiDetail> {
  return get<MfApiDetail>(`/mf/${code}`);
}

export interface SchemeIdentity {
  scheme_code: string;
  scheme_name: string;
  amc_name: string;
  fund_house: string;
  category: string;
  asset_class: AssetClass;
  isin: string;
  latest_nav: number | null;
  latest_nav_date: string | null;
  inception_date: string | null; // earliest NAV date, ISO "YYYY-MM-DD"
}

// mfapi NAV dates are "DD-MM-YYYY". Convert to ISO "YYYY-MM-DD".
function isoFromMfDate(s: string): string {
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

export async function schemeIdentity(code: string): Promise<SchemeIdentity> {
  const d = await schemeDetail(code);
  const m = d.meta;
  const latest = d.data?.[0];
  const earliest = d.data?.[d.data.length - 1];
  return {
    scheme_code: code,
    scheme_name: cleanSchemeName(m.scheme_name),
    amc_name: m.fund_house,
    fund_house: m.fund_house,
    category: m.scheme_category || "",
    asset_class: inferAssetClass(`${m.scheme_category} ${m.scheme_name}`),
    isin: m.isin_growth || m.isin_div_reinvestment || "",
    latest_nav: latest ? Number(latest.nav) : null,
    latest_nav_date: latest ? latest.date : null,
    inception_date: earliest ? isoFromMfDate(earliest.date) : null,
  };
}

// Period-accurate NAV: the NAV on or immediately before an ISO date (month-end).
export async function navOnOrBefore(code: string, isoDate: string): Promise<number | null> {
  try {
    const d = await schemeDetail(code);
    // data is newest-first; find first entry whose ISO date <= target
    for (const row of d.data) {
      if (isoFromMfDate(row.date) <= isoDate) {
        const n = Number(row.nav);
        return isFinite(n) ? n : null;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}
