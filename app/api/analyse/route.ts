import { NextRequest, NextResponse } from "next/server";
import { getSnapshot } from "@/lib/snapshot";
import type { IngestReason } from "@/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Honest, specific copy per reason. `transient` is a soft failure (retryable);
// the rest are "no data — upload" variants the client renders as the nodata state.
const COPY: Record<IngestReason, { status: number; message: string }> = {
  not_covered: { status: 404, message: "This fund isn't auto-fetched yet — upload its monthly portfolio to analyse." },
  not_published: { status: 404, message: "No portfolio found for this month yet — try another month or upload the file." },
  parse_failed: { status: 404, message: "Found the source file but couldn't parse it — upload it manually to analyse." },
  transient: { status: 503, message: "Couldn't reach the data source just now. Retry in a moment, or upload the file." },
};

export async function GET(req: NextRequest) {
  const scheme = req.nextUrl.searchParams.get("scheme") ?? "";
  const period = req.nextUrl.searchParams.get("period") ?? "";
  const token = req.headers.get("x-embed-token");
  if (!scheme || !period) {
    return NextResponse.json({ error: "scheme and period are required" }, { status: 400 });
  }
  try {
    const res = await getSnapshot(scheme, period, token);
    if (res.ok) return NextResponse.json(res.data);
    const c = COPY[res.reason];
    return NextResponse.json({ error: c.message, reason: res.reason }, { status: c.status });
  } catch (e) {
    return NextResponse.json(
      { error: "Couldn't reach the data source just now. Retry in a moment, or upload the file.", reason: "transient" },
      { status: 503 },
    );
  }
}
