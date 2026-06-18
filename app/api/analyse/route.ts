import { NextRequest, NextResponse } from "next/server";
import { getSnapshot } from "@/lib/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const scheme = req.nextUrl.searchParams.get("scheme") ?? "";
  const period = req.nextUrl.searchParams.get("period") ?? "";
  const token = req.headers.get("x-embed-token");
  if (!scheme || !period) {
    return NextResponse.json({ error: "scheme and period are required" }, { status: 400 });
  }
  try {
    const data = await getSnapshot(scheme, period, token);
    if (!data) {
      return NextResponse.json(
        { error: "No stored portfolio for this scheme and month. Upload the factsheet to analyse." },
        { status: 404 },
      );
    }
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
