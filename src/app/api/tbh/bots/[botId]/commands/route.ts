import {
  badRequest,
  forwardResult,
  parseNumericId,
  readApiKey,
  readJsonBody,
} from "@/lib/api-helpers";
import { tbhApi } from "@/lib/tbh-client";
import { TBH_CAPACITY, type CreateCommandRequest } from "@/types/telebothost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ botId: string }> };

const ALLOWED_PARSE_MODES = new Set(["Markdown", "HTML", "MarkdownV2"]);

/** `GET /api/tbh/bots/{botId}/commands` — every command plus the folder list. */
export async function GET(request: Request, context: Context) {
  const apiKey = readApiKey(request);
  if (!apiKey) return badRequest("No API key provided.");

  const { botId } = await context.params;
  const id = parseNumericId(botId);
  if (id === null) return badRequest(`"${botId}" is not a valid numeric bot id.`);

  return forwardResult(await tbhApi.listCommands(apiKey, id));
}

/**
 * `POST /api/tbh/bots/{botId}/commands`
 *
 * Validates the compiled payload against TeleBotHost's documented capacity caps
 * *before* forwarding, so an oversized command fails with a clear message rather
 * than an opaque upstream error.
 */
export async function POST(request: Request, context: Context) {
  const apiKey = readApiKey(request);
  if (!apiKey) return badRequest("No API key provided.");

  const { botId } = await context.params;
  const id = parseNumericId(botId);
  if (id === null) return badRequest(`"${botId}" is not a valid numeric bot id.`);

  const body = await readJsonBody<CreateCommandRequest>(request);
  if (!body) return badRequest("A JSON body is required.");

  const name = (body.name ?? "").trim();
  if (!name) {
    return badRequest(
      "A command name is required.",
      "The name is the trigger, e.g. /start or Help. Use * for the wildcard fallback.",
    );
  }
  if (name.length > 200) return badRequest("Command name must be 200 characters or fewer.");

  const code = body.code ?? "";
  const answer = body.answer ?? "";

  if (code.length > TBH_CAPACITY.maxCommandCodeChars) {
    return badRequest(
      `Generated logic is ${code.length.toLocaleString()} characters, over the ${TBH_CAPACITY.maxCommandCodeChars.toLocaleString()} limit.`,
      "Simplify the flow, or split it across several commands.",
    );
  }
  if (answer.length > TBH_CAPACITY.maxAnswerChars) {
    return badRequest(
      `Response text is ${answer.length.toLocaleString()} characters, over the ${TBH_CAPACITY.maxAnswerChars.toLocaleString()} limit.`,
    );
  }

  const parseMode = body.parse_mode ?? "Markdown";
  if (!ALLOWED_PARSE_MODES.has(parseMode)) {
    return badRequest(
      `parse_mode "${parseMode}" is not supported.`,
      "Use Markdown, HTML or MarkdownV2.",
    );
  }

  const aliases = Array.isArray(body.aliases)
    ? body.aliases.map((alias) => String(alias).trim()).filter((alias) => alias.length > 0)
    : [];

  return forwardResult(
    await tbhApi.createCommand(apiKey, id, {
      name,
      code,
      answer,
      parse_mode: parseMode,
      keyboard: body.keyboard ?? "",
      aliases,
      allow_only_group: Boolean(body.allow_only_group),
      need_reply: Boolean(body.need_reply),
      case_insensitive: Boolean(body.case_insensitive),
      is_web: body.is_web ?? 0,
      folder: body.folder ?? "",
    }),
  );
}

/**
 * `DELETE /api/tbh/bots/{botId}/commands`
 *
 * Removes every command on the bot. Used before a redeploy so the deployed state
 * exactly matches the builder instead of accumulating duplicates.
 */
export async function DELETE(request: Request, context: Context) {
  const apiKey = readApiKey(request);
  if (!apiKey) return badRequest("No API key provided.");

  const { botId } = await context.params;
  const id = parseNumericId(botId);
  if (id === null) return badRequest(`"${botId}" is not a valid numeric bot id.`);

  return forwardResult(await tbhApi.deleteAllCommands(apiKey, id));
}
