import { badRequest, forwardResult, readApiKey, readJsonBody } from "@/lib/api-helpers";
import { tbhApi } from "@/lib/tbh-client";
import type { CreateBotRequest } from "@/types/telebothost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TeleBotHost calls are fast, but a slow upstream response can approach the default
// serverless timeout. 30s covers the client-side request budget with headroom.
export const maxDuration = 30;

/** `GET /api/tbh/bots` — list every bot on the account. */
export async function GET(request: Request) {
  const apiKey = readApiKey(request);
  if (!apiKey) return badRequest("No API key provided.");

  return forwardResult(await tbhApi.listBots(apiKey));
}

/** `POST /api/tbh/bots` — register a new bot from a BotFather token. */
export async function POST(request: Request) {
  const apiKey = readApiKey(request);
  if (!apiKey) return badRequest("No API key provided.");

  const body = await readJsonBody<CreateBotRequest>(request);
  if (!body) return badRequest("A JSON body is required.");

  const botToken = (body.bot_token ?? "").trim();
  const botName = (body.bot_name ?? "").trim();

  if (!botToken) return badRequest("bot_token is required.");
  if (!botName) {
    return badRequest(
      "bot_name is required.",
      "TeleBotHost needs a display name for the bot entry.",
    );
  }
  if (botName.length > 64) return badRequest("bot_name must be 64 characters or fewer.");

  return forwardResult(
    await tbhApi.createBot(apiKey, {
      bot_token: botToken,
      bot_name: botName,
      run_now: body.run_now ?? false,
    }),
  );
}
