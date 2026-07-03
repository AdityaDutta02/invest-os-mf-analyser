// Generic "needs_js" recipe: render the AMC's disclosure page in a real
// browser (survives Akamai/Cloudflare/Radware JS challenges + carries
// session cookies), collect every link matching the registry's link_match
// pattern (typically the archive page lists ALL historically available
// months in one render — not one request per month), then download each
// matched file through the same browser context so cookies/headers persist.
import { chromium, type Browser } from "playwright";
import { linkMatchToRegex } from "./glob.js";
import type { RegistryEntry } from "./registry.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 MF-Disclosure-Archival-Bot (contact: see repo)";

export interface DiscoveredLink {
  url: string;
  text: string;
}

async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({ headless: true });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

export async function discoverLinks(entry: RegistryEntry): Promise<DiscoveredLink[]> {
  const re = linkMatchToRegex(entry.link_match);
  return withBrowser(async (browser) => {
    const context = await browser.newContext({ userAgent: UA });
    const page = await context.newPage();
    try {
      await page.goto(entry.page, { waitUntil: "networkidle", timeout: 45000 });
    } catch {
      // some archive pages never go fully idle (polling widgets); fall back
      // to whatever rendered within the timeout rather than failing outright
      await page.waitForTimeout(3000);
    }
    // Playwright's page.$$eval (not JS eval()) — runs the callback inside the
    // sandboxed browser page context to read DOM attributes, no code injection.
    const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => ({ href: a.getAttribute("href") || "", text: a.textContent?.trim() || "" })));
    const out: DiscoveredLink[] = [];
    const seen = new Set<string>();
    for (const { href, text } of hrefs) {
      if (!href) continue;
      let abs: string;
      try {
        abs = new URL(href, entry.page).toString();
      } catch {
        continue;
      }
      const basename = abs.split("/").pop() || abs;
      if (!re.test(decodeURIComponent(basename)) && !re.test(text)) continue;
      if (seen.has(abs)) continue;
      seen.add(abs);
      out.push({ url: abs, text });
    }
    await context.close();
    return out;
  });
}

// Downloads through the same UA/context style (a plain fetch with a
// convincing UA is usually enough once the link is known — the JS
// challenge is on the *listing* page, not the static file host).
export async function downloadLink(url: string, timeoutMs = 45000): Promise<ArrayBuffer | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" }, redirect: "follow", signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 1000) return null; // error/placeholder pages
    return buf;
  } catch {
    return null;
  }
}

export function jitter(baseMs: number): Promise<void> {
  const delay = baseMs + Math.random() * baseMs;
  return new Promise((r) => setTimeout(r, delay));
}
