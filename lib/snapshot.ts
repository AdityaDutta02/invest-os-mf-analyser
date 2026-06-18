// Server helper: fetch a normalized snapshot from the DB cache, or lazily
// ingest it (Phase-1 direct AMCs) and cache it. Used by analyse/compare/ai.
import { dbInsert, dbList } from "./db";
import { lazyIngest } from "./ingest";
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

export async function getSnapshot(
  schemeCode: string,
  period: string,
  token: string | null,
): Promise<AnalyseData | null> {
  if (token) {
    try {
      const rows = await dbList<SnapshotRow>("snapshots", { scheme_code: schemeCode, period }, token);
      const hit = rows.find((r) => r.period === period);
      if (hit?.data) return hit.data;
    } catch {
      /* fall through to ingest */
    }
  }
  const data = await lazyIngest(schemeCode, period);
  if (data && token) {
    try {
      await dbInsert("snapshots", { scheme_code: schemeCode, period, source: "fetch", data }, token);
    } catch {
      /* caching is best-effort */
    }
  }
  return data;
}
