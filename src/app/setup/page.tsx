"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CircleDot,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { formatDateTime } from "@/lib/utils";
import { pingTbhApi } from "@/lib/client-api";
import { isWebCryptoAvailable } from "@/lib/crypto";
import {
  classifyApiKey,
  summariseCredentials,
  useCredentials,
  validateAndBuildBundle,
} from "@/store/useCredentials";

type ApiProbe = "checking" | "online" | "offline";

function ApiReachability() {
  const [probe, setProbe] = React.useState<ApiProbe>("checking");
  const [detail, setDetail] = React.useState<string>("");

  const check = React.useCallback(async () => {
    setProbe("checking");
    const result = await pingTbhApi();
    if (result.ok && result.data) {
      setProbe("online");
      setDetail(`v${result.data.version} · ${result.data.env}`);
    } else {
      setProbe("offline");
      setDetail(result.error?.message ?? "Unreachable");
    }
  }, []);

  React.useEffect(() => {
    void check();
  }, [check]);

  return (
    <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        {probe === "checking" && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        {probe === "online" && <Wifi className="size-4 text-success" />}
        {probe === "offline" && <WifiOff className="size-4 text-destructive" />}
        <div>
          <div className="text-xs font-medium">TeleBotHost API</div>
          <div className="text-[11px] text-muted-foreground">
            {probe === "checking" ? "Checking reachability…" : detail}
          </div>
        </div>
      </div>
      <Button variant="ghost" size="icon-sm" onClick={() => void check()} aria-label="Re-check API">
        <RefreshCw className="size-3.5" />
      </Button>
    </div>
  );
}

function SetupPageInner() {
  const { credentials, meta, status, hydrated, save, clear } = useCredentials();

  const [botToken, setBotToken] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [showToken, setShowToken] = React.useState(false);
  const [showKey, setShowKey] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<{
    field: "telegram" | "telebothost" | "both";
    message: string;
    hint?: string;
  } | null>(null);

  const cryptoReady = React.useMemo(() => isWebCryptoAvailable(), []);

  const summary = React.useMemo(
    () => (credentials ? summariseCredentials(credentials, meta) : null),
    [credentials, meta],
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFieldError(null);

    if (!botToken.trim() || !apiKey.trim()) {
      setFieldError({
        field: "both",
        message: "Both the bot token and the TeleBotHost API key are required.",
      });
      return;
    }

    setSubmitting(true);
    try {
      const outcome = await validateAndBuildBundle(botToken, apiKey);

      if (!outcome.ok) {
        setFieldError({ field: outcome.field, message: outcome.message, hint: outcome.hint });
        toast.error("Validation failed", { description: outcome.message });
        return;
      }

      await save(outcome.bundle);
      toast.success(`Connected to @${outcome.bundle.telegram.botUsername}`, {
        description: "Credentials validated and stored encrypted on this device.",
      });
      setBotToken("");
      setApiKey("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save credentials.";
      setFieldError({ field: "both", message });
      toast.error("Could not save credentials", { description: message });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClear() {
    await clear();
    toast.success("Credentials removed", {
      description: "The encryption key and encrypted vault were both deleted.",
    });
  }

  return (
    <>
      <PageHeader
        icon={KeyRound}
        title="Credentials"
        description="Connect a Telegram bot and your TeleBotHost account. Both are verified against the live APIs before anything is saved."
        actions={
          summary ? (
            <Badge variant="success" className="gap-1.5">
              <Check className="size-3" />
              Connected
            </Badge>
          ) : (
            <Badge variant="warning" className="gap-1.5">
              <CircleDot className="size-3" />
              Setup required
            </Badge>
          )
        }
      />

      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ---------- Form ---------- */}
        <div className="space-y-6">
          {!cryptoReady && (
            <div className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="text-sm">
                <p className="font-medium">Encryption unavailable</p>
                <p className="mt-0.5 text-muted-foreground">
                  Web Crypto requires a secure context. Open this app over HTTPS or on localhost —
                  credentials will not be stored otherwise.
                </p>
              </div>
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="size-4 text-primary" />
                Secure setup
              </CardTitle>
              <CardDescription>
                Everything is encrypted in your browser with AES-GCM before it touches storage. The
                key is non-extractable and never leaves this device.
              </CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Telegram token */}
                <div className="space-y-2">
                  <Label htmlFor="bot-token" className="flex items-center gap-2">
                    <Bot className="size-3.5 text-muted-foreground" />
                    Telegram Bot Token
                  </Label>
                  <div className="relative">
                    <Input
                      id="bot-token"
                      type={showToken ? "text" : "password"}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"
                      value={botToken}
                      onChange={(event) => setBotToken(event.target.value)}
                      aria-invalid={fieldError?.field === "telegram" || fieldError?.field === "both"}
                      className="pr-10 font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="absolute top-0.5 right-0.5"
                      onClick={() => setShowToken((value) => !value)}
                      aria-label={showToken ? "Hide token" : "Show token"}
                    >
                      {showToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Message{" "}
                    <a
                      href="https://t.me/BotFather"
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-medium text-primary underline underline-offset-2"
                    >
                      @BotFather
                    </a>{" "}
                    and send <code className="rounded bg-muted px-1 py-0.5 text-[11px]">/newbot</code>{" "}
                    to get one.
                  </p>
                  {fieldError?.field === "telegram" && (
                    <p className="flex items-start gap-1.5 text-xs text-destructive">
                      <X className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        {fieldError.message}
                        {fieldError.hint && (
                          <span className="mt-0.5 block text-muted-foreground">{fieldError.hint}</span>
                        )}
                      </span>
                    </p>
                  )}
                </div>

                <Separator />

                {/* TeleBotHost key */}
                <div className="space-y-2">
                  <Label htmlFor="api-key" className="flex items-center gap-2">
                    <KeyRound className="size-3.5 text-muted-foreground" />
                    TeleBotHost API Key
                  </Label>
                  <div className="relative">
                    <Input
                      id="api-key"
                      type={showKey ? "text" : "password"}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="sk_live_…"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      aria-invalid={
                        fieldError?.field === "telebothost" || fieldError?.field === "both"
                      }
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

                  {apiKey.trim().length > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      {classifyApiKey(apiKey) === "secret" && (
                        <Badge variant="success" className="gap-1">
                          <Check className="size-3" /> Writable key
                        </Badge>
                      )}
                      {classifyApiKey(apiKey) === "public" && (
                        <Badge variant="warning" className="gap-1">
                          <AlertTriangle className="size-3" /> Read-only — cannot deploy
                        </Badge>
                      )}
                      {classifyApiKey(apiKey) === "unknown" && (
                        <Badge variant="muted" className="gap-1">
                          <CircleDot className="size-3" /> Unrecognised prefix
                        </Badge>
                      )}
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">
                    Get a <code className="rounded bg-muted px-1 py-0.5 text-[11px]">sk_</code> key
                    from the{" "}
                    <a
                      href="https://console.telebothost.com/"
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-medium text-primary underline underline-offset-2"
                    >
                      TeleBotHost console
                    </a>
                    . Public <code className="rounded bg-muted px-1 py-0.5 text-[11px]">pub_</code>{" "}
                    keys are read-only and cannot create or update bots.
                  </p>
                  {fieldError?.field === "telebothost" && (
                    <p className="flex items-start gap-1.5 text-xs text-destructive">
                      <X className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        {fieldError.message}
                        {fieldError.hint && (
                          <span className="mt-0.5 block text-muted-foreground">{fieldError.hint}</span>
                        )}
                      </span>
                    </p>
                  )}
                </div>

                {fieldError?.field === "both" && (
                  <p className="flex items-start gap-1.5 text-xs text-destructive">
                    <X className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      {fieldError.message}
                      {fieldError.hint && (
                        <span className="mt-0.5 block text-muted-foreground">{fieldError.hint}</span>
                      )}
                    </span>
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" disabled={submitting || !cryptoReady}>
                    {submitting ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Verifying with both APIs…
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="size-4" />
                        Verify &amp; save
                      </>
                    )}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Both credentials are checked live — nothing is stored unless they work.
                  </span>
                </div>
              </form>
            </CardContent>
          </Card>

          <ApiReachability />
        </div>

        {/* ---------- Stored credentials ---------- */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Stored on this device</CardTitle>
              <CardDescription>
                Secrets are shown masked. Only fingerprints are kept in the clear.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!hydrated && (
                <div className="space-y-2">
                  <div className="h-4 animate-pulse rounded bg-muted" />
                  <div className="h-4 animate-pulse rounded bg-muted" />
                </div>
              )}

              {hydrated && !summary && (
                <p className="text-sm text-muted-foreground">
                  No credentials stored yet. Fill in the form to connect your bot.
                </p>
              )}

              {hydrated && summary && (
                <>
                  <dl className="space-y-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Bot</dt>
                      <dd className="font-medium">
                        {summary.botName}{" "}
                        <span className="text-muted-foreground">@{summary.botUsername}</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Telegram token</dt>
                      <dd className="font-mono text-xs">{summary.maskedToken}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">TeleBotHost key</dt>
                      <dd className="font-mono text-xs">{summary.maskedApiKey}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Key fingerprints</dt>
                      <dd className="font-mono text-[11px] text-muted-foreground">
                        tg:{summary.telegramFingerprint} · tbh:{summary.tbhFingerprint}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Last updated</dt>
                      <dd className="text-xs">{formatDateTime(summary.updatedAt)}</dd>
                    </div>
                  </dl>

                  <Separator />

                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm">
                      <Link href="/builder">
                        Open builder
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void handleClear()}>
                      <Trash2 className="size-3.5" />
                      Forget
                    </Button>
                  </div>
                </>
              )}

              {status === "locked" && (
                <p className="text-xs text-muted-foreground">
                  The vault exists but could not be decrypted. Re-enter your credentials to replace it.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-dashed bg-muted/30">
            <CardHeader>
              <CardTitle className="text-sm">How the encryption works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-xs text-muted-foreground">
              <p className="flex gap-2">
                <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                AES-GCM 256-bit, authenticated — tampering is detected, not silently accepted.
              </p>
              <p className="flex gap-2">
                <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                The key is non-extractable and lives in IndexedDB, so a copy of localStorage alone is
                useless.
              </p>
              <p className="flex gap-2">
                <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                Keys are forwarded to TeleBotHost per-request and never stored on any server.
              </p>
              <p className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                Like any browser-only vault, it cannot defend against script injected into this page
                while it is running. Keep the app on a trusted device.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

export default function SetupPage() {
  return (
    <AppShell>
      <SetupPageInner />
    </AppShell>
  );
}
