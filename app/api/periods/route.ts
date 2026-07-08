import { NextRequest, NextResponse } from "next/server";
import { getIdentity } from "@/lib/identity";
import { recipeFor } from "@/lib/registry";
import { cachedPeriods } from "@/lib/snapshot";
import { periodLabel } from "@/lib/parse";
import type { PeriodOption, PeriodStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function monthKey(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

// Months from `latest` going back `n`, newest first, as "YYYY-MM".
function monthsBack(latestY: number, latestM: number, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    let m = latestM - i;
    let y = latestY;
    while (m <= 0) { m += 12; y -= 1; }
    out.push(monthKey(y, m));
  }
  return out;
}

export async function GET(req: NextRequest) {
  const scheme = req.nextUrl.searchParams.get("scheme") ?? "";
  const token = req.headers.get("x-embed-token");
  if (!scheme) return NextResponse.json([]);

  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1; // 1-12
  const day = now.getUTCDate();
  // Disclosure for month X is published by ~10th of X+1. So the latest *published*
  // month is the previous month once we're past the 10th, else two months back.
  let ly = y, lm = m - (day >= 10 ? 1 : 2);
  while (lm <= 0) { lm += 12; ly -= 1; }
  const latestPublished = monthKey(ly, lm);

  let isDirect = false;
  let inceptionMonth = "0000-00";
  try {
    const id = await getIdentity(scheme, token);
    isDirect = !!recipeFor(id.fund_house);
    if (id.inception_date) inceptionMonth = id.inception_date.slice(0, 7);
  } catch {
    /* treat as non-direct, unknown inception */
  }

  const cached = new Set(scheme.startsWith("upload-") ? [] : await cachedPeriods(scheme, token));
  // Union the rolling 18-month window with every period actually in the DB —
  // a bulk-loaded archive can reach back years further than 18 months, and
  // without this union that history is invisible in the period picker even
  // though the data is sitting right there in `snapshots`.
  const months = [...new Set([...monthsBack(ly, lm, 18), ...cached])]
    .filter((p) => p >= inceptionMonth)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // newest-first

  const options: PeriodOption[] = months.map((period) => {
    let status: PeriodStatus;
    if (cached.has(period)) status = "ready";
    else if (isDirect && period <= latestPublished) status = "fetchable";
    else status = "upload";
    return { period, label: periodLabel(period), status, hasData: status !== "upload" };
  });
  return NextResponse.json(options);
}
