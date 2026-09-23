"use client";

import * as React from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Code2,
  Eraser,
  Layers,
  ListTree,
  PanelRight,
  Rocket,
  RotateCcw,
  SlidersHorizontal,
  Workflow,
  X,
} from "lucide-react";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BlockPalette } from "@/components/workflow/block-palette";
import { WorkflowCanvas } from "@/components/workflow/workflow-canvas";
import { InspectorPanel } from "@/components/workflow/inspector/inspector-panel";
import { CodeOutputPanel } from "@/components/workflow/code-output-panel";
import { WorkflowDeployDialog } from "@/components/workflow/deploy-dialog";
import { IssueList } from "@/components/workflow/inspector/fields";
import { compileCanvasToTeleBotHostScript } from "@/lib/workflow-compiler";
import { useSelectedWorkflowNode, useWorkflow } from "@/store/useWorkflow";
import type { BlockKind, ValidationIssue } from "@/types/workflow";

/** Issues keyed by node, plus the ones with no node to attach to. */
function groupIssues(issues: ValidationIssue[]) {
  const byNode = new Map<string, ValidationIssue[]>();
  const documentIssues: ValidationIssue[] = [];

  for (const issue of issues) {
    if (!issue.nodeId) {
      documentIssues.push(issue);
      continue;
    }
    const existing = byNode.get(issue.nodeId) ?? [];
    existing.push(issue);
    byNode.set(issue.nodeId, existing);
  }

  return { byNode, documentIssues };
}

