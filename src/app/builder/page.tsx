"use client";

import * as React from "react";
import Link from "next/link";
import {
  Bot,
  Code2,
  CornerDownLeft,
  Info,
  ListChecks,
  MessageSquare,
  Rocket,
  RotateCcw,
  Send,
  Workflow,
} from "lucide-react";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { CommandList } from "@/components/builder/command-list";
import { TriggerPanel } from "@/components/builder/trigger-panel";
import { ResponsePanel } from "@/components/builder/response-panel";
import { KeyboardPanel } from "@/components/builder/keyboard-panel";
import { FlowPanel } from "@/components/builder/flow-panel";
import { CodePreviewPanel } from "@/components/builder/code-preview";
import { CompileStats, DiagnosticsPanel } from "@/components/builder/diagnostics-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { compileProject, triggerToName } from "@/lib/compiler";
import { useBuilder } from "@/store/useBuilder";
import { TRIGGER_KIND_META } from "@/types/builder";

function BuilderInner() {
  const project = useBuilder((state) => state.project);
  const selectedCommandId = useBuilder((state) => state.selectedCommandId);
  const reset = useBuilder((state) => state.reset);
  const loadError = useBuilder((state) => state.loadError);
  const hydrated = useBuilder((state) => state.hydrated);

  const node = React.useMemo(
    () => project.commands.find((command) => command.id === selectedCommandId) ?? null,
    [project.commands, selectedCommandId],
  );

  const compiled = React.useMemo(() => compileProject(project), [project]);

  return (
    <>
      <PageHeader
        icon={Bot}
        title="Bot Builder"
        description="Design triggers, responses, keyboards and multi-step forms. Everything compiles to TeleBotHost commands."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
            <Button asChild size="sm">
              <Link href="/deploy">
                <Rocket className="size-3.5" />
                Deploy
              </Link>
            </Button>
          </>
        }
      />

      {loadError && (
        <div className="mx-4 mt-4 flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm sm:mx-6">
          <Info className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span className="text-muted-foreground">{loadError}</span>
        </div>
      )}

      {!hydrated ? (
        // Storage is read client-side, so the first paint has no project yet.
        // Show a skeleton rather than the default project, which would flash and
        // then be replaced.
        <div className="grid min-h-0 gap-6 p-4 sm:p-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="space-y-2">
            <div className="h-8 animate-pulse rounded-md bg-muted" />
            <div className="h-14 animate-pulse rounded-lg bg-muted" />
            <div className="h-14 animate-pulse rounded-lg bg-muted" />
            <div className="h-14 animate-pulse rounded-lg bg-muted" />
          </div>
          <div className="space-y-4">
            <div className="h-9 w-64 animate-pulse rounded-md bg-muted" />
            <div className="h-10 animate-pulse rounded-lg bg-muted" />
            <div className="h-40 animate-pulse rounded-xl bg-muted" />
            <div className="h-24 animate-pulse rounded-xl bg-muted" />
          </div>
        </div>
      ) : (
      <div className="grid min-h-0 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* ---------- Command list ---------- */}
        <div className="border-b lg:h-[calc(100dvh-8.5rem)] lg:border-r lg:border-b-0">
          <CommandList />
        </div>

        {/* ---------- Editor ---------- */}
        <div className="min-w-0 lg:h-[calc(100dvh-8.5rem)] lg:overflow-y-auto scrollbar-thin">
          {!node && (
            <div className="flex h-64 flex-col items-center justify-center gap-2 p-8 text-center">
              <Bot className="size-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No command selected</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Pick a command from the list, or add a new one to start building.
              </p>
            </div>
          )}

          {node && (
            <div className="p-4 sm:p-6">
              {/* Editor header */}
              <div className="mb-5 flex flex-wrap items-center gap-2">
                <code className="rounded-md bg-primary/10 px-2 py-1 font-mono text-sm font-medium text-primary">
                  {triggerToName(node.trigger) || "—"}
                </code>
                <Badge variant="muted" className="text-[10px]">
                  {TRIGGER_KIND_META[node.trigger.kind].label}
                </Badge>
                {!node.enabled && (
                  <Badge variant="warning" className="text-[10px]">
                    Disabled — excluded from deploy
                  </Badge>
                )}
                {node.flow.enabled && node.flow.steps.length > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    <Workflow className="size-3" />
                    {node.flow.steps.length}-step form
                  </Badge>
                )}
              </div>

              <Tabs defaultValue="trigger">
                <TabsList className="mb-5 h-auto w-full flex-wrap justify-start">
                  <TabsTrigger value="trigger">
                    <CornerDownLeft className="size-3.5" />
                    Trigger
                  </TabsTrigger>
                  <TabsTrigger value="response">
                    <MessageSquare className="size-3.5" />
                    Response
                  </TabsTrigger>
                  <TabsTrigger value="keyboard">
                    <ListChecks className="size-3.5" />
                    Keyboards
                  </TabsTrigger>
                  <TabsTrigger value="flow">
                    <Workflow className="size-3.5" />
                    Form
                    {node.flow.enabled && node.flow.steps.length > 0 && (
                      <Badge variant="muted" className="ml-1 text-[9px]">
                        {node.flow.steps.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="code">
                    <Code2 className="size-3.5" />
                    Code
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="trigger">
                  <TriggerPanel node={node} />
                </TabsContent>

                <TabsContent value="response">
                  <ResponsePanel node={node} />
                </TabsContent>

                <TabsContent value="keyboard">
                  <KeyboardPanel node={node} />
                </TabsContent>

                <TabsContent value="flow">
                  <FlowPanel node={node} />
                </TabsContent>

                <TabsContent value="code">
                  <CodePreviewPanel node={node} />
                </TabsContent>
              </Tabs>

              <Separator className="my-6" />

              {/* Project-wide compile report */}
              <div className="overflow-hidden rounded-xl border">
                <CompileStats compiled={compiled} />
                <DiagnosticsPanel compiled={compiled} />
              </div>

              <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                <Send className="size-3.5" />
                <span>
                  Ready when there are no errors —{" "}
                  <Link href="/deploy" className="font-medium text-primary underline underline-offset-2">
                    go to Deploy
                  </Link>
                  .
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" aria-label="What gets deployed" className="ml-auto">
                      <Info className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Deploying creates or reuses the bot on TeleBotHost, uploads every enabled command,
                    then optionally starts it.
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          )}
        </div>
      </div>
      )}
    </>
  );
}

export default function BuilderPage() {
  return (
    <AppShell>
      <BuilderInner />
    </AppShell>
  );
}
