// DEV-ONLY diagnostic route. Runs the gateway document parser (and local fallback)
// against a bundled sample factsheet and returns what each path produced. Used to
// verify the gateway /parse endpoint in the deployed environment, then removed.
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { diagnosePdf } from "@/lib/pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  if (!token) return NextResponse.json({ error: "Missing embed token" }, { status: 401 });

  let buf: Buffer;
  try {
    buf = await readFile(join(process.cwd(), "public/__dev/sample-factsheet.pdf"));
  } catch (e) {
    return NextResponse.json({ error: "sample not found: " + (e as Error).message }, { status: 500 });
  }
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

  try {
    const diag = await diagnosePdf(ab, token, "hdfc-liquid-sample.pdf");
    return NextResponse.json(diag);
  } catch (e) {
    const err = e as Error & { code?: string };
    return NextResponse.json({ error: err.message, code: err.code ?? null }, { status: 500 });
  }
}
