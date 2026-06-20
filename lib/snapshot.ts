// Server helper: fetch a normalized snapshot from the DB cache, or lazily
// ingest it (Phase-1 direct AMCs) and cache it. Used by analyse/compare/ai.
import { dbInsert, dbList } from "./db";
import { lazyIngest, type IngestResult } from "./ingest";
import type { AnalyseData } from "./types";

interface SnapshotRow {
  id: string;
  scheme_code: string;
  period: string;
  data: AnalyseData;
  source: string;
}

export async function cachedPeriods(schemeCode: string, token: string | null): Promise<string[]> {
  if (!token) return [];
  try {
    const rows = await dbList<SnapshotRow>("snapshots", { scheme_code: schemeCode }, token);
    return rows.map((r) => r.period);
  } catch {
    return [];
  }
}

// DB cache → else lazy-fetch. Returns the discriminated IngestResult so the
// route can map the reason to honest UI copy.
export async function getSnapshot(
  schemeCode: string,
  period: string,
  token: string | null,
): Promise<IngestResult> {
  if (token) {
    try {
      const rows = await dbList<SnapshotRow>("snapshots", { scheme_code: schemeCode, period }, token);
      const hit = rows.find((r) => r.period === period);
      if (hit?.data) return { ok: true, data: hit.data };
    } catch {
      /* fall through to ingest */
    }
  }
  // Uploaded snapshots live only in the DB — never try to lazy-fetch them.
  if (schemeCode.startsWith("upload-")) return { ok: false, reason: "not_published" };

  const res = await lazyIngest(schemeCode, period, token);
  if (res.ok && token) {
    try {
      await dbInsert("snapshots", { scheme_code: schemeCode, period, source: "fetch", data: res.data }, token);
    } catch {
      /* caching is best-effort */
    }
  }
  return res;
}
