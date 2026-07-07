// Read-only diagnostic for the M2/M3 ingest backlog. Cron callbacks get a
// task token that's invisible to us after the fact (Terminal AI calls the
// route server-to-server; we never see that request/response), so this is
// the only way to check on `ingest_runs` progress between sessions without
// a raw SQL console. Uses the same viewer embed-token auth as every other
// user-facing route (app/api/analyse etc.) — NOT the cron task-token path.
import { NextRequest, NextResponse } from "next/server";
import { dbList } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RunRow {
  amc_name: string;
  scheme_code: string | null;
  period: string;
  status: string;
  error?: string;
  created_at: string;
}

export async function GET(req: NextRequest) {
  const token = req.headers.get("x-embed-token");
  if (!token) return NextResponse.json({ error: "missing embed token" }, { status: 401 });

  try {
    const rows = await dbList<RunRow>("ingest_runs", {}, token);

    const byStatus: Record<string, number> = {};
    const byAmc: Record<string, Record<string, number>> = {};
    const recentErrors: { amc_name: string; period: string; status: string; error?: string; created_at: string }[] = [];

    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      byAmc[r.amc_name] = byAmc[r.amc_name] ?? {};
      byAmc[r.amc_name][r.status] = (byAmc[r.amc_name][r.status] ?? 0) + 1;
      if (r.status === "parse_failed" || r.status === "transient") {
        recentErrors.push({ amc_name: r.amc_name, period: r.period, status: r.status, error: r.error, created_at: r.created_at });
      }
    }
    recentErrors.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    return NextResponse.json({
      total_rows: rows.length,
      by_status: byStatus,
      by_amc: byAmc,
      recent_errors: recentErrors.slice(0, 25),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
