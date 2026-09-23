/**
 * The deployment engine.
 *
 * Why this runs in the browser rather than in a route handler
 * ----------------------------------------------------------
 * Deploying means one HTTP call per command. Netlify Functions are capped at
 * roughly 10–26 seconds, so a 40-command bot would be killed mid-deploy and leave
 * the bot half-configured. Driving the sequence from the client keeps every
 * individual request short, survives any function timeout, and lets us stream real
 * progress into the UI.
 *
 * Rate limits are the other constraint. TeleBotHost's FREE tier allows only
 * **15 requests per minute**, so a naive "fire 30 requests" loop trips the strike
 * system and can get the account throttled. The pacer below watches the
 * documented `X-RateLimit-*-Minute` headers and parks the queue before it gets
 * anywhere near a 429.
 */

import type {
  BotProject,
  DeploymentLogLine,
} from "@/types/builder";
import type { BotListItem, TbhRateLimit } from "@/types/telebothost";
import { compileProject } from "./compiler";
import * as api from "./client-api";

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Deployment cancelled."));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Deployment cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Paces outbound requests so we never blow the per-minute quota.
 *
 * Two mechanisms: a small fixed gap to avoid hammering, and a hard block until the
 * documented minute window resets once the remaining allowance gets critical.
 */
class RatePacer {
  private lastRequestAt = 0;
  private blockedUntil = 0;
  private baseGapMs: number;

  constructor(baseGapMs = 250) {
    this.baseGapMs = baseGapMs;
  }

  async wait(signal?: AbortSignal): Promise<void> {
    const now = Date.now();
    const earliest = Math.max(this.lastRequestAt + this.baseGapMs, this.blockedUntil);
    if (earliest > now) {
      await sleep(earliest - now, signal);
    }
    this.lastRequestAt = Date.now();
  }

  /** React to the quota headers on a response. */
  observe(rateLimit?: TbhRateLimit): number {
    if (!rateLimit) return 0;

    const remaining = rateLimit.remainingMinute;
    const resetAt = rateLimit.resetMinute;

    if (
      typeof remaining === "number" &&
      typeof resetAt === "number" &&
      remaining <= 2
    ) {
      const untilMs = resetAt * 1000 + 400;
      if (untilMs > Date.now()) {
        this.blockedUntil = untilMs;
        return Math.max(0, untilMs - Date.now());
      }
    }
    return 0;
  }

  /** Honour an explicit 429 with `retry_after`. */
  blockFor(seconds: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + seconds * 1000 + 500);
  }
}

export interface DeployOptions {
  apiKey: string;
  botToken: string;
  /** Display name for the bot entry on TeleBotHost. */
  botName: string;
  project: BotProject;
  /** Reuse an existing TeleBotHost bot with the same username instead of creating one. */
  reuseExistingBot: boolean;
  /** Wipe existing commands first, so the deployed state matches the builder exactly. */
  clearExistingCommands: boolean;
  /** Flip the bot to running once commands are in place. */
  startAfterDeploy: boolean;
  onLog: (line: DeploymentLogLine) => void;
  onProgress?: (completed: number, total: number) => void;
  signal?: AbortSignal;
}

export interface DeployOutcome {
  success: boolean;
  botId?: number;
  botUsername?: string;
  commandCount: number;
  durationMs: number;
  error?: string;
  hint?: string;
  rateLimit?: TbhRateLimit;
}

