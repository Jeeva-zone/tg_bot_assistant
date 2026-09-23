/**
 * Server-side TeleBotHost API client.
 *
 * This module runs **only** in Next.js route handlers. It never reaches the
 * browser bundle — which matters, because it is the component that handles the
 * user's `sk_*` secret key.
 *
 * Design notes:
 *  - The key arrives per-request from the client (decrypted in the tab, sent over
 *    HTTPS) and is never persisted or logged here. The proxy is stateless, so
 *    there is no server-side credential store to breach.
 *  - TeleBotHost returns rate-limit headers on every authenticated response; we
 *    pass them back to the UI so quota usage is visible instead of mysterious.
 *  - Errors are normalised into one shape so the UI has a single thing to render.
 */

import {
  TBH_API_BASE,
  type ProxyResult,
  type TbhErrorBody,
  type TbhRateLimit,
  isTbhError,
} from "@/types/telebothost";

const DEFAULT_TIMEOUT_MS = 20_000;

function parseNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Pull the documented quota headers off a response. */
export function extractRateLimit(headers: Headers): TbhRateLimit {
  return {
    limit: parseNumber(headers.get("X-RateLimit-Limit")),
    remaining: parseNumber(headers.get("X-RateLimit-Remaining")),
    reset: parseNumber(headers.get("X-RateLimit-Reset")),
    limitMinute: parseNumber(headers.get("X-RateLimit-Limit-Minute")),
    remainingMinute: parseNumber(headers.get("X-RateLimit-Remaining-Minute")),
    resetMinute: parseNumber(headers.get("X-RateLimit-Reset-Minute")),
    limitMonth: parseNumber(headers.get("X-RateLimit-Limit-Month")),
    remainingMonth: parseNumber(headers.get("X-RateLimit-Remaining-Month")),
    resetMonth: parseNumber(headers.get("X-RateLimit-Reset-Month")),
  };
}

export interface TbhRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** JSON body. Omit for GET/DELETE. */
  body?: unknown;
  /** Query string parameters, e.g. `{ limit: 50 }`. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Override the default 20s timeout. */
  timeoutMs?: number;
  /**
   * Skip the Authorization header. Only `/status` is public; everything else
   * needs a key.
   */
  anonymous?: boolean;
}

/**
 * Make one authenticated call to the TeleBotHost API.
 *
 * Never throws for API-level failures — a 4xx/5xx comes back as
 * `{ ok: false, error }` so route handlers can forward it verbatim.
 */
export async function tbhFetch<T>(
  apiKey: string,
  path: string,
  options: TbhRequestOptions = {},
): Promise<ProxyResult<T>> {
  const { method = "GET", body, query, timeoutMs = DEFAULT_TIMEOUT_MS, anonymous } = options;

  const url = new URL(`${TBH_API_BASE}${path.startsWith("/") ? path : `/${path}`}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  const trimmedKey = apiKey.trim();
  if (!anonymous) {
    if (!trimmedKey) {
      return {
        ok: false,
        status: 401,
        error: {
          message: "No TeleBotHost API key was supplied.",
          hint: "Add your API key in Setup before calling the TeleBotHost API.",
        },
      };
    }
    // Send both documented auth styles; TeleBotHost accepts either.
    headers.Authorization = `Bearer ${trimmedKey}`;
    headers["X-Api-Key"] = trimmedKey;
  }

  if (body !== undefined) headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url.toString(), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });

    const rateLimit = extractRateLimit(response.headers);

    // 204 and empty bodies are legitimate for DELETE.
    const raw = await response.text();
    let parsed: unknown = undefined;
    if (raw.length > 0) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = undefined;
      }
    }

    if (response.ok) {
      return { ok: true, status: response.status, data: parsed as T, rateLimit };
    }

    if (isTbhError(parsed)) {
      const error = parsed as TbhErrorBody;
      return {
        ok: false,
        status: response.status,
        rateLimit,
        error: {
          message: error.message,
          hint: error.hint,
          reason: error.reason,
          errors: error.errors,
          retryAfter: error.retry_after,
        },
      };
    }

    return {
      ok: false,
      status: response.status,
      rateLimit,
      error: {
        message:
          raw.length > 0 && raw.length < 400
            ? raw
            : `TeleBotHost returned HTTP ${response.status} with no readable body.`,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        status: 504,
        error: {
          message: `TeleBotHost did not respond within ${Math.round(timeoutMs / 1000)}s.`,
          hint: "The API may be slow or unreachable. Try again.",
        },
      };
    }

    return {
      ok: false,
      status: 502,
      error: {
        message:
          error instanceof Error
            ? `Could not reach the TeleBotHost API: ${error.message}`
            : "Could not reach the TeleBotHost API.",
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Thin typed wrappers for the endpoints we use
// ---------------------------------------------------------------------------

export const tbhApi = {
  /** `GET /status` — public health probe, no auth required. */
  status: () => tbhFetch<{ version: string; status: string; env: string }>("", "/status", {
    anonymous: true,
    timeoutMs: 8_000,
  }),

  listBots: (apiKey: string) => tbhFetch<unknown>(apiKey, "/bot"),

  getBot: (apiKey: string, botId: number | string) => tbhFetch<unknown>(apiKey, `/bot/${botId}`),

  createBot: (apiKey: string, body: unknown) =>
    tbhFetch<unknown>(apiKey, "/bot", { method: "POST", body }),

  updateBot: (apiKey: string, botId: number | string, body: unknown) =>
    tbhFetch<unknown>(apiKey, `/bot/${botId}`, { method: "PATCH", body }),

  deleteBot: (apiKey: string, botId: number | string) =>
    tbhFetch<unknown>(apiKey, `/bot/${botId}`, { method: "DELETE" }),

  listCommands: (apiKey: string, botId: number | string) =>
    tbhFetch<unknown>(apiKey, `/bot/${botId}/commands`),

  createCommand: (apiKey: string, botId: number | string, body: unknown) =>
    tbhFetch<unknown>(apiKey, `/bot/${botId}/commands`, { method: "POST", body }),

  updateCommand: (apiKey: string, botId: number | string, commandId: number | string, body: unknown) =>
    tbhFetch<unknown>(apiKey, `/bot/${botId}/commands/${commandId}`, { method: "PATCH", body }),

  deleteCommand: (apiKey: string, botId: number | string, commandId: number | string) =>
    tbhFetch<unknown>(apiKey, `/bot/${botId}/commands/${commandId}`, { method: "DELETE" }),

  deleteAllCommands: (apiKey: string, botId: number | string) =>
    tbhFetch<unknown>(apiKey, `/bot/${botId}/commands`, { method: "DELETE" }),

  listLogs: (apiKey: string, botId: number | string) =>
    tbhFetch<unknown>(apiKey, `/bot/${botId}/logs`),

  clearLogs: (apiKey: string, botId: number | string) =>
    tbhFetch<unknown>(apiKey, `/bot/${botId}/logs`, { method: "DELETE" }),

  analytics: (apiKey: string, botId: number | string) =>
    tbhFetch<unknown>(apiKey, `/bot/${botId}/analytics`),
};
