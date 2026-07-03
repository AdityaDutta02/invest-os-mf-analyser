// Entry point (`npm run run` inside worker/, invoked by
// .github/workflows/scrape-backfill.yml). Discovers + downloads files for
// "needs_js" AMCs and writes them under staging/ in the repo working copy.
// The workflow commits staging/ to a dedicated `data-staging` branch (never
// `main` — that branch only ever holds app code, so pushing data here can't
// affect the deployed app). A Terminal AI scheduled task then pulls from
// that branch (plain HTTPS, no token needed for a public repo) and does the
// actual parse+DB-write with a real task token (see app/api/cron/*).
//
// "needs_form" AMCs (year/month select before a link appears) aren't
// covered by this generic recipe yet — logged and skipped, tracked as a
// follow-up per the plan (M4).
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRegistry, slugify, type RegistryEntry } from "./registry.js";
import { discoverLinks, downloadLink, jitter } from "./scrape.js";

interface ManifestEntry {
  amc: string;
  source_url: string;
  link_text: string;
  staged_path: string;
  format: string;
  packaging: string;
}

function parseArgs(): { amc?: string; limit: number } {
  const args = process.argv.slice(2);
  const amcIdx = args.indexOf("--amc");
  const limitIdx = args.indexOf("--limit");
  return {
    amc: amcIdx >= 0 ? args[amcIdx + 1] : undefined,
    limit: limitIdx >= 0 ? Number(args[limitIdx + 1]) : 25,
  };
}

async function processAmc(entry: RegistryEntry, stagingDir: string, manifest: ManifestEntry[], limit: number): Promise<void> {
  console.log(`[${entry.amc}] discovering links at ${entry.page}`);
  let links;
  try {
    links = await discoverLinks(entry);
  } catch (e) {
    console.error(`[${entry.amc}] discovery failed:`, e instanceof Error ? e.message : e);
    return;
  }
  console.log(`[${entry.amc}] found ${links.length} matching links`);
  const slug = slugify(entry.amc);
  const amcDir = join(stagingDir, slug);
  mkdirSync(amcDir, { recursive: true });

  // Skip links already staged in a prior run (manifest persists across
  // invocations via the committed data-staging branch — re-run picks up
  // where it left off instead of re-downloading everything).
  const already = new Set(manifest.filter((m) => m.amc === entry.amc).map((m) => m.source_url));

  let staged = 0;
  for (const link of links) {
    if (staged >= limit) {
      console.log(`[${entry.amc}] hit --limit=${limit}, remaining links deferred to next run`);
      break;
    }
    if (already.has(link.url)) continue;
    await jitter(1500); // polite delay between requests to the same AMC host
    const buf = await downloadLink(link.url);
    if (!buf) {
      console.warn(`[${entry.amc}] download failed: ${link.url}`);
      continue;
    }
    const basename = decodeURIComponent(link.url.split("/").pop() || "file");
    const safeName = basename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const stagedPath = join(slug, `${Date.now()}_${safeName}`);
    writeFileSync(join(stagingDir, stagedPath), new Uint8Array(buf));
    manifest.push({ amc: entry.amc, source_url: link.url, link_text: link.text, staged_path: stagedPath, format: entry.format, packaging: entry.packaging });
    staged++;
    console.log(`[${entry.amc}] staged ${basename}`);
  }
}

async function main(): Promise<void> {
  const { amc, limit } = parseArgs();
  const registry = loadRegistry();
  const targets = registry.verified.filter((e) => e.fetch === "needs_js" && (!amc || e.amc === amc));
  if (targets.length === 0) {
    console.log("No needs_js registry entries matched — nothing to do.");
    return;
  }

  const repoRoot = join(process.cwd(), "..");
  const stagingDir = join(repoRoot, "staging");
  mkdirSync(stagingDir, { recursive: true });
  const manifestPath = join(stagingDir, "manifest.json");
  const manifest: ManifestEntry[] = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];

  for (const entry of targets) {
    await processAmc(entry, stagingDir, manifest, limit);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2)); // checkpoint after each AMC
  }

  console.log(`Done. Manifest has ${manifest.length} staged files total.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
