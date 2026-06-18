import { NextRequest, NextResponse } from "next/server";
import { schemeIdentity } from "@/lib/mfapi";
import { recipeFor } from "@/lib/registry";
import { cachedPeriods } from "@/lib/snapshot";
import { periodLabel } from "@/lib/parse";
import type { PeriodOption } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Last N completed months as "YYYY-MM", latest first.
function recentMonths(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  // start from previous month (current month's disclosure not yet published)
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth(); // 0-based current; previous month = m-1 -> handle
  for (let i = 0; i < n; i++) {
    let mm = m - i;
    let yy = y;
    while (mm <= 0) {
      mm += 12;
      yy -= 1;
    }
    out.push(`${yy}-${String(mm).padStart(2, "0")}`);
  }
  return out;
}

export async function GET(req: NextRequest) {
  const scheme = req.nextUrl.searchParams.get("scheme") ?? "";
  const token = req.headers.get("x-embed-token");
  if (!scheme) return NextResponse.json([]);

  let isDirect = false;
  try {
    const id = await schemeIdentity(scheme);
    isDirect = !!recipeFor(id.fund_house);
  } catch {
    /* ignore — treat as non-direct */
  }
  const cached = new Set(await cachedPeriods(scheme, token));
  const months = recentMonths(12);
  const options: PeriodOption[] = months.map((period) => ({
    period,
    label: periodLabel(period),
    // hasData = already stored, OR fetchable now (direct AMC) so the user can try
    hasData: cached.has(period) || isDirect,
  }));
  return NextResponse.json(options);
}
