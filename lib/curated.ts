// Curated fund picker — verified auto-fetch schemes so the dashboard is fully
// usable without free-text search (which is dev-gated until fully operational).
// Each id is an mfapi scheme code confirmed to resolve via the SEBI-XLS pipeline.
import type { SchemeSummary } from "./types";

export const CURATED: SchemeSummary[] = [
  { id: "122639", scheme_name: "Parag Parikh Flexi Cap Fund", amc_name: "PPFAS Mutual Fund", category: "Flexi Cap", nav: null, asset_class: "equity" },
  { id: "152135", scheme_name: "Helios Flexi Cap Fund", amc_name: "Helios Mutual Fund", category: "Flexi Cap", nav: null, asset_class: "equity" },
  { id: "149450", scheme_name: "Samco Flexi Cap Fund", amc_name: "Samco Mutual Fund", category: "Flexi Cap", nav: null, asset_class: "equity" },
  { id: "153738", scheme_name: "Capitalmind Flexi Cap Fund", amc_name: "Capitalmind Mutual Fund", category: "Flexi Cap", nav: null, asset_class: "equity" },
];

// Free-text search is only shown when explicitly enabled (dev track). In prod it
// stays hidden and the curated picker + upload are the entry points.
export const SEARCH_DEV = process.env.NEXT_PUBLIC_SEARCH_DEV === "1";
