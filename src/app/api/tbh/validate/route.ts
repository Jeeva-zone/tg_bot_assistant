import { forwardResult, readApiKey } from "@/lib/api-helpers";
import { tbhApi } from "@/lib/tbh-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TeleBotHost calls are fast, but a slow upstream response can approach the default
// serverless timeout. 30s covers the client-side request budget with headroom.
export const maxDuration = 30;

/**
 * `GET /api/tbh/validate`
 *
 * Validates a TeleBotHost API key by making a real authenticated call.
 *
 * We hit `GET /bot` rather than `/status` because `/status` is public and would
 * happily return 200 for a garbage key — a false "valid". Listing bots proves the
 * key is genuinely accepted and also tells us whether it is a read-only `pub_*`
 * key (which fails here) or a writable `sk_*` key.
 */
export async function GET(request: Request) {
  const apiKey = readApiKey(request);

  if (!apiKey) {
    return forwardResult({
      ok: false,
      status: 400,
      error: {
        message: "No API key provided.",
        hint: "Send your TeleBotHost key in the x-tbh-key header.",
      },
    });
  }

  const result = await tbhApi.listBots(apiKey);

  if (!result.ok && result.status === 401) {
    return forwardResult({
      ok: false,
      status: 401,
      rateLimit: result.rateLimit,
      error: {
        message: "TeleBotHost rejected this API key.",
        hint: "Check the key in console.telebothost.com. Note that pub_* keys are read-only and cannot be used to deploy.",
      },
    });
  }

  return forwardResult(result);
}