export async function deployProject(options: DeployOptions): Promise<DeployOutcome> {
  const {
    apiKey,
    botToken,
    botName,
    project,
    reuseExistingBot,
    clearExistingCommands,
    startAfterDeploy,
    onLog,
    onProgress,
    signal,
  } = options;

  const startedAt = Date.now();
  const pacer = new RatePacer();

  const log = (level: DeploymentLogLine["level"], message: string) =>
    onLog({ at: new Date().toISOString(), level, message });

  const elapsed = () => Date.now() - startedAt;

  try {
    // -- 1. Compile ---------------------------------------------------------
    log("info", "Compiling the visual builder into TeleBotHost commands…");
    const compiled = compileProject(project);

    for (const diagnostic of compiled.diagnostics) {
      log(
        diagnostic.level === "error" ? "error" : "warn",
        `${diagnostic.nodeLabel ? `[${diagnostic.nodeLabel}] ` : ""}${diagnostic.message}`,
      );
    }

    if (compiled.hasErrors) {
      return {
        success: false,
        commandCount: 0,
        durationMs: elapsed(),
        error: "Compilation failed — fix the errors above before deploying.",
      };
    }

    log(
      "success",
      `Compiled ${compiled.commands.length} command(s) from ${compiled.stats.nodeCount} builder node(s)` +
        (compiled.stats.skipped > 0 ? `, ${compiled.stats.skipped} disabled and skipped` : "") +
        ".",
    );

    // -- 2. Verify the bot token with Telegram ------------------------------
    log("info", "Verifying the bot token with Telegram…");
    const tokenCheck = await api.validateBotToken(botToken);
    if (!tokenCheck.ok || !tokenCheck.data) {
      return {
        success: false,
        commandCount: 0,
        durationMs: elapsed(),
        error: tokenCheck.error?.message ?? "Telegram rejected the bot token.",
        hint: tokenCheck.error?.hint,
      };
    }

    const botUsername = tokenCheck.data.username;
    const telegramBotId = tokenCheck.data.id;
    log("success", `Token is valid — @${botUsername} (id ${telegramBotId}).`);

    // -- 3. Verify the TeleBotHost key -------------------------------------
    log("info", "Verifying the TeleBotHost API key…");
    await pacer.wait(signal);
    const keyCheck = await api.listBots(apiKey);
    pacer.observe(keyCheck.rateLimit);

    if (!keyCheck.ok || !keyCheck.data) {
      return {
        success: false,
        commandCount: 0,
        durationMs: elapsed(),
        error: keyCheck.error?.message ?? "TeleBotHost rejected the API key.",
        hint: keyCheck.error?.hint,
        rateLimit: keyCheck.rateLimit,
      };
    }

    const existingBots: BotListItem[] = keyCheck.data.bots ?? [];
    log("success", `API key accepted — account has ${existingBots.length} bot(s).`);

    // -- 4. Find or create the bot -----------------------------------------
    let bot = existingBots.find(
      (candidate) =>
        candidate.bot_username?.toLowerCase() === botUsername.toLowerCase(),
    );

    if (bot && !reuseExistingBot) {
      log(
        "warn",
        `@${botUsername} is already registered on TeleBotHost as bot ${bot.bot_id}. Reusing it — set "Reuse existing bot" off to force a fresh entry instead.`,
      );
    }

    if (!bot) {
      log("info", `Registering @${botUsername} with TeleBotHost…`);
      await pacer.wait(signal);
      const created = await api.createBot(apiKey, {
        bot_token: botToken,
        bot_name: botName.trim() || botUsername,
        run_now: false,
      });
      pacer.observe(created.rateLimit);

      if (!created.ok || !created.data?.bot) {
        return {
          success: false,
          commandCount: 0,
          durationMs: elapsed(),
          error: created.error?.message ?? "TeleBotHost could not register this bot.",
          hint: created.error?.hint,
          rateLimit: created.rateLimit,
        };
      }

      bot = created.data.bot;
      log("success", `Bot registered as id ${bot.bot_id}.`);
    } else {
      log("info", `Using existing bot id ${bot.bot_id}.`);
    }

    const botId = bot.bot_id;

    // -- 5. Optionally clear existing commands -----------------------------
    if (clearExistingCommands) {
      log("info", "Clearing existing commands for a clean deploy…");
      await pacer.wait(signal);
      const cleared = await api.deleteAllCommands(apiKey, botId);
      pacer.observe(cleared.rateLimit);

      if (!cleared.ok) {
        log(
          "warn",
          `Could not clear existing commands (${cleared.error?.message ?? "unknown error"}). Continuing — duplicates may be created.`,
        );
      } else {
        log("success", "Existing commands cleared.");
      }
    }

    // -- 6. Upload commands -------------------------------------------------
    const total = compiled.commands.length;
    let uploaded = 0;

    if (total > 0) {
      log("info", `Uploading ${total} command(s)…`);
    }

    for (const command of compiled.commands) {
      const pause = pacer.observe(undefined);
      if (pause > 0) {
        log("warn", `Approaching the per-minute quota — pausing ${Math.ceil(pause / 1000)}s.`);
      }
      await pacer.wait(signal);

      const result = await api.createCommand(apiKey, botId, {
        name: command.name,
        code: command.code ?? "",
        answer: command.answer ?? "",
        parse_mode: command.parse_mode ?? "Markdown",
        keyboard: command.keyboard ?? "",
        aliases: command.aliases ?? [],
        allow_only_group: command.allow_only_group ?? false,
        need_reply: command.need_reply ?? false,
        case_insensitive: command.case_insensitive ?? false,
        is_web: command.is_web ?? 0,
        folder: command.folder ?? "",
      });

      const waitMs = pacer.observe(result.rateLimit);
      if (waitMs > 0) {
        log("warn", `Quota nearly exhausted — throttling for ${Math.ceil(waitMs / 1000)}s.`);
      }

      if (!result.ok) {
        if (result.status === 429 && result.error?.retryAfter) {
          pacer.blockFor(result.error.retryAfter);
          log(
            "warn",
            `Rate limited on "${command.name}". Waiting ${result.error.retryAfter}s and retrying once…`,
          );
          await pacer.wait(signal);

          const retry = await api.createCommand(apiKey, botId, {
            name: command.name,
            code: command.code ?? "",
            answer: command.answer ?? "",
            parse_mode: command.parse_mode ?? "Markdown",
            keyboard: command.keyboard ?? "",
            aliases: command.aliases ?? [],
            allow_only_group: command.allow_only_group ?? false,
            need_reply: command.need_reply ?? false,
            case_insensitive: command.case_insensitive ?? false,
            is_web: command.is_web ?? 0,
            folder: command.folder ?? "",
          });
          pacer.observe(retry.rateLimit);

          if (retry.ok) {
            uploaded += 1;
            onProgress?.(uploaded, total);
            log("success", `Uploaded "${command.name}" (after retry).`);
            continue;
          }

          return {
            success: false,
            botId,
            botUsername,
            commandCount: uploaded,
            durationMs: elapsed(),
            error: `Uploading "${command.name}" failed after a retry: ${retry.error?.message ?? "unknown error"}`,
            hint: retry.error?.hint,
            rateLimit: retry.rateLimit,
          };
        }

        return {
          success: false,
          botId,
          botUsername,
          commandCount: uploaded,
          durationMs: elapsed(),
          error: `Uploading "${command.name}" failed: ${result.error?.message ?? "unknown error"}`,
          hint: result.error?.hint,
          rateLimit: result.rateLimit,
        };
      }

      uploaded += 1;
      onProgress?.(uploaded, total);
      log("success", `Uploaded "${command.name}" (${uploaded}/${total}).`);
    }

    // -- 7. Start the bot ---------------------------------------------------
    if (startAfterDeploy) {
      log("info", "Starting the bot…");
      await pacer.wait(signal);
      const started = await api.updateBot(apiKey, botId, { status: 1 });
      pacer.observe(started.rateLimit);

      if (!started.ok) {
        return {
          success: false,
          botId,
          botUsername,
          commandCount: uploaded,
          durationMs: elapsed(),
          error: `Commands uploaded, but the bot could not be started: ${started.error?.message ?? "unknown error"}`,
          hint: started.error?.hint,
          rateLimit: started.rateLimit,
        };
      }
      log("success", "Bot is now running.");
    } else {
      log("info", "Bot left stopped — start it from the dashboard when you are ready.");
    }

    log("success", `Deployment finished in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);

    return {
      success: true,
      botId,
      botUsername,
      commandCount: uploaded,
      durationMs: elapsed(),
    };
  } catch (error) {
    const cancelled = error instanceof Error && error.message.includes("cancelled");
    return {
      success: false,
      commandCount: 0,
      durationMs: elapsed(),
      error: cancelled
        ? "Deployment cancelled."
        : error instanceof Error
          ? error.message
          : "Deployment failed with an unexpected error.",
    };
  }
}
