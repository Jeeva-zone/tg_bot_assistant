import { NextResponse } from "next/server";
import { callLlm } from "@/lib/copilot/providers";
import { parseCopilotReply } from "@/lib/copilot/schema";
import { buildSystemPrompt } from "@/lib/copilot/system-prompt";
import type { CopilotBotContext, LlmConfig, LlmProviderId } from "@/types/copilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel function duration.
 *
 * A model call is the slowest thing in the app. Vercel's default is 300s on every plan,
 * so this export is mostly documentation of intent — but it guarantees headroom if the
 * project default is ever lowered, and Hobby caps at 300s either way.
 *
 * Hosts with a shorter limit (Netlify's synchronous functions) will cut the request
 * first; the client turns a 502/504 into a message that says so. Vercel is the better
 * host for heavy copilot use.
 */
export const maxDuration = 60;

/**
 * `POST /api/copilot/chat`
 *
 * Proxies one turn to the user's chosen model provider.
 *
 * The model API key travels in the `x-llm-key` header — never in the body, a query
 * string, or a log line — and is discarded when the request ends. The route is
 * stateless, so there is no server-side credential store to breach. This mirrors how
 * the TeleBotHost key is handled, and keeps the browser from talking to the provider
 * directly (which the app's `connect-src 'self'` CSP would block anyway).
 *
 * Note on timeouts: this route sets a 55s upstream budget, but a serverless host may
 * cut the request sooner — Netlify's synchronous function limit is well under that.
 * The client turns a 502/504 into a specific, actionable message rather than a
 * generic failure.
 */

const KEY_HEADER = "x-llm-key";
const PROVIDER_HEADER = "x-llm-provider";
const MODEL_HEADER = "x-llm-model";
const BASE_URL_HEADER = "x-llm-base-url";

/** How much conversation history to forward. Older turns add cost without much value. */
const MAX_HISTORY_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 12_000;

interface ChatRequestBody {
  messages?: { role: "user" | "assistant"; content: string }[];
  context?: CopilotBotContext;
}

export async function POST(request: Request) {
  const apiKey = (request.headers.get(KEY_HEADER) ?? "").trim();
  const provider = (request.headers.get(PROVIDER_HEADER) ?? "openai").trim() as LlmProviderId;
  const model = (request.headers.get(MODEL_HEADER) ?? "").trim();
  const baseUrl = (request.headers.get(BASE_URL_HEADER) ?? "").trim();

  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          message: "No model API key is configured.",
          hint: "Add one under Credentials → AI model. It is encrypted in your browser and only sent with your own requests.",
        },
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: ChatRequestBody | undefined;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: { message: "The request body was not valid JSON." } },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const history = (body?.messages ?? [])
    .filter(
      (message) =>
        message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim().length > 0,
    )
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, MAX_MESSAGE_CHARS),
    }));

  if (history.length === 0) {
    return NextResponse.json(
      { ok: false, error: { message: "There was no message to send." } },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  // The context comes from the client, which already fetched it from TeleBotHost.
  // Treat it as untrusted shape-wise and fall back to a minimal context.
  const context: CopilotBotContext = body?.context ?? {
    botId: null,
    botName: "",
    botUsername: "",
    status: "unknown",
    commands: [],
    variables: [],
    envVarNames: [],
    hasWriteKey: false,
    folders: [],
    activeSurface: "none",
  };

  const config: LlmConfig = {
    provider,
    apiKey,
    model,
    baseUrl: baseUrl || undefined,
    temperature: 0.2,
  };

  const result = await callLlm({
    config,
    systemPrompt: buildSystemPrompt(context),
    messages: history,
    signal: request.signal,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: { message: result.error, hint: result.hint } },
      {
        status: result.status >= 400 ? result.status : 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  // Parse server-side so the client always receives a validated structure, and so a
  // malformed reply becomes a clear message instead of a UI crash. The raw text is
  // returned too, so the UI can still show what the model actually said.
  const parsed = parseCopilotReply(result.text);

  return NextResponse.json(
    {
      ok: true,
      data: {
        artifact: parsed.artifact ?? null,
        raw: parsed.raw,
        repairs: parsed.repairs,
        parseError: parsed.error ?? null,
        model: result.model,
        provider,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
