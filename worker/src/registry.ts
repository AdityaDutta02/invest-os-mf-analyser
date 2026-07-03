import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dirname, "..", "..", "amc-registry.json");

export interface RegistryEntry {
  amc: string;
  page: string;
  fetch: "direct" | "needs_js" | "needs_form";
  format: string;
  packaging: "single_workbook" | "per_scheme" | "zip";
  link_match: string;
  example?: string;
  archive?: string;
  notes?: string;
}

interface RegistryFile {
  verified: RegistryEntry[];
  pending: { amc: string; page: string | null; reason: string }[];
}

export function loadRegistry(): RegistryFile {
  const raw = readFileSync(REGISTRY_PATH, "utf8");
  return JSON.parse(raw) as RegistryFile;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/mutual fund/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
