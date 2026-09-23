import { NextResponse } from "next/server";
import { tbhApi } from "@/lib/tbh-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/tbh/status`
 *
 * Proxies TeleBotHost's public health probe. Used by the setup screen to prove
 * the API is reachable *before* the user commits to entering a key.
 */
export async function GET() {
  const result = await tbhApi.status();

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status && result.status >= 400 ? result.status : 502 },
    );
  }

  return NextResponse.json(
    { ok: true, data: result.data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
