// Per-AMC URL resolvers for the ~15 plain-fetch ("direct") AMCs.
// Each recipe knows how to locate + download a given period's portfolio workbook
// using only plain fetch() (no headless browser). Strategies:
//   - template  : construct the URL directly (probe a few month-end days)
//   - listing   : fetch the static disclosures page, regex the matching link
//   - zip       : download a zip, pick the member matching the scheme
// Recipes return the workbook buffer + meta, or null when not resolvable
// (caller then returns "no data — upload" to the client). This degrades
// gracefully: tractable AMCs resolve, the rest fall back to upload.
import JSZip from "jszip";
import type { SchemeIdentity } from "./mfapi";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

export interface Resolved {
  buffer: ArrayBuffer; // an .xls/.xlsx workbook
  sourceUrl: string;
  asOfDate: string; // YYYY-MM-DD
  schemeHint: string; // used by pickSheet for single-workbook files
}

interface PeriodParts {
  year: number;
  month: number; // 1-12
  monthLong: string; // "May"
  monthLower: string; // "may"
  days: number[]; // candidate month-end days, latest first
  lastDay: number;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function parts(period: string): PeriodParts {
  const [year, month] = period.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const days = [lastDay, lastDay - 1, lastDay - 2, lastDay - 3].filter((d) => d > 25);
  return { year, month, monthLong: MONTHS[month - 1], monthLower: MONTHS[month - 1].toLowerCase(), days, lastDay };
}

function fyLabel(year: number, month: number, sep = "-"): string {
  // Indian FY Apr–Mar
  const start = month >= 4 ? year : year - 1;
  return `${start}${sep}${start + 1}`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ordinal = (d: number) => `${d}${["th", "st", "nd", "rd"][d % 10 > 3 || (d >= 11 && d <= 13) ? 0 : d % 10]}`;

// Lowered from 20s — "template" recipes probe several candidate URLs
// (month-end day variants) sequentially in tryCandidates below; a hung
// (not just 404ing) endpoint at 20s/candidate could push a single scheme's
// resolution past a minute, well beyond the route's BUDGET_MS check between
// scheme, and past whatever the Terminal AI task callback's own execution
// ceiling is — a likely contributor to both cron tasks' last_run_status:
// "failed". These endpoints normally respond in low single-digit seconds.
async function fetchBuf(url: string, timeoutMs = 8000): Promise<ArrayBuffer | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" }, redirect: "follow", signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 2000) return null; // error pages
    // reject obvious HTML
    if (/text\/html/.test(ct)) {
      const head = Buffer.from(buf.slice(0, 64)).toString("utf8").toLowerCase();
      if (head.includes("<!doctype") || head.includes("<html")) return null;
    }
    return buf;
  } catch {
    return null;
  }
}

async function fetchText(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, redirect: "follow", signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// Try a list of candidate URLs; return the first that downloads as a workbook.
async function tryCandidates(urls: string[], asOfDate: string, schemeHint: string): Promise<Resolved | null> {
  for (const url of urls) {
    const buffer = await fetchBuf(url);
    if (buffer) return { buffer, sourceUrl: url, asOfDate, schemeHint };
  }
  return null;
}

// Find links on a listing page matching a regex; resolve relative to base.
function linksMatching(html: string, base: string, re: RegExp): string[] {
  const out: string[] = [];
  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html))) {
    const href = m[1];
    if (re.test(href)) {
      try {
        out.push(new URL(href, base).toString());
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}

const slug = (s: string, sep = "-") =>
  s.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/).join(sep);

// scheme-name tokens used to match a file/member among many
function schemeTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\b(fund|plan|growth|direct|regular|the|scheme|open ended|open-ended)\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
}

function bestMember(names: string[], hint: string): string | null {
  const toks = schemeTokens(hint);
  let best: { name: string; score: number } | null = null;
  for (const n of names) {
    const low = n.toLowerCase();
    if (!/\.(xls|xlsx)$/i.test(low)) continue;
    const score = toks.filter((t) => low.includes(t)).length;
    if (!best || score > best.score) best = { name: n, score };
  }
  return best && best.score > 0 ? best.name : null;
}

// ── recipe type ──────────────────────────────────────────────
export interface Recipe {
  amc: string;
  match: RegExp; // against mfapi fund_house
  fetchPortfolio(period: string, id: SchemeIdentity): Promise<Resolved | null>;
}

// PPFAS scheme → file code map
const PPFAS_CODES: [RegExp, string][] = [
  [/flexi/i, "PPFCF"],
  [/liquid/i, "PPLF"],
  [/conservative hybrid|hybrid/i, "PPCHF"],
  [/tax saver|elss/i, "PPTSF"],
  [/dynamic asset|balanced advantage/i, "PPDAAF"],
  [/arbitrage/i, "PPAF"],
];

