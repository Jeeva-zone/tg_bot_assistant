/**
 * Shared helpers for the proxy route handlers.
 *
 * The TeleBotHost secret key travels in the `x-tbh-key` request header rather
 * than the body or query string. That keeps it out of URLs (and therefore out of
 * access logs and Referer headers) and lets the same convention serve GET, POST,
 * PATCH and DELETE alike.
 */

import { NextResponse } from "next/server";
import type { ProxyResult } from "@/types/telebothost";

export const TBH_KEY_HEADER = "x-tbh-key";

/** Read and normalise the TeleBotHost key from a request. */
export function readApiKey(request: Request): string {
  return (request.headers.get(TBH_KEY_HEADER) ?? "").trim();
}

/** Forward a `ProxyResult` to the browser, preserving the upstream status. */
export function forwardResult<T>(result: ProxyResult<T>): NextResponse {
  if (result.ok) {
    return NextResponse.json(
      { ok: true, data: result.data ?? null, rateLimit: result.rateLimit ?? null },
      {
        status: result.status || 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: result.error ?? { message: "Unknown upstream error." },
      rateLimit: result.rateLimit ?? null,
    },
    {
      status: result.status && result.status >= 400 ? result.status : 502,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

/** A local validation failure, shaped like an upstream one. */
export function badRequest(message: string, hint?: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: { message, hint } },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}

/** Parse a JSON body, returning `undefined` instead of throwing on malformed input. */
export async function readJsonBody<T>(request: Request): Promise<T | undefined> {
  try {
    return (await request.json()) as T;
  } catch {
    return undefined;
  }
}

/**
 * Guard a numeric path parameter. TeleBotHost expects numeric bot/command ids,
 * and validating here produces a clearer error than a 404 from upstream.
 */
export function parseNumericId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
