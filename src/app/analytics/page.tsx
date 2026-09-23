"use client";

import * as React from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  CircleDot,
  Eraser,
  KeyRound,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  RefreshCw,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import * as clientApi from "@/lib/client-api";
import { formatNumber, formatRelative } from "@/lib/utils";
import { useCredentials } from "@/store/useCredentials";
import type { BotAnalytics, BotListItem, BotLogEntry } from "@/types/telebothost";

const POLL_INTERVAL_MS = 10_000;

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {Icon && <Icon className="size-3" />}
        {label}
      </div>
      <div className="mt-1 font-mono text-xl font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function LogRow({ entry }: { entry: BotLogEntry }) {
  const isError = Boolean(entry.error_message) || entry.type?.toLowerCase() === "error";

  return (
    <div
      className={`rounded-lg border p-2.5 ${
        isError ? "border-destructive/40 bg-destructive/5" : "bg-card"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {isError ? (
          <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0 text-success" />
        )}

        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium">
          {entry.command || "(unmatched)"}
        </code>

        {entry.type && (
          <Badge variant={isError ? "destructive" : "muted"} className="text-[10px]">
            {entry.type}
          </Badge>
        )}

        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
          {formatRelative(entry.log_timestamp)}
        </span>
      </div>

      {entry.error_message && (
        <p className="mt-1.5 break-words font-mono text-[11px] text-destructive">
          {entry.error_message}
        </p>
      )}

      {entry.stack && (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">
            Stack trace
          </summary>
          <pre className="code-block mt-1.5 max-h-48 overflow-auto rounded border bg-muted/50 p-2 text-[10px]">
            {entry.stack}
          </pre>
        </details>
      )}
    </div>
  );
}

function AnalyticsInner() {
  const credentials = useCredentials((state) => state.credentials);
  const status = useCredentials((state) => state.status);
  const hydrated = useCredentials((state) => state.hydrated);

  const [bots, setBots] = React.useState<BotListItem[]>([]);
  const [selectedBotId, setSelectedBotId] = React.useState<string>("");
  const [analytics, setAnalytics] = React.useState<BotAnalytics | null>(null);
  const [logs, setLogs] = React.useState<BotLogEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [polling, setPolling] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const apiKey = credentials?.telebothost.apiKey ?? "";

  // ---- Load the bot list once credentials are available ----
  React.useEffect(() => {
    if (!apiKey) return;

    let cancelled = false;
    (async () => {
      const result = await clientApi.listBots(apiKey);
      if (cancelled) return;

      if (result.ok && result.data) {
        const list = result.data.bots ?? [];
        setBots(list);
        setSelectedBotId((current) => current || String(list[0]?.bot_id ?? ""));
      } else {
        setError(result.error?.message ?? "Could not load bots.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  const selectedBot = bots.find((bot) => String(bot.bot_id) === selectedBotId) ?? null;

  // ---- Poll analytics + logs for the selected bot ----
  const loadData = React.useCallback(async () => {
    if (!apiKey || !selectedBotId) return;

    setLoading(true);
    const botId = Number(selectedBotId);

    const [analyticsResult, logsResult] = await Promise.all([
      clientApi.getAnalytics(apiKey, botId),
      clientApi.listLogs(apiKey, botId),
    ]);

    if (analyticsResult.ok && analyticsResult.data) {
      setAnalytics(analyticsResult.data);
      setError(null);
    } else if (!analyticsResult.ok) {
      setError(analyticsResult.error?.message ?? "Could not load analytics.");
    }

    if (logsResult.ok && logsResult.data) {
      setLogs(logsResult.data.logs ?? []);
    }

    setLoading(false);
  }, [apiKey, selectedBotId]);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  React.useEffect(() => {
    if (!polling || !apiKey || !selectedBotId) return;
    const timer = setInterval(() => void loadData(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [polling, apiKey, selectedBotId, loadData]);

  async function handleClearLogs() {
    if (!apiKey || !selectedBotId) return;
    const result = await clientApi.clearLogs(apiKey, Number(selectedBotId));
    if (result.ok) {
      toast.success("Logs cleared");
      void loadData();
    } else {
      toast.error("Could not clear logs", { description: result.error?.message });
    }
  }

  async function handleToggleStatus() {
    if (!apiKey || !selectedBot) return;
    const nextStatus = selectedBot.status === 1 ? 0 : 1;
    const result = await clientApi.updateBot(apiKey, selectedBot.bot_id, { status: nextStatus });

    if (result.ok) {
      toast.success(nextStatus === 1 ? "Bot started" : "Bot stopped");
      setBots((previous) =>
        previous.map((bot) =>
          bot.bot_id === selectedBot.bot_id ? { ...bot, status: nextStatus } : bot,
        ),
      );
    } else {
      toast.error("Could not change bot state", { description: result.error?.message });
    }
  }

  // ---- Gate ----
  if (hydrated && (!credentials || status !== "unlocked")) {
    return (
      <>
        <PageHeader icon={BarChart3} title="Analytics & Logs" />
        <div className="p-4 sm:p-6">
          <Card className="mx-auto max-w-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="size-4 text-primary" />
                Credentials required
              </CardTitle>
              <CardDescription>
                Analytics and logs are read straight from your TeleBotHost account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/setup">Open setup</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  const online = selectedBot?.status === 1;
  const errorLogs = logs.filter(
    (entry) => entry.error_message || entry.type?.toLowerCase() === "error",
  );

  return (
    <>
      <PageHeader
        icon={BarChart3}
        title="Analytics & Logs"
        description="Live bot status, usage statistics and the execution log from TeleBotHost."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPolling((value) => !value)}
              aria-pressed={polling}
            >
              {polling ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              {polling ? "Pause polling" : "Resume polling"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void loadData()} disabled={loading}>
              {loading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Refresh
            </Button>
          </>
        }
      />

      <div className="space-y-6 p-4 sm:p-6">
        {/* ---- Bot selector + status ---- */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-4 pt-0">
            <div className="min-w-56 flex-1">
              <label htmlFor="bot-select" className="mb-1.5 block text-xs font-medium">
                Bot
              </label>
              <Select value={selectedBotId} onValueChange={setSelectedBotId}>
                <SelectTrigger id="bot-select">
                  <SelectValue placeholder="Select a bot" />
                </SelectTrigger>
                <SelectContent>
                  {bots.map((bot) => (
                    <SelectItem key={bot.bot_id} value={String(bot.bot_id)}>
                      {bot.name}
                      {bot.bot_username ? ` (@${bot.bot_username})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedBot && (
              <>
                <div className="flex items-center gap-2.5">
                  <span
                    className={`size-2.5 rounded-full ${online ? "bg-success" : "bg-muted-foreground/40"}`}
                    aria-hidden
                  />
                  <div>
                    <div className="text-xs font-medium">
                      {online ? "Online" : "Offline"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      uptime {selectedBot.uptime || "—"}
                    </div>
                  </div>
                </div>

                <Button variant="outline" size="sm" onClick={() => void handleToggleStatus()}>
                  {online ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                  {online ? "Stop bot" : "Start bot"}
                </Button>
              </>
            )}

            {bots.length === 0 && !loading && (
              <p className="text-xs text-muted-foreground">
                No bots on this account yet.{" "}
                <Link href="/deploy" className="text-primary underline underline-offset-2">
                  Deploy one
                </Link>
                .
              </p>
            )}
          </CardContent>
        </Card>

        {error && (
          <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span className="text-muted-foreground">{error}</span>
          </div>
        )}

        {/* ---- Stats ---- */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold">Usage</h2>
            {analytics?.calculated_at && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[11px] text-muted-foreground">
                    calculated {formatRelative(analytics.calculated_at)}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  TeleBotHost recalculates these statistics periodically, so they are not live to the
                  second.
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard
              label="Total users"
              value={formatNumber(analytics?.total_users)}
              icon={Users}
            />
            <StatCard
              label="Active 24h"
              value={formatNumber(analytics?.active_24h)}
              icon={Activity}
            />
            <StatCard label="Active this month" value={formatNumber(analytics?.active_month)} />
            <StatCard label="New today" value={formatNumber(analytics?.new_today)} />
            <StatCard label="New this month" value={formatNumber(analytics?.new_month)} />
            <StatCard label="Premium users" value={formatNumber(analytics?.premium_users)} />
            <StatCard
              label="Private chats"
              value={formatNumber(analytics?.private_chats)}
              icon={MessageSquare}
            />
            <StatCard label="Group chats" value={formatNumber(analytics?.group_chats)} />
          </div>
        </div>

        {/* ---- Logs ---- */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                Execution log
                {logs.length > 0 && (
                  <Badge variant="muted" className="text-[10px]">
                    {logs.length}
                  </Badge>
                )}
                {errorLogs.length > 0 && (
                  <Badge variant="destructive" className="text-[10px]">
                    {errorLogs.length} error{errorLogs.length === 1 ? "" : "s"}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                {polling
                  ? `Refreshing every ${POLL_INTERVAL_MS / 1000}s while this tab is open.`
                  : "Polling is paused."}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleClearLogs()}
              disabled={logs.length === 0}
            >
              <Eraser className="size-3.5" />
              Clear
            </Button>
          </CardHeader>

          <CardContent>
            <ScrollArea className="max-h-[32rem]">
              <div className="space-y-2 pr-2">
                {logs.length === 0 && (
                  <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
                    <CircleDot className="size-6 text-muted-foreground/50" />
                    <p className="text-xs text-muted-foreground">
                      No log entries yet. Send a message to your bot in Telegram and it will appear
                      here.
                    </p>
                  </div>
                )}

                {logs.map((entry) => (
                  <LogRow key={entry.id} entry={entry} />
                ))}
              </div>
            </ScrollArea>

            {logs.length > 0 && (
              <>
                <Separator className="my-3" />
                <p className="text-[11px] text-muted-foreground">
                  Logs are retained by TeleBotHost. Each entry records which command matched and
                  whether it threw.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export default function AnalyticsPage() {
  return (
    <AppShell>
      <AnalyticsInner />
    </AppShell>
  );
}