const RECIPES: Recipe[] = [
  {
    amc: "PPFAS Mutual Fund",
    match: /ppfas|parag parikh/i,
    async fetchPortfolio(period, id) {
      const p = parts(period);
      const code = PPFAS_CODES.find(([re]) => re.test(id.scheme_name))?.[1] ?? "PPFCF";
      const urls = p.days.map(
        (d) => `https://amc.ppfas.com/downloads/portfolio-disclosure/${p.year}/${code}_PPFAS_Monthly_Portfolio_Report_${p.monthLong}_${pad(d)}_${p.year}.xlsx`,
      );
      // also try non-padded day
      urls.push(...p.days.map((d) => `https://amc.ppfas.com/downloads/portfolio-disclosure/${p.year}/${code}_PPFAS_Monthly_Portfolio_Report_${p.monthLong}_${d}_${p.year}.xlsx`));
      return tryCandidates(urls, `${period}-${pad(p.lastDay)}`, id.scheme_name);
    },
  },
  {
    amc: "Unifi Mutual Fund",
    match: /unifi/i,
    async fetchPortfolio(period, id) {
      const p = parts(period);
      const s = slug(id.scheme_name);
      const urls = p.days.map((d) => `https://unifimf.com/wp-content/uploads/fund-sheets/MP-Unifi-${s}-${pad(d)}${pad(p.month)}${p.year}.xlsx`);
      return tryCandidates(urls, `${period}-${pad(p.lastDay)}`, id.scheme_name);
    },
  },
  {
    amc: "Helios Mutual Fund",
    match: /helios/i,
    async fetchPortfolio(period, id) {
      const p = parts(period);
      const s = slug(id.scheme_name);
      // uploads path uses the publish month (data month + 1)
      const pub = new Date(p.year, p.month, 1); // month index = next month
      const py = pub.getFullYear();
      const pm = pad(pub.getMonth() + 1);
      const urls: string[] = [];
      for (const d of p.days) {
        urls.push(`https://www.heliosmf.in/wp-content/uploads/${py}/${pm}/${s}-Monthly-Portfolio-as-on-${ordinal(d)}-${p.monthLong}-${p.year}.xlsx`);
        urls.push(`https://www.heliosmf.in/wp-content/uploads/${p.year}/${pad(p.month)}/${s}-Monthly-Portfolio-as-on-${ordinal(d)}-${p.monthLong}-${p.year}.xlsx`);
      }
      return tryCandidates(urls, `${period}-${pad(p.lastDay)}`, id.scheme_name);
    },
  },
  {
    amc: "Groww Mutual Fund",
    match: /groww/i,
    async fetchPortfolio(period, id) {
      const p = parts(period);
      const fy = fyLabel(p.year, p.month, " -"); // "2026 -2027"
      const urls = p.days.map(
        (d) => `https://assets-netstorage.growwmf.in/compliance_docs/Statutory Disclosure/Portfolio/${fy}/Monthly Portfolio- ${p.monthLong} ${d}, ${p.year}.xlsx`,
      ).map((u) => encodeURI(u));
      return tryCandidates(urls, `${period}-${pad(p.lastDay)}`, id.scheme_name);
    },
  },
  {
    amc: "Bank of India Mutual Fund",
    match: /bank of india|boi /i,
    async fetchPortfolio(period, id) {
      const p = parts(period);
      const urls = p.days.map(
        (d) => `https://www.boimf.in/docs/default-source/investorcorner/monthly-portfolio/monthly-portfolio-${pad(d)}-${p.monthLower.slice(0, 3)}-${p.year}.xls`,
      );
      return tryCandidates(urls, `${period}-${pad(p.lastDay)}`, id.scheme_name);
    },
  },
  {
    amc: "NJ Mutual Fund",
    match: /nj mutual|^nj /i,
    async fetchPortfolio(period, id) {
      const p = parts(period);
      const urls = [
        `https://www.njmutualfund.com/pdf/Monthly-Portfolio-Disclosure-as-on-${p.monthLong}-${p.year}.xlsx`,
        `https://www.njmutualfund.com/pdf/Monthly-Portfolio-as-on-${p.monthLong}-${p.year}.xlsx`,
      ];
      return tryCandidates(urls, `${period}-${pad(p.lastDay)}`, id.scheme_name);
    },
  },
  {
    amc: "Shriram Mutual Fund",
    match: /shriram/i,
    async fetchPortfolio(period, id) {
      const p = parts(period);
      const fy = fyLabel(p.year, p.month, "-");
      const base = "https://cdn.shriramamc.in/uploads/Statutory-disclosure/Monthly--Fortnightly--Weekly-Portfolio-of-Scheme(s)/Monthly-Portfolio-for-the-Financial-Year";
      const urls = [
        `${base}/${fy}/Monthly-Portfolio-Shriram-Mutual-Fund-${p.monthLong}-${p.year}.xls`,
        `${base}/${fy}/Monthly-Portfolio-Shriram-Mutual-Fund-${p.monthLong}-${p.year}.xlsx`,
      ].map(encodeURI);
      return tryCandidates(urls, `${period}-${pad(p.lastDay)}`, id.scheme_name);
    },
  },
  {
    amc: "Capitalmind Mutual Fund",
    match: /capitalmind/i,
    async fetchPortfolio(period, id) {
      const p = parts(period);
      const html = await fetchText("https://capitalmindmf.com/statutory-disclosures.html");
      if (!html) return null;
      const re = new RegExp(`Monthly_Portfolio_Disclosure_${p.monthLong}_${p.year}_[a-f0-9]+\\.xlsx`, "i");
      const links = linksMatching(html, "https://capitalmindmf.com/", re);
      const pick = bestMember(links, id.scheme_name) ?? links[0];
      if (!pick) return null;
      return tryCandidates([pick], `${period}-${pad(p.lastDay)}`, id.scheme_name);
    },
  },
  {
    amc: "Old Bridge Mutual Fund",
    match: /old bridge/i,
    async fetchPortfolio(period, id) {
      const p = parts(period);
      const html = await fetchText("https://oldbridgemf.com/statutory-disclosures.html");
      if (!html) return null;
      const monYY = `${p.monthLong}_${String(p.year).slice(2)}`; // "May_26"
      const re = new RegExp(`_Portfolio_${monYY}_[a-f0-9]+\\.xlsx`, "i");
      const links = linksMatching(html, "https://oldbridgemf.com/", re);
      const pick = bestMember(links, id.scheme_name) ?? links[0];
      if (!pick) return null;
      return tryCandidates([pick], `${period}-${pad(p.lastDay)}`, id.scheme_name);
    },
  },
  {
    amc: "Abakkus Mutual Fund",
    match: /abakkus/i,
    async fetchPortfolio(period, id) {
      const p = parts(period);
      const html = await fetchText("https://www.abakkusmf.com/statutory-disclosures.html");
      if (!html) return null;
      const re = new RegExp(`MONTHLY_PORTFOLIO_${pad(p.lastDay)}_${pad(p.month)}_${p.year}_[a-f0-9]+\\.(xlsx|xls)`, "i");
      let links = linksMatching(html, "https://www.abakkusmf.com/", re);
      if (links.length === 0) {
        const re2 = new RegExp(`MONTHLY_PORTFOLIO.*${p.year}.*\\.(xlsx|xls)`, "i");
        links = linksMatching(html, "https://www.abakkusmf.com/", re2);
      }
      if (!links[0]) return null;
      return tryCandidates([links[0]], `${period}-${pad(p.lastDay)}`, id.scheme_name);
    },
  },
  {
    amc: "Samco Mutual Fund",
    match: /samco/i,
    async fetchPortfolio(period, id) {
      const p = parts(period);
      const html = await fetchText("https://www.samcomf.com/StatutoryDisclosure");
      if (!html) return null;
      const re = new RegExp(`IN_MF_MONTHLY_PORTFOLIO_${p.monthLong}_${p.year}_[^"']*\\.xlsx`, "i");
      const links = linksMatching(html, "https://www.samcomf.com/", re);
      const pick = bestMember(links, id.scheme_name) ?? links[0];
      if (!pick) return null;
      return tryCandidates([pick], `${period}-${pad(p.lastDay)}`, id.scheme_name);
    },
  },
  {
    amc: "Quantum Mutual Fund",
    match: /quantum/i,
    async fetchPortfolio(period, id) {
      const p = parts(period);
      // opaque CDN uuids — scrape the combined-portfolio page for a FileCDN/FactSheet link
      const html = await fetchText("https://www.quantumamc.com/portfolio/combined/-1/1/0/0");
      if (!html) return null;
      const links = linksMatching(html, "https://www.quantumamc.com/", /FileCDN\/FactSheet\/[a-f0-9-]+\.xlsx/i);
      if (!links[0]) return null;
      return tryCandidates([links[0]], `${period}-${pad(p.lastDay)}`, id.scheme_name);
    },
  },
  {
    amc: "ICICI Prudential Mutual Fund",
    match: /icici/i,
    async fetchPortfolio(period, id) {
      const p = parts(period);
      const url = encodeURI(
        `https://www.icicipruamc.com/blob/downloads/Files/Monthly Portfolio Disclosures/${p.year}/${p.monthLong}/Monthly-Portfolio-Disclosure-${p.monthLong}-${p.year}.zip`,
      );
      const zipBuf = await fetchBuf(url, 45000);
      if (!zipBuf) return null;
      try {
        const zip = await JSZip.loadAsync(zipBuf);
        const names = Object.keys(zip.files).filter((n) => /\.(xls|xlsx)$/i.test(n));
        const pick = bestMember(names, id.scheme_name) ?? names[0];
        if (!pick) return null;
        const buffer = await zip.files[pick].async("arraybuffer");
        return { buffer, sourceUrl: url, asOfDate: `${period}-${pad(p.lastDay)}`, schemeHint: id.scheme_name };
      } catch {
        return null;
      }
    },
  },
];

export function recipeFor(fundHouse: string): Recipe | null {
  return RECIPES.find((r) => r.match.test(fundHouse)) ?? null;
}

// AMCs we attempt via plain fetch on Terminal AI (Phase 1). Others → upload only.
export const DIRECT_AMCS = RECIPES.map((r) => r.amc);
