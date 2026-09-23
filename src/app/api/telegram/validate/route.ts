import { NextResponse } from "next/server";
import { badRequest, readJsonBody } from "@/lib/api-helpers";
import { validateBotToken } from "@/lib/telegram-client";
import { isPlausibleBotToken } from "@/types/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  botToken?: string;
}

/**
 * `POST /api/telegram/validate`
 *
 * Confirms a BotFather token against Telegram's `getMe`. The shape check runs
 * first so an obvious typo fails instantly without a network round-trip, but the
 * authoritative answer always comes from Telegram.
 */
export async function POST(request: Request) {
  const body = await readJsonBody<Body>(request);
  const token = (body?.botToken ?? "").trim();

  if (!token) return badRequest("Bot token is required.");

  if (!isPlausibleBotToken(token)) {
    return badRequest(
      "That does not look like a Telegram bot token.",
      "A BotFather token looks like 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw — digits, a colon, then 35 characters.",
    );
  }

  const result = await validateBotToken(token);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status && result.status >= 400 ? result.status : 502 },
    );
  }

  return NextResponse.json(
    { ok: true, data: result.data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
