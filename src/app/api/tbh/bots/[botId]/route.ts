import {
  badRequest,
  forwardResult,
  parseNumericId,
  readApiKey,
  readJsonBody,
} from "@/lib/api-helpers";
import { tbhApi } from "@/lib/tbh-client";
import type { UpdateBotRequest } from "@/types/telebothost";
import { TBH_BOT_STATUS } from "@/types/telebothost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ botId: string }> };

/** `GET /api/tbh/bots/{botId}` */
export async function GET(request: Request, context: Context) {
  const apiKey = readApiKey(request);
  if (!apiKey) return badRequest("No API key provided.");

  const { botId } = await context.params;
  const id = parseNumericId(botId);
  if (id === null) return badRequest(`"${botId}" is not a valid numeric bot id.`);

  return forwardResult(await tbhApi.getBot(apiKey, id));
}

/**
 * `PATCH /api/tbh/bots/{botId}`
 *
 * This is the endpoint that starts and stops a bot — `status: 1` runs it,
 * `status: 0` halts it. It is also how a bot's token or display name is changed.
 */
export async function PATCH(request: Request, context: Context) {
  const apiKey = readApiKey(request);
  if (!apiKey) return badRequest("No API key provided.");

  const { botId } = await context.params;
  const id = parseNumericId(botId);
  if (id === null) return badRequest(`"${botId}" is not a valid numeric bot id.`);

  const body = await readJsonBody<UpdateBotRequest>(request);
  if (!body) return badRequest("A JSON body is required.");

  const payload: UpdateBotRequest = {};

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) return badRequest("name cannot be empty.");
    payload.name = name;
  }
  if (body.bot_token !== undefined) {
    const token = body.bot_token.trim();
    if (!token) return badRequest("bot_token cannot be empty.");
    payload.bot_token = token;
  }
  if (body.pin !== undefined) payload.pin = Boolean(body.pin);
  if (body.status !== undefined) {
    if (body.status !== TBH_BOT_STATUS.RUNNING && body.status !== TBH_BOT_STATUS.STOPPED) {
      return badRequest("status must be 1 (running) or 0 (stopped).");
    }
    payload.status = body.status;
  }
  if (body.ads_config !== undefined) payload.ads_config = body.ads_config;

  if (Object.keys(payload).length === 0) {
    return badRequest("Provide at least one of: name, bot_token, pin, status, ads_config.");
  }

  return forwardResult(await tbhApi.updateBot(apiKey, id, payload));
}

/** `DELETE /api/tbh/bots/{botId}` — moves the bot to TeleBotHost's deleted list. */
export async function DELETE(request: Request, context: Context) {
  const apiKey = readApiKey(request);
  if (!apiKey) return badRequest("No API key provided.");

  const { botId } = await context.params;
  const id = parseNumericId(botId);
  if (id === null) return badRequest(`"${botId}" is not a valid numeric bot id.`);

  return forwardResult(await tbhApi.deleteBot(apiKey, id));
}