function WorkflowPageInner() {
  const document = useWorkflow((state) => state.document);
  const hydrated = useWorkflow((state) => state.hydrated);
  const loadError = useWorkflow((state) => state.loadError);
  const addNode = useWorkflow((state) => state.addNode);
  const selectNode = useWorkflow((state) => state.selectNode);
  const reset = useWorkflow((state) => state.reset);
  const clearCanvas = useWorkflow((state) => state.clearCanvas);
  const setDocumentName = useWorkflow((state) => state.setDocumentName);

  const selectedNode = useSelectedWorkflowNode();

  const [mobilePanel, setMobilePanel] = React.useState<"none" | "palette" | "inspector">("none");
  const [deployOpen, setDeployOpen] = React.useState(false);

  // Compile once per graph change; the canvas, the issue badges and the code panel
  // all read from this single result.
  const compiled = React.useMemo(
    () => compileCanvasToTeleBotHostScript(document.nodes, document.edges, { documentId: document.id }),
    [document.nodes, document.edges, document.id],
  );

  const { byNode, documentIssues } = React.useMemo(
    () => groupIssues(compiled.issues),
    [compiled.issues],
  );

  const errors = compiled.issues.filter((issue) => issue.severity === "error").length;
  const warnings = compiled.issues.filter((issue) => issue.severity === "warning").length;

  /** Clicking a palette card drops the block near the top-left in a cascade. */
  const handleAddBlock = React.useCallback(
    (kind: BlockKind) => {
      const count = document.nodes.length;
      addNode(kind, {
        x: 80 + (count % 4) * 72,
        y: 80 + (count % 6) * 64,
      });
      setMobilePanel("none");
    },
    [addNode, document.nodes.length],
  );

  return (
    <>
      <PageHeader
        icon={Workflow}
        title="Workflow Canvas"
        description="Drag script blocks onto the canvas, wire them together, and compile the graph into TeleBotHost commands."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMobilePanel("palette")}
              className="lg:hidden"
            >
              <Layers className="size-3.5" />
              Blocks
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMobilePanel("inspector")}
              className="xl:hidden"
            >
              <SlidersHorizontal className="size-3.5" />
              Inspector
            </Button>
            <Button variant="outline" size="sm" onClick={clearCanvas}>
              <Eraser className="size-3.5" />
              Clear
            </Button>
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
            <Button
              size="sm"
              onClick={() => setDeployOpen(true)}
              disabled={compiled.hasErrors || compiled.commands.length === 0}
            >
              <Rocket className="size-3.5" />
              Deploy
            </Button>
          </>
        }
      />

      {/* ---- Document name + compile status strip ---- */}
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2 sm:px-6">
        <Input
          value={document.name}
          onChange={(event) => setDocumentName(event.target.value)}
          aria-label="Workflow name"
          className="h-7 w-52 border-transparent bg-transparent px-1 text-sm font-semibold shadow-none focus-visible:border-input focus-visible:bg-background"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="muted" className="text-[10px]">
            {compiled.stats.nodeCount} blocks
          </Badge>
          <Badge variant="muted" className="text-[10px]">
            {compiled.stats.edgeCount} connections
          </Badge>
          <Badge variant="muted" className="text-[10px]">
            {compiled.stats.commandCount} commands
          </Badge>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {compiled.hasErrors ? (
            <Badge variant="destructive" className="gap-1 text-[10px]">
              <AlertCircle className="size-3" />
              {errors} error{errors === 1 ? "" : "s"}
            </Badge>
          ) : (
            <Badge variant="success" className="gap-1 text-[10px]">
              <CheckCircle2 className="size-3" />
              Ready to deploy
            </Badge>
          )}
          {warnings > 0 && (
            <Badge variant="warning" className="gap-1 text-[10px]">
              <AlertTriangle className="size-3" />
              {warnings}
            </Badge>
          )}
        </div>
      </div>

      {loadError && (
        <div className="mx-4 mt-3 flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm sm:mx-6">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span className="text-muted-foreground">{loadError}</span>
        </div>
      )}

      {/* ---- Three-pane workspace ---- */}
      <div className="flex h-[calc(100dvh-11rem)] min-h-0">
        {/* ---- Palette ---- */}
        {/* Rendered immediately: it is static, so there is no reason to hold it
            behind the hydration gate. Only the parts that read the saved document
            need to wait. */}
        <aside className="hidden w-60 shrink-0 border-r lg:block">
          <BlockPalette onAdd={handleAddBlock} />
        </aside>

        {/* ---- Canvas + output ---- */}
        <div className="flex min-w-0 flex-1 flex-col">
          {!hydrated ? (
            <>
              <div className="min-h-0 flex-1 p-4">
                <div className="h-full w-full animate-pulse rounded-xl bg-muted" />
              </div>
              <div className="h-72 shrink-0 border-t p-4">
                <div className="h-full w-full animate-pulse rounded-lg bg-muted" />
              </div>
            </>
          ) : (
            <>
            <div className="min-h-0 flex-1">
              <WorkflowCanvas issuesByNode={byNode} documentIssues={documentIssues} />
            </div>

            {/* Bottom drawer: generated code and validation */}
            <div className="h-72 shrink-0 border-t bg-card/40">
              <Tabs defaultValue="code" className="flex h-full flex-col gap-0">
                <div className="flex items-center gap-2 border-b px-3 py-1.5">
                  <TabsList className="h-7 bg-transparent p-0">
                    <TabsTrigger value="code" className="h-6 gap-1.5 px-2.5 text-[11px]">
                      <Code2 className="size-3" />
                      Generated TBL
                    </TabsTrigger>
                    <TabsTrigger value="issues" className="h-6 gap-1.5 px-2.5 text-[11px]">
                      <ListTree className="size-3" />
                      Validation
                      {errors + warnings > 0 && (
                        <Badge
                          variant={errors > 0 ? "destructive" : "warning"}
                          className="ml-0.5 text-[9px]"
                        >
                          {errors + warnings}
                        </Badge>
                      )}
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="code" className="m-0 min-h-0 flex-1">
                  <CodeOutputPanel compiled={compiled} />
                </TabsContent>

                <TabsContent value="issues" className="m-0 min-h-0 flex-1">
                  <ScrollArea className="h-full">
                    <div className="space-y-2 p-3">
                      {compiled.issues.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 py-8 text-center">
                          <CheckCircle2 className="size-6 text-success" />
                          <p className="text-xs font-medium">No problems found</p>
                          <p className="max-w-sm text-[11px] text-muted-foreground">
                            Every block is configured and connected. The graph compiles to{" "}
                            {compiled.stats.commandCount} TeleBotHost command
                            {compiled.stats.commandCount === 1 ? "" : "s"}.
                          </p>
                        </div>
                      ) : (
                        <IssueList issues={compiled.issues} />
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </div>
            </>
          )}
        </div>

        {/* ---- Inspector ---- */}
        <aside className="hidden w-80 shrink-0 border-l xl:block">
          {hydrated ? (
            <InspectorPanel
              node={selectedNode}
              issues={selectedNode ? (byNode.get(selectedNode.id) ?? []) : []}
            />
          ) : (
            <div className="h-full p-4">
              <div className="h-full w-full animate-pulse rounded-xl bg-muted" />
            </div>
          )}
        </aside>
      </div>

      {/* ---- Mobile overlays ---- */}
      {mobilePanel !== "none" && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobilePanel("none")}
            aria-hidden
          />
          <div
            className={`relative z-10 flex h-full w-[19rem] flex-col bg-background shadow-xl ${
              mobilePanel === "inspector" ? "ml-auto border-l" : "border-r"
            }`}
          >
            {mobilePanel === "palette" ? (
              <BlockPalette onAdd={handleAddBlock} onClose={() => setMobilePanel("none")} />
            ) : (
              <InspectorPanel
                node={selectedNode}
                issues={selectedNode ? (byNode.get(selectedNode.id) ?? []) : []}
                onClose={() => setMobilePanel("none")}
              />
            )}
          </div>
        </div>
      )}

      <WorkflowDeployDialog
        open={deployOpen}
        onOpenChange={setDeployOpen}
        compiled={compiled}
        documentName={document.name}
      />
    </>
  );
}

export default function WorkflowPage() {
  return (
    <AppShell>
      <WorkflowPageInner />
    </AppShell>
  );
}
