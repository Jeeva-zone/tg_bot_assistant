"use client";

import * as React from "react";
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Info,
  Loader2,
  PlugZap,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { LLM_PROVIDERS, LLM_PROVIDER_ORDER } from "@/lib/copilot/providers";
import { formatDateTime } from "@/lib/utils";
import { useCredentials } from "@/store/useCredentials";
import type { LlmProviderId } from "@/types/copilot";

/**
 * Model configuration for the AI Bot Engineer.
 *
 * The key is a real secret, so it goes into the same AES-GCM vault as the Telegram
 * and TeleBotHost credentials — never into plain localStorage. It is sent only with
 * the user's own copilot requests, in a header, and is never stored server-side.
 */
export function LlmConfigCard() {
  const credentials = useCredentials((state) => state.credentials);
  const setLlm = useCredentials((state) => state.setLlm);
  const save = useCredentials((state) => state.save);

  const existing = credentials?.llm;

  const [provider, setProvider] = React.useState<LlmProviderId>(existing?.provider ?? "openai");
  const [model, setModel] = React.useState(existing?.model ?? LLM_PROVIDERS.openai.defaultModel);
  const [apiKey, setApiKey] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState(existing?.baseUrl ?? "");
  const [showKey, setShowKey] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<
    { ok: true; model: string } | { ok: false; message: string; hint?: string } | null
  >(null);

  // Adopt the stored config when the vault finishes loading.
  React.useEffect(() => {
    if (!existing) return;
    setProvider(existing.provider);
    setModel(existing.model);
    setBaseUrl(existing.baseUrl ?? "");
  }, [existing]);

  const definition = LLM_PROVIDERS[provider];

  // Switching provider should not silently keep an incompatible model id.
  function changeProvider(next: LlmProviderId) {
    setProvider(next);
    setModel(LLM_PROVIDERS[next].defaultModel);
    setTestResult(null);
  }

  async function handleTest() {
    const key = apiKey.trim() || existing?.apiKey || "";
    if (!key) {
      toast.error("Enter an API key first");
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const response = await fetch("/api/copilot/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-llm-key": key,
          "x-llm-provider": provider,
          "x-llm-model": model,
          ...(baseUrl.trim() ? { "x-llm-base-url": baseUrl.trim() } : {}),
        },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content:
                'Reply with exactly this JSON and nothing else: {"explanation":"ok","command_name":"/test","tbl_code":""}',
            },
          ],
          // A deliberately minimal context — this is a connectivity check, not a real turn.
          context: {
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
          },
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok: boolean; data?: { model: string }; error?: { message: string; hint?: string } }
        | null;

      if (payload?.ok && payload.data) {
        setTestResult({ ok: true, model: payload.data.model });
        toast.success("Model responded", { description: payload.data.model });
      } else {
        const failure = {
          ok: false as const,
          message: payload?.error?.message ?? `The provider returned HTTP ${response.status}.`,
          hint: payload?.error?.hint,
        };
        setTestResult(failure);
        toast.error("Model test failed", { description: failure.message });
      }
    } catch (error) {
      const failure = {
        ok: false as const,
        message: error instanceof Error ? error.message : "The test request failed.",
      };
      setTestResult(failure);
      toast.error("Model test failed", { description: failure.message });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    const key = apiKey.trim() || existing?.apiKey || "";
    if (!key) {
      toast.error("Enter an API key first");
      return;
    }
    if (provider === "custom" && !baseUrl.trim()) {
      toast.error("Enter a base URL for your OpenAI-compatible provider");
      return;
    }
    if (!credentials) {
      toast.error("Set up your Telegram and TeleBotHost credentials first");
      return;
    }

    await save({
      ...credentials,
      llm: {
        provider,
        apiKey: key,
        model: model.trim() || definition.defaultModel,
        baseUrl: provider === "custom" ? baseUrl.trim() : undefined,
        validatedAt: testResult?.ok ? new Date().toISOString() : existing?.validatedAt,
      },
    });

    setApiKey("");
    toast.success("Model configuration saved", {
      description: "The key is encrypted in this browser.",
    });
  }

  async function handleRemove() {
    if (!credentials) return;
    await save({ ...credentials, llm: undefined });
    setApiKey("");
    setTestResult(null);
    toast.success("Model configuration removed");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          AI Bot Engineer
        </CardTitle>
        <CardDescription>
          Optional. Adds a copilot that writes TBL from a plain-language description and deploys it.
          The app works fully without one — the starter templates in the drawer need no model.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="llm-provider">Provider</Label>
            <Select value={provider} onValueChange={(value) => changeProvider(value as LlmProviderId)}>
              <SelectTrigger id="llm-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LLM_PROVIDER_ORDER.map((id) => (
                  <SelectItem key={id} value={id}>
                    {LLM_PROVIDERS[id].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="llm-model">Model</Label>
            <Input
              id="llm-model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={definition.defaultModel}
              spellCheck={false}
              className="font-mono text-xs"
            />
            {definition.models.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {definition.models.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setModel(suggestion)}
                    className="rounded border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {provider === "custom" && (
          <div className="space-y-2">
            <Label htmlFor="llm-base-url">Base URL</Label>
            <Input
              id="llm-base-url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.groq.com/openai"
              spellCheck={false}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Any provider that speaks the OpenAI chat-completions format — Groq, OpenRouter,
              Together, DeepSeek, Ollama, LM Studio. The{" "}
              <code className="rounded bg-muted px-1">/v1/chat/completions</code> path is appended if
              you leave it off.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="llm-key">API key</Label>
          <div className="relative">
            <Input
              id="llm-key"
              type={showKey ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={existing?.apiKey ? "•••••••• (leave blank to keep the stored key)" : definition.keyHint}
              className="pr-10 font-mono text-xs"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-0.5 right-0.5"
              onClick={() => setShowKey((value) => !value)}
              aria-label={showKey ? "Hide key" : "Show key"}
            >
              {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Get one from{" "}
            <a
              href={definition.docsUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-primary underline underline-offset-2"
            >
              {definition.label}
            </a>
            . Stored encrypted in this browser and sent only with your own copilot requests.
          </p>
        </div>

        {testResult && (
          <div
            className={`flex gap-2 rounded-lg border p-2.5 text-xs ${
              testResult.ok
                ? "border-success/40 bg-success/5"
                : "border-destructive/40 bg-destructive/5"
            }`}
          >
            {testResult.ok ? (
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
            ) : (
              <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            )}
            <div className="min-w-0">
              <p className="font-medium">
                {testResult.ok ? `Working — ${testResult.model}` : "Test failed"}
              </p>
              {!testResult.ok && (
                <>
                  <p className="mt-0.5 text-muted-foreground">{testResult.message}</p>
                  {testResult.hint && (
                    <p className="mt-0.5 text-muted-foreground">{testResult.hint}</p>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void handleTest()} disabled={testing}>
            {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
            Test connection
          </Button>

          <Button type="button" onClick={() => void handleSave()}>
            <Check className="size-4" />
            Save model
          </Button>

          {existing && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleRemove()}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-4" />
              Remove
            </Button>
          )}
        </div>

        {existing && (
          <>
            <Separator />
            <dl className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Stored provider</dt>
                <dd className="font-medium">{LLM_PROVIDERS[existing.provider].label}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Stored model</dt>
                <dd className="font-mono text-[11px]">{existing.model}</dd>
              </div>
              {existing.validatedAt && (
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Last verified</dt>
                  <dd>{formatDateTime(existing.validatedAt)}</dd>
                </div>
              )}
            </dl>
          </>
        )}

        <div className="flex gap-2 rounded-md border border-primary/30 bg-primary/5 p-2.5">
          <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <p className="text-[11px] leading-snug text-muted-foreground">
            If you host on a serverless platform, note that its request timeout may be shorter than a
            large model&apos;s response time. A smaller, faster model is the reliable choice — the
            copilot&apos;s system prompt is deliberately compact to keep latency down.
          </p>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Bot className="size-3" />
          <span>
            Without a model, the drawer still works: its starter templates are hand-written TBL you
            can deploy directly.
          </span>
          <Badge variant="muted" className="ml-auto shrink-0 text-[9px]">
            optional
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
