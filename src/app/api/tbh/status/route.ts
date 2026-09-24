import { NextResponse } from "next/server";
import { tbhApi } from "@/lib/tbh-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TeleBotHost calls are fast, but a slow upstream response can approach the default
// serverless timeout. 30s covers the client-side request budget with headroom.
export const maxDuration = 30;

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
