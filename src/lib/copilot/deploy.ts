/**
 * Deploying a copilot-generated command to TeleBotHost.
 *
 * ## The real API, and how it differs from the obvious guess
 *
 * The endpoint and field names below are taken from the live OpenAPI document at
 * `https://api.telebothost.com/api/v1/docs/openapi.json` (v1.0.1) and were confirmed
 * against the running service. Three details are easy to get wrong, and getting any
 * of them wrong means a silent 404 or 401:
 *
 * | Guessed | Actual |
 * |---|---|
 * | `POST /api/v1/bots/{bot_id}/commands` | `POST /api/v1/bot/{botid}/commands` — **singular `bot`** |
 * | `X-Tbh-Api-Key: <key>` | `X-Api-Key: <key>` or `Authorization: Bearer <key>` |
 * | `{ name, logic, keyboard }` | `{ name, **code**, answer, parse_mode, keyboard, … }` |
 *
 * The code field is `code`, not `logic`. There is no `logic` field in the schema.
 *
 * ## Upsert, not blind create
 *
 * TBL matches **exactly one command per trigger**, so creating a second command named
 * `/start` does not replace the first — it produces a bot with two `/start` entries
 * where only one ever runs, and which one is undefined. Redeploying an edited command
 * therefore **updates** the existing one by default rather than appending a duplicate.
 */

import type { TblCommand } from "@/types/telebothost";
import type { CopilotArtifact } from "@/types/copilot";
import { artifactToCommandPayload } from "./schema";
import * as api from "@/lib/client-api";

export type DeployAction = "created" | "updated";

export interface DeployCommandOptions {
  /** The user's TeleBotHost secret key (`sk_…`). Required for writes. */
  apiKey: string;
  /** Numeric TeleBotHost bot id. */
  botId: number;
  artifact: CopilotArtifact;
  /**
   * Commands already on the bot. When supplied, a command with the same trigger is
   * updated in place instead of duplicated.
   */
  existingCommands?: TblCommand[];
  /** Force creation even when the trigger already exists. */
  forceCreate?: boolean;
}

export interface DeployCommandResult {
  ok: boolean;
  action?: DeployAction;
  /** The trigger that was written. */
  commandName?: string;
  /** The TeleBotHost command id, when the response carried one. */
  commandId?: number;
  error?: string;
  hint?: string;
  /** Bytes of code uploaded, for the UI's confirmation line. */
  codeLength?: number;
}

/** Normalise a trigger so `/start` and `start` compare equal when matching. */
function normaliseTrigger(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The exact payload shape TeleBotHost expects.
 *
 * Exported so the UI can show the user precisely what will be sent before they
 * commit — transparency matters when the button says "Deploy directly".
 */
export function buildDeployPayload(artifact: CopilotArtifact) {
  const payload = artifactToCommandPayload(artifact);

  // TeleBotHost rejects an empty `code` on some paths; send an explicit empty string
  // rather than omitting the key so the request shape is always identical.
  return {
    name: payload.name,
    code: payload.code ?? "",
    answer: payload.answer ?? "",
    parse_mode: payload.parse_mode ?? "Markdown",
    keyboard: payload.keyboard ?? "",
    aliases: payload.aliases ?? [],
    need_reply: payload.need_reply ?? false,
    case_insensitive: payload.case_insensitive ?? false,
    allow_only_group: payload.allow_only_group ?? false,
    is_web: payload.is_web ?? 0,
    folder: payload.folder ?? "",
  };
}

/**
 * Write a generated command to TeleBotHost.
 *
 * @example
 * ```ts
 * const result = await deployGeneratedCommand({
 *   apiKey: credentials.telebothost.apiKey,
 *   botId: selectedBot.bot_id,
 *   artifact,
 *   existingCommands,
 * });
 * if (result.ok) toast.success(`Command ${result.action}`);
 * ```
 */
export async function deployGeneratedCommand(
  options: DeployCommandOptions,
): Promise<DeployCommandResult> {
  const { apiKey, botId, artifact, existingCommands = [], forceCreate = false } = options;

  if (!apiKey.trim()) {
    return {
      ok: false,
      error: "No TeleBotHost API key is available.",
      hint: "Add your key under Credentials before deploying.",
    };
  }

  if (!Number.isSafeInteger(botId) || botId <= 0) {
    return {
      ok: false,
      error: "No bot is selected.",
      hint: "Pick a bot in the copilot's context bar so there is something to deploy to.",
    };
  }

  const payload = buildDeployPayload(artifact);

  if (!payload.name.trim()) {
    return { ok: false, error: "The generated command has no trigger name." };
  }

  // -- size guard, mirroring the documented platform limits -----------------
  if (payload.code.length > 100_000) {
    return {
      ok: false,
      error: `The generated code is ${payload.code.length.toLocaleString()} characters, over TeleBotHost's 100,000 limit.`,
      hint: "Ask the copilot to split it into smaller commands.",
    };
  }
  if (payload.answer.length > 10_000) {
    return {
      ok: false,
      error: `The answer text is ${payload.answer.length.toLocaleString()} characters, over the 10,000 limit.`,
    };
  }

  // -- resolve an existing command with the same trigger --------------------
  const target = forceCreate
    ? undefined
    : existingCommands.find(
        (command) => normaliseTrigger(command.name) === normaliseTrigger(payload.name),
      );

  // -- update in place -----------------------------------------------------
  if (target) {
    const result = await api.updateCommand(apiKey, botId, target.id, payload);

    if (!result.ok) {
      return {
        ok: false,
        error: result.error?.message ?? "TeleBotHost rejected the update.",
        hint: result.error?.hint,
      };
    }

    return {
      ok: true,
      action: "updated",
      commandName: payload.name,
      commandId: target.id,
      codeLength: payload.code.length,
    };
  }

  // -- create --------------------------------------------------------------
  const result = await api.createCommand(apiKey, botId, payload);

  if (!result.ok) {
    return {
      ok: false,
      error: result.error?.message ?? "TeleBotHost rejected the command.",
      hint: result.error?.hint,
    };
  }

  // The create response nests the command; pull the id out defensively because the
  // envelope has changed shape between API versions.
  const created = result.data as { command?: { id?: number }; id?: number } | undefined;
  const commandId = created?.command?.id ?? created?.id;

  return {
    ok: true,
    action: "created",
    commandName: payload.name,
    commandId,
    codeLength: payload.code.length,
  };
}

/**
 * Fetch the bot's current commands, for context and for diffing.
 *
 * Returns an empty list rather than throwing, so a transient API failure degrades to
 * "no context" instead of blocking the copilot entirely.
 */
export async function loadBotCommands(
  apiKey: string,
  botId: number,
): Promise<{ commands: TblCommand[]; error?: string }> {
  const result = await api.listCommands(apiKey, botId);

  if (!result.ok || !result.data) {
    return { commands: [], error: result.error?.message ?? "Could not load commands." };
  }

  return { commands: result.data.commands ?? [] };
}

/** Find the existing command that a new artifact would replace, if any. */
export function findExistingCommand(
  artifact: CopilotArtifact,
  commands: TblCommand[],
): TblCommand | undefined {
  const name = normaliseTrigger(artifact.command_name);
  return commands.find((command) => normaliseTrigger(command.name) === name);
}
