"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  CircleDot,
  Code2,
  KeyRound,
  Layers,
  ListChecks,
  Rocket,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { compileProject } from "@/lib/compiler";
import { formatRelative } from "@/lib/utils";
import { useBuilder } from "@/store/useBuilder";
import { useCredentials } from "@/store/useCredentials";

function StepCard({
  index,
  title,
  description,
  href,
  done,
  icon: Icon,
}: {
  index: number;
  title: string;
  description: string;
  href: string;
  done: boolean;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
    >
      <div className="flex items-center gap-2.5">
        <div
          className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${
            done ? "bg-success/15" : "bg-muted"
          }`}
        >
          {done ? (
            <CheckCircle2 className="size-3.5 text-success" />
          ) : (
            <Icon className="size-3.5 text-muted-foreground" />
          )}
        </div>
        <span className="text-[11px] font-medium text-muted-foreground">Step {index}</span>
        {done && (
          <Badge variant="success" className="ml-auto text-[10px]">
            Done
          </Badge>
        )}
      </div>

      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-1 flex-1 text-xs text-muted-foreground">{description}</p>

      <span className="mt-3 flex items-center gap-1 text-xs font-medium text-primary">
        Open
        <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

function DashboardInner() {
  const project = useBuilder((state) => state.project);
  const credentials = useCredentials((state) => state.credentials);
  const status = useCredentials((state) => state.status);
  const hydrated = useCredentials((state) => state.hydrated);

  const compiled = React.useMemo(() => compileProject(project), [project]);

  const connected = Boolean(credentials) && status === "unlocked";
  const hasCommands = project.commands.length > 0;
  const errors = compiled.diagnostics.filter((item) => item.level === "error");

  return (
    <>
      <PageHeader
        icon={Bot}
        title="TeleBot Builder"
        description="Design a Telegram bot visually, then compile and deploy it to TeleBotHost — no TBL written by hand."
        actions={
          connected ? (
            <Badge variant="success" className="gap-1.5">
              <ShieldCheck className="size-3" />
              {credentials?.telegram.botUsername
                ? `@${credentials.telegram.botUsername}`
                : "Connected"}
            </Badge>
          ) : (
            <Badge variant="warning" className="gap-1.5">
              <CircleDot className="size-3" />
              Not connected
            </Badge>
          )
        }
      />

      <div className="space-y-6 p-4 sm:p-6">
        {/* ---- Status banner ---- */}
        {!hydrated ? (
          <div className="h-20 animate-pulse rounded-xl bg-muted" />
        ) : !connected ? (
          <div className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <KeyRound className="mt-0.5 size-4 shrink-0 text-warning" />
              <div>
                <p className="text-sm font-medium">Connect your credentials to deploy</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  You can design a bot without them — but deploying needs a Telegram bot token and a
                  TeleBotHost <code className="rounded bg-muted px-1">sk_</code> key. Both are
                  encrypted in this browser.
                </p>
              </div>
            </div>
            <Button asChild className="shrink-0">
              <Link href="/setup">
                <KeyRound className="size-4" />
                Set up
              </Link>
            </Button>
          </div>
        ) : errors.length > 0 ? (
          <div className="flex flex-col gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-medium">
                  {errors.length} build error{errors.length === 1 ? "" : "s"} blocking deploy
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{errors[0]?.message}</p>
              </div>
            </div>
            <Button asChild variant="outline" className="shrink-0">
              <Link href="/builder">Review in builder</Link>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-xl border border-success/40 bg-success/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              <div>
                <p className="text-sm font-medium">
                  {compiled.stats.commandCount} command
                  {compiled.stats.commandCount === 1 ? "" : "s"} compiled and ready
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Project last edited {formatRelative(project.updatedAt)}. Push it live whenever
                  you&apos;re ready.
                </p>
              </div>
            </div>
            <Button asChild className="shrink-0">
              <Link href="/deploy">
                <Rocket className="size-4" />
                Deploy
              </Link>
            </Button>
          </div>
        )}

        {/* ---- Onboarding steps ---- */}
        <div>
          <h2 className="mb-3 text-sm font-semibold">Getting started</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StepCard
              index={1}
              title="Add credentials"
              description="Verify your BotFather token and TeleBotHost key against the live APIs."
              href="/setup"
              done={connected}
              icon={KeyRound}
            />
            <StepCard
              index={2}
              title="Build commands"
              description="Triggers, rich responses, keyboards and multi-step forms."
              href="/builder"
              done={hasCommands && errors.length === 0}
              icon={Bot}
            />
            <StepCard
              index={3}
              title="Deploy to TeleBotHost"
              description="Create the bot, upload every command, and start it running."
              href="/deploy"
              done={false}
              icon={Rocket}
            />
            <StepCard
              index={4}
              title="Watch it work"
              description="Live status, user stats and the execution log."
              href="/analytics"
              done={false}
              icon={BarChart3}
            />
          </div>
        </div>

        {/* ---- Feature overview + compile summary ---- */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="size-4 text-primary" />
                What the builder generates
              </CardTitle>
              <CardDescription>
                Everything below compiles to real TeleBotHost commands — not a simulation.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                {
                  icon: Layers,
                  title: "Triggers",
                  body: "Slash commands, exact keywords, regex patterns, callback data and the wildcard fallback. Regex rules are folded into the single * dispatcher, because TBL's router matches exact names only.",
                },
                {
                  icon: ListChecks,
                  title: "Responses & keyboards",
                  body: "Markdown, HTML or MarkdownV2 text, photo/document/video/audio attachments, persistent reply keyboards and inline callback or URL buttons.",
                },
                {
                  icon: Workflow,
                  title: "Multi-step forms",
                  body: "Sequential prompts with per-field validation, persisted in TeleBotHost's built-in db so answers survive between messages.",
                },
                {
                  icon: Code2,
                  title: "Deployment engine",
                  body: "Registers the bot, uploads commands with rate-limit-aware pacing, and toggles it running — with a live log of every step.",
                },
              ].map((feature) => (
                <div key={feature.title} className="flex gap-3">
                  <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <feature.icon className="size-3.5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium">{feature.title}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{feature.body}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Compile summary</CardTitle>
                <CardDescription>{project.name}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="space-y-2 text-sm">
                  {[
                    { label: "Builder nodes", value: compiled.stats.nodeCount },
                    { label: "TBL commands", value: compiled.stats.commandCount },
                    { label: "Regex rules", value: compiled.stats.regexRules },
                    { label: "Disabled", value: compiled.stats.skipped },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between">
                      <dt className="text-xs text-muted-foreground">{row.label}</dt>
                      <dd className="font-mono text-sm">{row.value}</dd>
                    </div>
                  ))}
                </dl>

                <Separator />

                <div className="flex items-center gap-2">
                  {errors.length > 0 ? (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="size-3" />
                      {errors.length} error{errors.length === 1 ? "" : "s"}
                    </Badge>
                  ) : (
                    <Badge variant="success" className="gap-1">
                      <CheckCircle2 className="size-3" />
                      Ready to deploy
                    </Badge>
                  )}
                </div>

                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link href="/builder">Open builder</Link>
                </Button>
              </CardContent>
            </Card>

            <Card className="border-dashed bg-muted/30">
              <CardHeader>
                <CardTitle className="text-sm">Built for TeleBotHost</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <p>
                  Targets the TeleBotHost Developer API v1 at{" "}
                  <code className="rounded bg-muted px-1">api.telebothost.com</code>, and TBL —
                  plain JavaScript with <code className="rounded bg-muted px-1">Bot</code>,{" "}
                  <code className="rounded bg-muted px-1">Api</code> and{" "}
                  <code className="rounded bg-muted px-1">db</code> already in scope.
                </p>
                <p>
                  Deploys are paced around TeleBotHost&apos;s per-minute quota so large bots never
                  trip the strike system.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

export default function DashboardPage() {
  return (
    <AppShell>
      <DashboardInner />
    </AppShell>
  );
}
