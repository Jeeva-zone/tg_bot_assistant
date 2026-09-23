"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  CircleDot,
  Clock,
  History,
  KeyRound,
  Loader2,
  Play,
  Power,
  RefreshCw,
  Rocket,
  Server,
  Square,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { compileProject } from "@/lib/compiler";
import { deployProject, type DeployOutcome } from "@/lib/deploy-engine";
import * as clientApi from "@/lib/client-api";
import * as vault from "@/lib/vault";
import { formatDateTime, formatDuration, formatRelative } from "@/lib/utils";
import { useBuilder } from "@/store/useBuilder";
import { useCredentials } from "@/store/useCredentials";
import type { DeploymentLogLine, DeploymentRecord } from "@/types/builder";
import type { BotListItem } from "@/types/telebothost";

const LEVEL_COLOURS: Record<DeploymentLogLine["level"], string> = {
  info: "text-muted-foreground",
  success: "text-success",
  warn: "text-warning",
  error: "text-destructive",
};

function LogViewer({ lines, running }: { lines: DeploymentLogLine[]; running: boolean }) {
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines.length]);

  return (
    <ScrollArea className="h-72 rounded-lg border bg-muted/40">
      <div className="code-block p-3">
        {lines.length === 0 && (
          <p className="text-muted-foreground">
            {running ? "Starting…" : "Deployment output will appear here."}
          </p>
        )}

        {lines.map((line, index) => (
          <div key={index} className="flex gap-2">
            <span className="shrink-0 text-muted-foreground/60">
              {new Date(line.at).toLocaleTimeString("en-GB", { hour12: false })}
            </span>
            <span className={LEVEL_COLOURS[line.level]}>{line.message}</span>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}

function BotManager({
  apiKey,
  bots,
  onRefresh,
  loading,
}: {
  apiKey: string;
  bots: BotListItem[];
  onRefresh: () => void;
  loading: boolean;
}) {
  const [busyId, setBusyId] = React.useState<number | null>(null);

  async function toggleStatus(bot: BotListItem) {
    setBusyId(bot.bot_id);
    const nextStatus = bot.status === 1 ? 0 : 1;
    const result = await clientApi.updateBot(apiKey, bot.bot_id, { status: nextStatus });

    if (result.ok) {
      toast.success(nextStatus === 1 ? `Started ${bot.name}` : `Stopped ${bot.name}`);
      onRefresh();
    } else {
      toast.error("Could not change bot state", { description: result.error?.message });
    }
    setBusyId(null);
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-12 animate-pulse rounded-lg bg-muted" />
        <div className="h-12 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (bots.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
        No bots registered on TeleBotHost yet. Deploy one from the panel above.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {bots.map((bot) => {
        const online = bot.status === 1;

        return (
          <div
            key={bot.bot_id}
            className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
          >
            <div
              className={`size-2 shrink-0 rounded-full ${online ? "bg-success" : "bg-muted-foreground/40"}`}
              aria-hidden
            />

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{bot.name}</span>
                {bot.bot_username && (
                  <span className="truncate text-xs text-muted-foreground">
                    @{bot.bot_username}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="font-mono">id {bot.bot_id}</span>
                <span>·</span>
                <span>{bot.commands_count} commands</span>
                <span>·</span>
                <span>uptime {bot.uptime || "—"}</span>
              </div>
            </div>

            <Badge variant={online ? "success" : "muted"} className="shrink-0 gap-1">
              {online ? <CheckCircle2 className="size-3" /> : <CircleDot className="size-3" />}
              {online ? "Online" : "Offline"}
            </Badge>

            <Button
              variant="outline"
              size="sm"
              disabled={busyId === bot.bot_id}
              onClick={() => void toggleStatus(bot)}
            >
              {busyId === bot.bot_id ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : online ? (
                <Square className="size-3.5" />
              ) : (
                <Play className="size-3.5" />
              )}
              {online ? "Stop" : "Start"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function DeployInner() {
  const project = useBuilder((state) => state.project);
  const credentials = useCredentials((state) => state.credentials);
  const status = useCredentials((state) => state.status);
  const hydrated = useCredentials((state) => state.hydrated);

  const [reuseExistingBot, setReuseExistingBot] = React.useState(true);
  const [clearExistingCommands, setClearExistingCommands] = React.useState(true);
  const [startAfterDeploy, setStartAfterDeploy] = React.useState(true);

  const [lines, setLines] = React.useState<DeploymentLogLine[]>([]);
  const [running, setRunning] = React.useState(false);
  const [outcome, setOutcome] = React.useState<DeployOutcome | null>(null);
  const [progress, setProgress] = React.useState({ done: 0, total: 0 });

  const [bots, setBots] = React.useState<BotListItem[]>([]);
  const [botsLoading, setBotsLoading] = React.useState(false);
  const [history, setHistory] = React.useState<DeploymentRecord[]>([]);

  const abortRef = React.useRef<AbortController | null>(null);
  const compiled = React.useMemo(() => compileProject(project), [project]);

  React.useEffect(() => {
    setHistory(vault.loadDeployments());
  }, []);

  const refreshBots = React.useCallback(async () => {
    if (!credentials) return;
    setBotsLoading(true);
    const result = await clientApi.listBots(credentials.telebothost.apiKey);
    if (result.ok && result.data) {
      setBots(result.data.bots ?? []);
    } else {
      toast.error("Could not load bots", { description: result.error?.message });
    }
    setBotsLoading(false);
  }, [credentials]);

  React.useEffect(() => {
    if (credentials) void refreshBots();
  }, [credentials, refreshBots]);

  async function handleDeploy() {
    if (!credentials) return;

    setRunning(true);
    setLines([]);
    setOutcome(null);
    setProgress({ done: 0, total: compiled.commands.length });

    const controller = new AbortController();
    abortRef.current = controller;

    const result = await deployProject({
      apiKey: credentials.telebothost.apiKey,
      botToken: credentials.telegram.botToken,
      botName: project.name,
      project,
      reuseExistingBot,
      clearExistingCommands,
      startAfterDeploy,
      onLog: (line) => setLines((previous) => [...previous, line]),
      onProgress: (done, total) => setProgress({ done, total }),
      signal: controller.signal,
    });

    setOutcome(result);
    setRunning(false);
    abortRef.current = null;

    if (result.success) {
      toast.success("Deployed successfully", {
        description: `${result.commandCount} command(s) uploaded to @${result.botUsername}.`,
      });

      const record: DeploymentRecord = {
        id: `dep_${Date.now()}`,
        botId: result.botId ?? 0,
        botName: project.name,
        botUsername: result.botUsername ?? "",
        status: startAfterDeploy ? "online" : "offline",
        commandCount: result.commandCount,
        deployedAt: new Date().toISOString(),
        durationMs: result.durationMs,
      };

      const next = [record, ...history].slice(0, 10);
      setHistory(next);
      vault.saveDeployments(next);
      void refreshBots();
    } else {
      toast.error("Deployment failed", { description: result.error });
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
    toast.info("Cancelling deployment…");
  }

  // ---- Not connected yet ----
  if (hydrated && (!credentials || status !== "unlocked")) {
    return (
      <>
        <PageHeader
          icon={Rocket}
          title="Deploy"
          description="Compile your visual bot and push it to TeleBotHost."
        />
        <div className="p-4 sm:p-6">
          <Card className="mx-auto max-w-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="size-4 text-primary" />
                Credentials required
              </CardTitle>
              <CardDescription>
                Deploying needs a Telegram bot token and a TeleBotHost <code>sk_</code> key. Add them
                once and they stay encrypted on this device.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/setup">
                  <KeyRound className="size-4" />
                  Open setup
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  const blocked = compiled.hasErrors || compiled.commands.length === 0;

  return (
    <>
      <PageHeader
        icon={Rocket}
        title="Deploy"
        description="Compile the builder into TeleBotHost commands, upload them, and start the bot."
        actions={
          <Button variant="outline" size="sm" onClick={() => void refreshBots()}>
            <RefreshCw className="size-3.5" />
            Refresh bots
          </Button>
        }
      />

      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* ---------- Deploy panel ---------- */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pre-flight</CardTitle>
              <CardDescription>
                What will be sent to TeleBotHost for <strong>{project.name}</strong>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Commands", value: compiled.stats.commandCount },
                  { label: "Nodes", value: compiled.stats.nodeCount },
                  { label: "Regex rules", value: compiled.stats.regexRules },
                  { label: "Disabled", value: compiled.stats.skipped },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border bg-muted/30 px-3 py-2.5">
                    <div className="font-mono text-lg font-semibold">{item.value}</div>
                    <div className="text-[11px] text-muted-foreground">{item.label}</div>
                  </div>
                ))}
              </div>

              {compiled.hasErrors && (
                <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <div>
                    <p className="font-medium">Fix the build errors first</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {compiled.diagnostics.filter((d) => d.level === "error").length} error(s) would
                      produce a broken bot. Open the builder to review them.
                    </p>
                    <Button asChild variant="outline" size="sm" className="mt-2">
                      <Link href="/builder">Open builder</Link>
                    </Button>
                  </div>
                </div>
              )}

              {compiled.diagnostics.some((d) => d.level === "warning") && !compiled.hasErrors && (
                <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs">
                  <p className="font-medium">
                    {compiled.diagnostics.filter((d) => d.level === "warning").length} warning(s)
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    These will not stop the deploy, but they usually mean a command will not behave
                    as intended.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Options</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="pr-4">
                  <Label htmlFor="opt-reuse" className="text-sm">
                    Reuse an existing bot
                  </Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    If this bot is already on TeleBotHost, update it instead of creating a duplicate
                    entry.
                  </p>
                </div>
                <Switch id="opt-reuse" checked={reuseExistingBot} onCheckedChange={setReuseExistingBot} />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="pr-4">
                  <Label htmlFor="opt-clear" className="text-sm">
                    Clear existing commands
                  </Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Wipe the bot&apos;s commands before uploading, so the deployed state matches this
                    project exactly.
                  </p>
                </div>
                <Switch
                  id="opt-clear"
                  checked={clearExistingCommands}
                  onCheckedChange={setClearExistingCommands}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="pr-4">
                  <Label htmlFor="opt-start" className="text-sm">
                    Start the bot afterwards
                  </Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Sets the bot to running as soon as every command is uploaded.
                  </p>
                </div>
                <Switch id="opt-start" checked={startAfterDeploy} onCheckedChange={setStartAfterDeploy} />
              </div>

              <Separator />

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => void handleDeploy()}
                  disabled={running || blocked || !credentials}
                  size="lg"
                >
                  {running ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Deploying… {progress.done}/{progress.total}
                    </>
                  ) : (
                    <>
                      <Rocket className="size-4" />
                      Deploy bot
                    </>
                  )}
                </Button>

                {running && (
                  <Button variant="outline" onClick={handleCancel}>
                    <Ban className="size-4" />
                    Cancel
                  </Button>
                )}

                {!running && blocked && (
                  <span className="text-xs text-muted-foreground">
                    {compiled.commands.length === 0
                      ? "Nothing to deploy — add at least one enabled command."
                      : "Resolve the build errors to continue."}
                  </span>
                )}
              </div>

              {running && progress.total > 0 && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${(progress.done / progress.total) * 100}%` }}
                  />
                </div>
              )}

              {running && progress.total > 5 && (
                <p className="text-xs text-muted-foreground">
                  TeleBotHost rate-limits the free tier to 15 requests per minute. Large deploys are
                  paced automatically and may take a few minutes.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Server className="size-4" />
                Deployment log
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <LogViewer lines={lines} running={running} />

              {outcome && (
                <div
                  className={`flex gap-2 rounded-lg border p-3 text-sm ${
                    outcome.success
                      ? "border-success/40 bg-success/5"
                      : "border-destructive/40 bg-destructive/5"
                  }`}
                >
                  {outcome.success ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  ) : (
                    <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium">
                      {outcome.success
                        ? `Deployed ${outcome.commandCount} command(s) to @${outcome.botUsername}`
                        : "Deployment failed"}
                    </p>
                    {!outcome.success && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {outcome.error}
                        {outcome.hint && <span className="block mt-1">{outcome.hint}</span>}
                      </p>
                    )}
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="size-3" />
                      {formatDuration(outcome.durationMs)}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ---------- Sidebar ---------- */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Power className="size-4" />
                Your bots
              </CardTitle>
              <CardDescription>Live status straight from TeleBotHost.</CardDescription>
            </CardHeader>
            <CardContent>
              <BotManager
                apiKey={credentials?.telebothost.apiKey ?? ""}
                bots={bots}
                onRefresh={() => void refreshBots()}
                loading={botsLoading}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="size-4" />
                Recent deploys
              </CardTitle>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No deploys yet from this device.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {history.map((record) => (
                    <li key={record.id} className="flex items-start gap-2.5 text-xs">
                      <div
                        className={`mt-1 size-1.5 shrink-0 rounded-full ${
                          record.status === "online" ? "bg-success" : "bg-muted-foreground/40"
                        }`}
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {record.botUsername ? `@${record.botUsername}` : record.botName}
                        </div>
                        <div className="text-muted-foreground">
                          {record.commandCount} commands · {formatDuration(record.durationMs)}
                        </div>
                        <div className="text-muted-foreground/70">
                          {formatRelative(record.deployedAt)}
                        </div>
                      </div>
                      <span className="ml-auto shrink-0 text-muted-foreground/60">
                        {formatDateTime(record.deployedAt).split(",")[0]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {history.length > 0 && (
                <>
                  <Separator className="my-3" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-muted-foreground"
                    onClick={() => {
                      vault.saveDeployments([]);
                      setHistory([]);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                    Clear history
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

export default function DeployPage() {
  return (
    <AppShell>
      <DeployInner />
    </AppShell>
  );
}
