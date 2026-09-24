/**
 * LLM provider abstraction.
 *
 * Runs **server-side only** — it is the component that handles the user's model API
 * key, exactly like `tbh-client.ts` handles the TeleBotHost key. The key arrives
 * per-request in a header and is never persisted or logged here, so there is no
 * server-side credential store to breach.
 *
 * Two wire formats cover essentially every provider worth supporting:
 *
 *  - **OpenAI-compatible** (`/chat/completions`) — OpenAI itself, plus Groq, Together,
 *    OpenRouter, DeepSeek, vLLM, Ollama, LM Studio and most others.
 *  - **Anthropic** (`/v1/messages`) — its own shape, with `system` as a top-level field.
 */

import type { LlmConfig, LlmProviderDefinition, LlmProviderId } from "@/types/copilot";

const TIMEOUT_MS = 90_000;

export const LLM_PROVIDERS: Record<LlmProviderId, LlmProviderDefinition> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    keyHint: "Starts with sk-",
    keyPrefix: "sk-",
    endpoint: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini"],
    docsUrl: "https://platform.openai.com/api-keys",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    keyHint: "Starts with sk-ant-",
    keyPrefix: "sk-ant-",
    endpoint: "https://api.anthropic.com/v1/messages",
    defaultModel: "claude-sonnet-4-5",
    models: ["claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-1"],
    docsUrl: "https://console.anthropic.com/settings/keys",
  },
  custom: {
    id: "custom",
    label: "OpenAI-compatible",
    keyHint: "Any provider that speaks the OpenAI chat-completions format",
    endpoint: "",
    defaultModel: "llama-3.3-70b-versatile",
    models: [],
    docsUrl: "https://platform.openai.com/docs/api-reference/chat",
  },
};

/** Provider ids in the order the setup UI should show them. */
export const LLM_PROVIDER_ORDER: LlmProviderId[] = ["openai", "anthropic", "custom"];

export interface LlmCallOptions {
  config: LlmConfig;
  systemPrompt: string;
  messages: { role: "user" | "assistant"; content: string }[];
  signal?: AbortSignal;
}

export type LlmCallResult =
  | { ok: true; text: string; model: string }
  | { ok: false; status: number; error: string; hint?: string };

/** Resolve the chat-completions URL for a config, including custom base URLs. */
function resolveEndpoint(config: LlmConfig): string | null {
  if (config.provider === "custom") {
    const base = (config.baseUrl ?? "").trim().replace(/\/+$/, "");
    if (!base) return null;
    // Accept either a bare origin or a full path, so users can paste whichever
    // their provider documents.
    if (/\/chat\/completions$/.test(base)) return base;
    if (/\/v1$/.test(base)) return `${base}/chat/completions`;
    return `${base}/v1/chat/completions`;
  }

  return LLM_PROVIDERS[config.provider].endpoint;
}

/** Pull a readable message out of a provider error body. */
function extractErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;

    if (typeof record.error === "string") return record.error;
    if (record.error && typeof record.error === "object") {
      const nested = record.error as Record<string, unknown>;
      if (typeof nested.message === "string") return nested.message;
    }
    if (typeof record.message === "string") return record.message;
  }

  return `The model provider returned HTTP ${status}.`;
}

export async function callLlm(options: LlmCallOptions): Promise<LlmCallResult> {
  const { config, systemPrompt, messages, signal } = options;

  const apiKey = config.apiKey.trim();
  if (!apiKey) {
    return {
      ok: false,
      status: 400,
      error: "No model API key is configured.",
      hint: "Add one under Credentials → AI model.",
    };
  }

  const endpoint = resolveEndpoint(config);
  if (!endpoint) {
    return {
      ok: false,
      status: 400,
      error: "No base URL is set for the OpenAI-compatible provider.",
      hint: "Enter the base URL your provider documents, e.g. https://api.groq.com/openai",
    };
  }

  const model = config.model.trim() || LLM_PROVIDERS[config.provider].defaultModel;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  // Forward an outer abort (client disconnect) into our controller.
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener("abort", onOuterAbort, { once: true });

  try {
    let response: Response;

    if (config.provider === "anthropic") {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 8192,
          temperature: config.temperature ?? 0.2,
          // Anthropic takes the system prompt as a top-level field, not a message.
          system: systemPrompt,
          messages: messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
        signal: controller.signal,
      });
    } else {
      const body: Record<string, unknown> = {
        model,
        temperature: config.temperature ?? 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map((message) => ({ role: message.role, content: message.content })),
        ],
      };

      // Only OpenAI is guaranteed to accept this. Other OpenAI-compatible servers
      // reject unknown fields, so we ask for JSON in the prompt instead.
      if (config.provider === "openai") {
        body.response_format = { type: "json_object" };
      }

      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    }

    const raw = await response.text();
    let payload: unknown = null;
    try {
      payload = raw.length > 0 ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const status = response.status;
      return {
        ok: false,
        status,
        error: extractErrorMessage(payload, status),
        hint:
          status === 401
            ? "The provider rejected this API key. Check it was copied in full and is still active."
            : status === 429
              ? "Rate limited or out of quota on this key."
              : status === 404
                ? "That model name was not found. Check the model id for this provider."
                : undefined,
      };
    }

    // -- extract the assistant text ---------------------------------------
    let text = "";

    if (config.provider === "anthropic") {
      const content = (payload as { content?: unknown })?.content;
      if (Array.isArray(content)) {
        text = content
          .filter(
            (block): block is { type: string; text: string } =>
              typeof block === "object" &&
              block !== null &&
              (block as { type?: string }).type === "text" &&
              typeof (block as { text?: unknown }).text === "string",
          )
          .map((block) => block.text)
          .join("");
      }
    } else {
      const choices = (payload as { choices?: unknown })?.choices;
      if (Array.isArray(choices) && choices.length > 0) {
        const message = (choices[0] as { message?: { content?: unknown } })?.message;
        if (typeof message?.content === "string") {
          text = message.content;
        } else if (Array.isArray(message?.content)) {
          // Some servers return content as an array of parts.
          text = (message?.content as unknown[])
            .map((part) =>
              typeof part === "object" && part !== null && "text" in part
                ? String((part as { text: unknown }).text)
                : "",
            )
            .join("");
        }
      }
    }

    if (!text.trim()) {
      return {
        ok: false,
        status: 502,
        error: "The provider returned an empty message.",
        hint: "Try again, or pick a different model.",
      };
    }

    return { ok: true, text, model };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        status: 504,
        error: `The model did not respond within ${Math.round(TIMEOUT_MS / 1000)}s.`,
        hint: "Large models on busy providers can be slow. Try again or use a smaller model.",
      };
    }

    return {
      ok: false,
      status: 502,
      error:
        error instanceof Error
          ? `Could not reach the model provider: ${error.message}`
          : "Could not reach the model provider.",
      hint: "Check the base URL if you are using an OpenAI-compatible provider.",
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}
