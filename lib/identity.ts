// DB-cached scheme identity (mfapi is the source; scheme_meta is the cache).
// Reduces outbound mfapi calls and survives transient mfapi blips.
import { dbInsert, dbList } from "./db";
import { schemeIdentity, type SchemeIdentity } from "./mfapi";

interface MetaRow {
  scheme_code: string;
  data: SchemeIdentity;
}

// 24h freshness is plenty — identity (name/category/isin/inception) is static;
// only NAV drifts and analyse re-derives period-accurate NAV separately.
const TTL_MS = 24 * 60 * 60 * 1000;
const mem = new Map<string, { id: SchemeIdentity; at: number }>();

export async function getIdentity(code: string, token: string | null): Promise<SchemeIdentity> {
  const hit = mem.get(code);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.id;

  if (token) {
    try {
      const rows = await dbList<MetaRow>("scheme_meta", { scheme_code: code }, token);
      const row = rows.find((r) => r.scheme_code === code);
      if (row?.data?.scheme_name) {
        mem.set(code, { id: row.data, at: Date.now() });
        return row.data;
      }
    } catch {
      /* fall through to live */
    }
  }

  const id = await schemeIdentity(code);
  mem.set(code, { id, at: Date.now() });
  if (token) {
    try {
      await dbInsert("scheme_meta", { scheme_code: code, data: id }, token);
    } catch {
      /* best-effort cache */
    }
  }
  return id;
}
