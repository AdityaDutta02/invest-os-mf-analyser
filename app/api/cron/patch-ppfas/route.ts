// One-shot admin patch: writes the small hand-verified JSONL of detailed
// PPFAS disclosures (committed to data-staging, see
// scripts/bulk/build-ppfas-patch.ts) directly via writeSnapshot — small
// enough (a few dozen rows) that plain per-row inserts finish comfortably
// within one invocation, no self-rescheduling chain needed. Delete this
// route once the patch has landed; it's not meant to be a recurring cron.
import { NextRequest, NextResponse } from "next/server";
import { writeSnapshot } from "@/lib/ingest-write";
import type { AnalyseData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GITHUB_REPO = "AdityaDutta02/invest-os-mf-analyser";
const STAGING_BRANCH = "data-staging";
const PATCH_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/${STAGING_BRANCH}/staging/bulk-ready/patches/ppfas-may-june-2026.jsonl`;

interface PatchRow {
  scheme_code: string;
  period: string;
  source: string;
  data: AnalyseData;
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return NextResponse.json({ error: "missing task token" }, { status: 401 });

  const res = await fetch(PATCH_URL, { cache: "no-store" });
  if (!res.ok) return NextResponse.json({ error: `fetch patch -> ${res.status}` }, { status: 502 });
  const text = await res.text();
  const rows: PatchRow[] = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));

  let written = 0;
  const errors: { scheme_code: string; period: string; error: string }[] = [];
  for (const r of rows) {
    try {
      await writeSnapshot("PPFAS Mutual Fund", r.scheme_code, r.period, r.data, r.source, token);
      written++;
    } catch (e) {
      errors.push({ scheme_code: r.scheme_code, period: r.period, error: String(e) });
    }
  }

  return NextResponse.json({ done: true, total: rows.length, written, errors });
}
