import { NextRequest, NextResponse } from "next/server";
import { getIdentity } from "@/lib/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface SchemeMeta {
  id: string;
  category: string;
  asset_class: string;
  nav: number | null;
  nav_date: string | null;
}

// Batch-enrich search results with category + latest NAV (cached per code).
// GET /api/scheme-meta?codes=122640,119065,...
export async function GET(req: NextRequest) {
  const token = req.headers.get("x-embed-token");
  const raw = req.nextUrl.searchParams.get("codes") ?? "";
  const codes = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 15);
  if (codes.length === 0) return NextResponse.json([]);

  const results = await Promise.all(
    codes.map(async (code): Promise<SchemeMeta | null> => {
      try {
        const id = await getIdentity(code, token);
        return {
          id: code,
          category: id.category,
          asset_class: id.asset_class,
          nav: id.latest_nav,
          nav_date: id.latest_nav_date,
        };
      } catch {
        return null;
      }
    }),
  );
  return NextResponse.json(results.filter(Boolean));
}
