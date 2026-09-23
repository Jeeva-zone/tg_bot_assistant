"use client";

import * as React from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type IsValidConnection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { BlockKind, ValidationIssue } from "@/types/workflow";
import { nodeTypes } from "@/components/workflow/nodes";
import { BLOCK_DRAG_MIME } from "@/components/workflow/block-palette";
import { WorkflowIssuesProvider } from "@/components/workflow/workflow-context";
import { BLOCK_BY_KIND } from "@/lib/workflow-blocks";
import { isValidConnection as isConnectionAllowed, useWorkflow } from "@/store/useWorkflow";

/**
 * The interactive canvas.
 *
 * Kept as a controlled component: React Flow emits change objects, the Zustand store
 * applies them and persists, and the new arrays flow back down as props. That single
 * loop is what keeps the inspector, the validator and the compiler reading the same
 * graph.
 */

type WorkflowCanvasProps = {
  issuesByNode: Map<string, ValidationIssue[]>;
  documentIssues: ValidationIssue[];
};

function CanvasInner({ issuesByNode, documentIssues }: WorkflowCanvasProps) {
  const document = useWorkflow((state) => state.document);
  const onNodesChange = useWorkflow((state) => state.onNodesChange);
  const onEdgesChange = useWorkflow((state) => state.onEdgesChange);
  const onConnect = useWorkflow((state) => state.onConnect);
  const addNode = useWorkflow((state) => state.addNode);
  const selectNode = useWorkflow((state) => state.selectNode);

  const { screenToFlowPosition } = useReactFlow();
  const [dragActive, setDragActive] = React.useState(false);

  // ---- Drag and drop from the palette ----
  const handleDragOver = React.useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragActive(true);
  }, []);

  const handleDragLeave = React.useCallback((event: React.DragEvent) => {
    // Only clear when leaving the canvas itself, not when crossing a child element.
    if (event.currentTarget === event.target) setDragActive(false);
  }, []);

  const handleDrop = React.useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragActive(false);

      const kind =
        event.dataTransfer.getData(BLOCK_DRAG_MIME) || event.dataTransfer.getData("text/plain");

      if (!kind || !(kind in BLOCK_BY_KIND)) return;

      // Convert the pointer position into canvas coordinates so the node lands under
      // the cursor regardless of pan and zoom.
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });

      // Offset by half the node width so the cursor sits on the node's centre.
      addNode(kind as BlockKind, { x: position.x - 124, y: position.y - 24 });
    },
    [addNode, screenToFlowPosition],
  );

  // ---- Connection validation ----
  const isValidConnection = React.useCallback<IsValidConnection>(
    (connection) => isConnectionAllowed(connection, document.nodes),
    [document.nodes],
  );

  return (
    <div
      className="relative h-full w-full"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ReactFlow
        nodes={document.nodes}
        edges={document.edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        isValidConnection={isValidConnection}
        onNodeClick={(_, node) => selectNode(node.id)}
        onPaneClick={() => selectNode(null)}
        deleteKeyCode={["Backspace", "Delete"]}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{
          animated: true,
          style: { strokeWidth: 2 },
        }}
        connectionLineStyle={{ strokeWidth: 2 }}
        proOptions={{ hideAttribution: false }}
        className="bg-background"
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} className="!bg-muted/20" />
        <Controls
          showInteractive={false}
          className="!rounded-lg !border !bg-card !shadow-sm [&>button]:!border-border [&>button]:!bg-card [&>button:hover]:!bg-accent"
        />
        <MiniMap
          pannable
          zoomable
          className="!rounded-lg !border !bg-card"
          maskColor="color-mix(in oklch, var(--muted) 70%, transparent)"
          nodeColor={(node) => {
            const definition = BLOCK_BY_KIND[node.type as BlockKind];
            if (!definition) return "var(--muted-foreground)";
            // Map the accent class back to a concrete colour for the minimap swatch.
            switch (node.type) {
              case "trigger":
                return "var(--primary)";
              case "message":
                return "var(--success)";
              case "keyboard":
                return "var(--chart-5)";
              case "api":
                return "var(--chart-3)";
              case "condition":
                return "var(--warning)";
              case "state":
                return "var(--chart-4)";
              default:
                return "var(--muted-foreground)";
            }
          }}
        />
      </ReactFlow>

      {/* ---- Drop hint ---- */}
      {dragActive && (
        <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary/50 bg-primary/5">
          <span className="rounded-lg bg-background/90 px-3 py-1.5 text-xs font-medium text-primary shadow-sm">
            Drop to add the block
          </span>
        </div>
      )}

      {/* ---- Empty state ---- */}
      {document.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="max-w-xs rounded-xl border border-dashed bg-background/95 p-6 text-center shadow-sm">
            <p className="text-sm font-medium">Your canvas is empty</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Drag a <strong>Trigger</strong> block from the library on the left, then connect it to
              a <strong>Message</strong> block.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  const { issuesByNode, documentIssues } = props;

  return (
    <WorkflowIssuesProvider byNode={issuesByNode} documentIssues={documentIssues}>
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </WorkflowIssuesProvider>
  );
}
