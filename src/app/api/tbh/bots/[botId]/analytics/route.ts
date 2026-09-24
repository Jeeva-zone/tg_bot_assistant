import { badRequest, forwardResult, parseNumericId, readApiKey } from "@/lib/api-helpers";
import { tbhApi } from "@/lib/tbh-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TeleBotHost calls are fast, but a slow upstream response can approach the default
// serverless timeout. 30s covers the client-side request budget with headroom.
export const maxDuration = 30;

type Context = { params: Promise<{ botId: string }> };

/**
 * `GET /api/tbh/bots/{botId}/analytics`
 *
 * User counts, activity windows and chat-type breakdown. Note that TeleBotHost
 * recalculates these periodically rather than in real time, so the UI shows
 * `calculated_at` alongside the numbers instead of implying they are live.
 */
export async function GET(request: Request, context: Context) {
  const apiKey = readApiKey(request);
  if (!apiKey) return badRequest("No API key provided.");

  const { botId } = await context.params;
  const id = parseNumericId(botId);
  if (id === null) return badRequest(`"${botId}" is not a valid numeric bot id.`);

  return forwardResult(await tbhApi.analytics(apiKey, id));
}
