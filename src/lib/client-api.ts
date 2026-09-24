/**
 * Browser-side client for our own proxy routes.
 *
 * Every call carries the TeleBotHost key in the `x-tbh-key` header. The key is
 * decrypted from the vault in memory at the moment of use and never written to
 * sessionStorage, cookies, or a URL — so a stolen localStorage dump yields
 * nothing usable.
 */

import type { ProxyResult } from "@/types/telebothost";
import type {
  BotAnalytics,
  BotListItem,
  CreateBotRequest,
  CreateCommandRequest,
  GetAnalyticsResponse,
  ListBotsResponse,
  ListCommandsResponse,
  ListLogsResponse,
  UpdateBotRequest,
} from "@/types/telebothost";
import type { TelegramBotInfo } from "@/types/telegram";

const TBH_KEY_HEADER = "x-tbh-key";

interface RawEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: ProxyResult<T>["error"];
  rateLimit?: ProxyResult<T>["rateLimit"];
}

async function request<T>(
  path: string,
  init: RequestInit & { apiKey?: string } = {},
): Promise<ProxyResult<T>> {
  const { apiKey, headers, ...rest } = init;

  try {
    const response = await fetch(path, {
      ...rest,
      headers: {
        Accept: "application/json",
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        ...(apiKey ? { [TBH_KEY_HEADER]: apiKey } : {}),
        ...(headers as Record<string, string> | undefined),
      },
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as RawEnvelope<T> | null;

    if (!payload) {
      return {
        ok: false,
        status: response.status,
        error: { message: `The server returned an unreadable response (HTTP ${response.status}).` },
      };
    }

    if (payload.ok) {
      return {
        ok: true,
        status: response.status,
        data: payload.data,
        rateLimit: payload.rateLimit,
      };
    }

    return {
      ok: false,
      status: response.status,
      error: payload.error ?? { message: `Request failed with HTTP ${response.status}.` },
      rateLimit: payload.rateLimit,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: {
        message:
          error instanceof Error
            ? `Network error: ${error.message}`
            : "Network error contacting the local proxy.",
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Public (no key needed)
// ---------------------------------------------------------------------------

export function pingTbhApi() {
  return request<{ version: string; status: string; env: string }>("/api/tbh/status");
}

export function validateBotToken(botToken: string) {
  return request<TelegramBotInfo>("/api/telegram/validate", {
    method: "POST",
    body: JSON.stringify({ botToken }),
  });
}

// ---------------------------------------------------------------------------
// Authenticated
// ---------------------------------------------------------------------------

export function validateTbhKey(apiKey: string) {
  return request<ListBotsResponse>("/api/tbh/validate", { apiKey });
}

export function listBots(apiKey: string) {
  return request<ListBotsResponse>("/api/tbh/bots", { apiKey });
}

export function createBot(apiKey: string, body: CreateBotRequest) {
  return request<{ bot: BotListItem }>("/api/tbh/bots", {
    apiKey,
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getBot(apiKey: string, botId: number) {
  return request<BotListItem>(`/api/tbh/bots/${botId}`, { apiKey });
}

export function updateBot(apiKey: string, botId: number, body: UpdateBotRequest) {
  return request<{ updated: BotListItem }>(`/api/tbh/bots/${botId}`, {
    apiKey,
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteBot(apiKey: string, botId: number) {
  return request<unknown>(`/api/tbh/bots/${botId}`, { apiKey, method: "DELETE" });
}

export function listCommands(apiKey: string, botId: number) {
  return request<ListCommandsResponse>(`/api/tbh/bots/${botId}/commands`, { apiKey });
}

export function createCommand(apiKey: string, botId: number, body: CreateCommandRequest) {
  return request<{ command: unknown }>(`/api/tbh/bots/${botId}/commands`, {
    apiKey,
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateCommand(
  apiKey: string,
  botId: number,
  commandId: number,
  body: Partial<CreateCommandRequest>,
) {
  return request<{ command: unknown }>(`/api/tbh/bots/${botId}/commands/${commandId}`, {
    apiKey,
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteAllCommands(apiKey: string, botId: number) {
  return request<unknown>(`/api/tbh/bots/${botId}/commands`, { apiKey, method: "DELETE" });
}

export function listLogs(apiKey: string, botId: number) {
  return request<ListLogsResponse>(`/api/tbh/bots/${botId}/logs`, { apiKey });
}

export function clearLogs(apiKey: string, botId: number) {
  return request<unknown>(`/api/tbh/bots/${botId}/logs`, { apiKey, method: "DELETE" });
}

export function getAnalytics(apiKey: string, botId: number) {
  return request<GetAnalyticsResponse["analytics"]>(`/api/tbh/bots/${botId}/analytics`, {
    apiKey,
  });
}

export type { BotAnalytics };
