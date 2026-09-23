/**
 * Minimal Telegram Bot API client — server-side only.
 *
 * We proxy `getMe` through our own route so the bot token is never sent from the
 * browser directly (which would also trip CORS), and so we can normalise
 * Telegram's `{ ok, description }` envelope into the same shape as everything else.
 */

import type { TelegramBotInfo } from "@/types/telegram";
import type { ProxyResult } from "@/types/telebothost";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const TIMEOUT_MS = 12_000;

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

/**
 * Validate a BotFather token by calling `getMe`.
 *
 * This is the real check, not a regex: Telegram itself confirms whether the token
 * belongs to a live bot, and returns the bot's username and display name.
 */
export async function validateBotToken(token: string): Promise<ProxyResult<TelegramBotInfo>> {
  const trimmed = token.trim();
  if (!trimmed) {
    return {
      ok: false,
      status: 400,
      error: { message: "Bot token is empty." },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${trimmed}/getMe`, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as
      | TelegramApiResponse<TelegramBotInfo>
      | null;

    if (!payload) {
      return {
        ok: false,
        status: 502,
        error: { message: "Telegram returned an unreadable response." },
      };
    }

    if (!payload.ok || !payload.result) {
      // 401 here almost always means a revoked or mistyped token.
      const description = payload.description ?? "Telegram rejected this bot token.";
      return {
        ok: false,
        status: payload.error_code === 401 ? 401 : 400,
        error: {
          message: description,
          hint:
            payload.error_code === 401
              ? "Double-check the token from @BotFather. If you regenerated it, the old one is dead."
              : undefined,
        },
      };
    }

    return { ok: true, status: 200, data: payload.result };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        status: 504,
        error: { message: "Telegram did not respond in time." },
      };
    }
    return {
      ok: false,
      status: 502,
      error: {
        message:
          error instanceof Error
            ? `Could not reach the Telegram API: ${error.message}`
            : "Could not reach the Telegram API.",
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
