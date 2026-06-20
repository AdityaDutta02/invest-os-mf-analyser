// Client-side data layer. Every call hits a Next API route, forwarding the
// Terminal AI embed token so the route can reach the gateway (DB / AI).
"use client";

import type {
  AnalyseData,
  AIInsight,
  CompareData,
  PeriodOption,
  SchemeSummary,
  ScreenerRow,
} from "./types";

export interface ApiError extends Error {
  status?: number;
  reason?: string;
}

async function getJSON<T>(url: string, token: string | null): Promise<T> {
  const res = await fetch(url, { headers: token ? { "x-embed-token": token } : {} });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
    const err: ApiError = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.reason = body.reason;
    throw err;
  }
  return res.json() as Promise<T>;
}

export async function searchSchemes(q: string, token: string | null): Promise<SchemeSummary[]> {
  if (!q.trim()) return [];
  return getJSON<SchemeSummary[]>(`/api/schemes?q=${encodeURIComponent(q)}`, token);
}

export interface SchemeMeta {
  id: string;
  category: string;
  asset_class: string;
  nav: number | null;
  nav_date: string | null;
}
export async function fetchSchemeMeta(codes: string[], token: string | null): Promise<SchemeMeta[]> {
  if (codes.length === 0) return [];
  return getJSON<SchemeMeta[]>(`/api/scheme-meta?codes=${encodeURIComponent(codes.join(","))}`, token);
}

export async function fetchPeriods(schemeId: string, token: string | null): Promise<PeriodOption[]> {
  return getJSON<PeriodOption[]>(`/api/periods?scheme=${encodeURIComponent(schemeId)}`, token);
}

export async function fetchAnalyse(
  schemeId: string,
  period: string,
  token: string | null,
): Promise<AnalyseData> {
  return getJSON<AnalyseData>(
    `/api/analyse?scheme=${encodeURIComponent(schemeId)}&period=${encodeURIComponent(period)}`,
    token,
  );
}

export async function fetchCompare(
  schemeId: string,
  a: string,
  b: string,
  token: string | null,
): Promise<CompareData> {
  return getJSON<CompareData>(
    `/api/compare?scheme=${encodeURIComponent(schemeId)}&a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
    token,
  );
}

export async function fetchScreener(token: string | null): Promise<ScreenerRow[]> {
  return getJSON<ScreenerRow[]>(`/api/screen`, token);
}

export async function fetchAIInsight(
  schemeId: string,
  period: string,
  token: string | null,
): Promise<AIInsight | null> {
  const res = await fetch(`/api/ai/insight`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "x-embed-token": token } : {}) },
    body: JSON.stringify({ scheme: schemeId, period }),
  });
  if (!res.ok) return null; // AI is best-effort; never block data on it
  return (await res.json()) as AIInsight;
}

export interface UploadMismatch {
  detected_name: string;
  detected_period: string | null;
  selected_name: string | null;
  selected_period: string | null;
}
export interface UploadResult {
  scheme_id: string;
  scheme_name: string;
  amc_name: string;
  category: string;
  asset_class: SchemeSummary["asset_class"];
  nav: number | null;
  period: string;
  period_label: string;
  holdings_count: number;
  source: "upload" | "pdf";
  partial: boolean;
  mismatch: UploadMismatch | null;
  data: AnalyseData;
}
export async function uploadFactsheet(
  file: File,
  token: string | null,
  ctx?: { scheme?: string | null; period?: string | null; schemeName?: string | null },
): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  if (ctx?.scheme) form.append("scheme", ctx.scheme);
  if (ctx?.period) form.append("period", ctx.period);
  if (ctx?.schemeName) form.append("schemeName", ctx.schemeName);
  const res = await fetch(`/api/upload`, {
    method: "POST",
    headers: token ? { "x-embed-token": token } : {},
    body: form,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const err: ApiError = new Error(body.error || `Upload failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as UploadResult;
}

// Category colour assignment — stable per name, from the editorial palette.
const CAT_VARS = ["--cat-1", "--cat-2", "--cat-3", "--cat-4", "--cat-5", "--cat-6", "--cat-7", "--cat-8"];
export function catColor(index: number, name?: string): string {
  if (name && /cash|treps|receivable/i.test(name)) return "var(--cat-8)";
  return `var(${CAT_VARS[index % CAT_VARS.length]})`;
}
