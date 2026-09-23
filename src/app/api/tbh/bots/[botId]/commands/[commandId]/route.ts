import {
  badRequest,
  forwardResult,
  parseNumericId,
  readApiKey,
  readJsonBody,
} from "@/lib/api-helpers";
import { tbhApi } from "@/lib/tbh-client";
import { TBH_CAPACITY, type UpdateCommandRequest } from "@/types/telebothost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ botId: string; commandId: string }> };

type ResolvedIds =
  | { ok: true; bot: number; command: number }
  | { ok: false; message: string };

async function resolveIds(context: Context): Promise<ResolvedIds> {
  const { botId, commandId } = await context.params;
  const bot = parseNumericId(botId);
  const command = parseNumericId(commandId);

  if (bot === null) {
    return { ok: false, message: `"${botId}" is not a valid numeric bot id.` };
  }
  if (command === null) {
    return { ok: false, message: `"${commandId}" is not a valid numeric command id.` };
  }

  return { ok: true, bot, command };
}

/**
 * `GET /api/tbh/bots/{botId}/commands/{commandId}`
 *
 * TeleBotHost has no single-command read endpoint that returns the full record
 * without side effects, so we read the collection and narrow it here. One upstream
 * call, and the client still gets a single object.
 */
export async function GET(request: Request, context: Context) {
  const apiKey = readApiKey(request);
  if (!apiKey) return badRequest("No API key provided.");

  const ids = await resolveIds(context);
  if (!ids.ok) return badRequest(ids.message);

  const result = await tbhApi.listCommands(apiKey, ids.bot);
  if (!result.ok) return forwardResult(result);

  const payload = result.data as { commands?: Array<{ id: number }> } | undefined;
  const match = payload?.commands?.find((command) => command.id === ids.command);

  if (!match) {
    return forwardResult({
      ok: false,
      status: 404,
      rateLimit: result.rateLimit,
      error: { message: `Command ${ids.command} was not found on bot ${ids.bot}.` },
    });
  }

  return forwardResult({
    ok: true,
    status: 200,
    data: match,
    rateLimit: result.rateLimit,
  });
}

/** `PATCH /api/tbh/bots/{botId}/commands/{commandId}` */
export async function PATCH(request: Request, context: Context) {
  const apiKey = readApiKey(request);
  if (!apiKey) return badRequest("No API key provided.");

  const ids = await resolveIds(context);
  if (!ids.ok) return badRequest(ids.message);

  const body = await readJsonBody<UpdateCommandRequest>(request);
  if (!body) return badRequest("A JSON body is required.");

  if (typeof body.code === "string" && body.code.length > TBH_CAPACITY.maxCommandCodeChars) {
    return badRequest(
      `Generated logic is ${body.code.length.toLocaleString()} characters, over the ${TBH_CAPACITY.maxCommandCodeChars.toLocaleString()} limit.`,
    );
  }
  if (
    typeof body.answer === "string" &&
    body.answer.length > TBH_CAPACITY.maxAnswerChars
  ) {
    return badRequest(
      `Response text is ${body.answer.length.toLocaleString()} characters, over the ${TBH_CAPACITY.maxAnswerChars.toLocaleString()} limit.`,
    );
  }

  const payload: UpdateCommandRequest = { ...body };
  if (typeof payload.name === "string") {
    const name = payload.name.trim();
    if (!name) return badRequest("Command name cannot be empty.");
    payload.name = name;
  }
  if (Array.isArray(payload.aliases)) {
    payload.aliases = payload.aliases
      .map((alias) => String(alias).trim())
      .filter((alias) => alias.length > 0);
  }

  return forwardResult(await tbhApi.updateCommand(apiKey, ids.bot, ids.command, payload));
}

/** `DELETE /api/tbh/bots/{botId}/commands/{commandId}` */
export async function DELETE(request: Request, context: Context) {
  const apiKey = readApiKey(request);
  if (!apiKey) return badRequest("No API key provided.");

  const ids = await resolveIds(context);
  if (!ids.ok) return badRequest(ids.message);

  return forwardResult(await tbhApi.deleteCommand(apiKey, ids.bot, ids.command));
}
