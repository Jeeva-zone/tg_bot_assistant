"use client";

/**
 * Workflow graph store.
 *
 * React Flow is a controlled component: it hands us change objects and expects the
 * updated arrays back. We keep the document in Zustand so the inspector, the
 * validator and the compiler all read the same source of truth, and persist to
 * localStorage on a debounce so dragging a node does not hammer storage.
 */

import { create } from "zustand";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import {
  HANDLE,
  createEmptyDocument,
  createWorkflowId,
  type BlockKind,
  type WorkflowDocument,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowNodeData,
} from "@/types/workflow";
import { createNodeFromKind } from "@/lib/workflow-blocks";
import * as vault from "@/lib/vault";

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(document: WorkflowDocument) {
  if (typeof window === "undefined") return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    vault.saveWorkflow(document);
    saveTimer = null;
  }, 500);
}

// ---------------------------------------------------------------------------
// Starter template
// ---------------------------------------------------------------------------

/**
 * A small but complete example so the canvas is never an intimidating blank slate,
 * and so the generated code can be inspected immediately.
 */
export function createStarterWorkflow(): WorkflowDocument {
  const base = createEmptyDocument("Support Bot");

  const trigger = {
    id: createWorkflowId("trigger"),
    type: "trigger" as const,
    position: { x: 40, y: 160 },
    data: {
      kind: "trigger" as const,
      label: "Start command",
      triggerKind: "command" as const,
      value: "/start",
      caseInsensitive: false,
      aliases: ["Start"],
      groupOnly: false,
    },
  };

  const welcome = {
    id: createWorkflowId("message"),
    type: "message" as const,
    position: { x: 360, y: 150 },
    data: {
      kind: "message" as const,
      label: "Welcome",
      text: "Hi {{user.first_name}}! 👋\nWelcome to Support Bot.",
      parseMode: "Markdown" as const,
      media: [],
      captureMessageId: "",
    },
  };

  const menu = {
    id: createWorkflowId("keyboard"),
    type: "keyboard" as const,
    position: { x: 680, y: 150 },
    data: {
      kind: "keyboard" as const,
      label: "Main menu",
      keyboardType: "inline" as const,
      text: "How can I help?",
      parseMode: "Markdown" as const,
      rows: [
        [
          { id: createWorkflowId("btn"), text: "Pricing", action: "callback" as const, value: "price" },
          { id: createWorkflowId("btn"), text: "Website", action: "url" as const, value: "https://telebothost.com" },
        ],
      ],
      resize: true,
      oneTime: false,
      placeholder: "",
    },
  };

  const branch = {
    id: createWorkflowId("condition"),
    type: "condition" as const,
    position: { x: 360, y: 420 },
    data: {
      kind: "condition" as const,
      label: "Asks about price",
      subject: "message" as const,
      variable: "",
      operator: "contains" as const,
      compareValue: "price",
      caseInsensitive: true,
    },
  };

  const priceReply = {
    id: createWorkflowId("message"),
    type: "message" as const,
    position: { x: 700, y: 380 },
    data: {
      kind: "message" as const,
      label: "Price answer",
      text: "Our plans start free, with Premium at a higher tier. 🎉",
      parseMode: "Markdown" as const,
      media: [],
      captureMessageId: "",
    },
  };

  const fallback = {
    id: createWorkflowId("message"),
    type: "message" as const,
    position: { x: 700, y: 560 },
    data: {
      kind: "message" as const,
      label: "Fallback",
      text: "Let me look into that for you.",
      parseMode: "Markdown" as const,
      media: [],
      captureMessageId: "",
    },
  };

  const priceTrigger = {
    id: createWorkflowId("trigger"),
    type: "trigger" as const,
    position: { x: 40, y: 430 },
    data: {
      kind: "trigger" as const,
      label: "Price callback",
      triggerKind: "callback" as const,
      value: "price",
      caseInsensitive: false,
      aliases: [],
      groupOnly: false,
    },
  };

  const nodes = [trigger, welcome, menu, priceTrigger, branch, priceReply, fallback] as WorkflowNode[];

  const edges: WorkflowEdge[] = [
    { id: createWorkflowId("e"), source: trigger.id, target: welcome.id, sourceHandle: HANDLE.OUTPUT, targetHandle: HANDLE.INPUT },
    { id: createWorkflowId("e"), source: welcome.id, target: menu.id, sourceHandle: HANDLE.OUTPUT, targetHandle: HANDLE.INPUT },
    { id: createWorkflowId("e"), source: priceTrigger.id, target: branch.id, sourceHandle: HANDLE.OUTPUT, targetHandle: HANDLE.INPUT },
    { id: createWorkflowId("e"), source: branch.id, target: priceReply.id, sourceHandle: HANDLE.TRUE, targetHandle: HANDLE.INPUT },
    { id: createWorkflowId("e"), source: branch.id, target: fallback.id, sourceHandle: HANDLE.FALSE, targetHandle: HANDLE.INPUT },
  ];

  return { ...base, nodes, edges };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface WorkflowState {
  document: WorkflowDocument;
  selectedNodeId: string | null;
  hydrated: boolean;
  loadError: string | null;

  hydrate: () => void;
  reset: () => void;
  clearCanvas: () => void;

  setDocumentName: (name: string) => void;
  setDocumentDescription: (description: string) => void;

  onNodesChange: (changes: NodeChange<WorkflowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<WorkflowEdge>[]) => void;
  onConnect: (connection: Connection) => void;

  addNode: (kind: BlockKind, position: { x: number; y: number }) => string;
  updateNodeData: (nodeId: string, patch: Partial<WorkflowNodeData>) => void;
  removeNode: (nodeId: string) => void;
  duplicateNode: (nodeId: string) => void;
  selectNode: (nodeId: string | null) => void;
}

/** Reject connections that cannot produce a valid command. */
export function isValidConnection(
  connection: Connection | WorkflowEdge,
  nodes: WorkflowNode[],
): boolean {
  if (!connection.source || !connection.target) return false;
  // A block cannot feed itself.
  if (connection.source === connection.target) return false;

  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);

  if (!source || !target) return false;
  // A trigger roots a command; nothing may flow into it.
  if (target.type === "trigger") return false;
  // Only conditions expose branch handles; anything else uses the single output.
  if (source.type !== "condition") {
    const handle = connection.sourceHandle ?? HANDLE.OUTPUT;
    if (handle !== HANDLE.OUTPUT) return false;
  }

  return true;
}

const initialDocument = createEmptyDocument();

export const useWorkflow = create<WorkflowState>((set, get) => ({
  document: initialDocument,
  selectedNodeId: null,
  hydrated: false,
  loadError: null,

  hydrate: () => {
    if (get().hydrated) return;
    try {
      const saved = vault.loadWorkflow();
      if (saved) {
        set({ document: saved, hydrated: true, selectedNodeId: null });
        return;
      }
    } catch (error) {
      set({
        loadError: error instanceof Error ? error.message : "The saved workflow could not be read.",
      });
    }
    // First run — seed with a working example.
    const starter = createStarterWorkflow();
    vault.saveWorkflow(starter);
    set({ document: starter, hydrated: true, selectedNodeId: null });
  },

  reset: () => {
    const starter = createStarterWorkflow();
    vault.saveWorkflow(starter);
    set({ document: starter, selectedNodeId: null, loadError: null });
  },

  clearCanvas: () => {
    const current = get().document;
    const next: WorkflowDocument = { ...current, nodes: [], edges: [] };
    scheduleSave(next);
    set({ document: next, selectedNodeId: null });
  },

  setDocumentName: (name) => {
    const next = { ...get().document, name };
    scheduleSave(next);
    set({ document: next });
  },

  setDocumentDescription: (description) => {
    const next = { ...get().document, description };
    scheduleSave(next);
    set({ document: next });
  },

  onNodesChange: (changes) => {
    const current = get().document;
    const nodes = applyNodeChanges(changes, current.nodes);

    // Removing a node must also drop its edges, or the graph keeps dangling
    // connections that the compiler would report as errors.
    const removedIds = new Set(
      changes.filter((change) => change.type === "remove").map((change) => change.id),
    );

    const edges =
      removedIds.size > 0
        ? current.edges.filter(
            (edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target),
          )
        : current.edges;

    const next = { ...current, nodes, edges };
    scheduleSave(next);

    set({
      document: next,
      selectedNodeId:
        get().selectedNodeId && removedIds.has(get().selectedNodeId as string)
          ? null
          : get().selectedNodeId,
    });
  },

  onEdgesChange: (changes) => {
    const current = get().document;
    const edges = applyEdgeChanges(changes, current.edges);
    const next = { ...current, edges };
    scheduleSave(next);
    set({ document: next });
  },

  onConnect: (connection) => {
    const current = get().document;
    if (!isValidConnection(connection, current.nodes)) return;

    // A condition branch takes exactly one edge; a second would make the branch
    // ambiguous at compile time.
    const isBranch =
      connection.sourceHandle === HANDLE.TRUE || connection.sourceHandle === HANDLE.FALSE;

    const filtered = isBranch
      ? current.edges.filter(
          (edge) =>
            !(edge.source === connection.source && edge.sourceHandle === connection.sourceHandle),
        )
      : current.edges;

    // A non-branch output is also single-use, so replace rather than stack.
    const pruned =
      isBranch || !connection.source
        ? filtered
        : filtered.filter(
            (edge) =>
              !(
                edge.source === connection.source &&
                (edge.sourceHandle ?? HANDLE.OUTPUT) === HANDLE.OUTPUT
              ),
          );

    const edges = addEdge({ ...connection, id: createWorkflowId("e") }, pruned);
    const next = { ...current, edges };
    scheduleSave(next);
    set({ document: next });
  },

  addNode: (kind, position) => {
    const node = createNodeFromKind(kind, position);
    const current = get().document;
    const next = { ...current, nodes: [...current.nodes, node] };
    scheduleSave(next);
    set({ document: next, selectedNodeId: node.id });
    return node.id;
  },

  updateNodeData: (nodeId, patch) => {
    const current = get().document;
    const nodes = current.nodes.map((node) =>
      node.id === nodeId
        ? ({ ...node, data: { ...node.data, ...patch } } as WorkflowNode)
        : node,
    );
    const next = { ...current, nodes };
    scheduleSave(next);
    set({ document: next });
  },

  removeNode: (nodeId) => {
    const current = get().document;
    const next: WorkflowDocument = {
      ...current,
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      edges: current.edges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId,
      ),
    };
    scheduleSave(next);
    set({
      document: next,
      selectedNodeId: get().selectedNodeId === nodeId ? null : get().selectedNodeId,
    });
  },

  duplicateNode: (nodeId) => {
    const current = get().document;
    const source = current.nodes.find((node) => node.id === nodeId);
    if (!source) return;

    const copy = {
      ...structuredClone(source),
      id: createWorkflowId(source.type ?? "node"),
      position: { x: source.position.x + 48, y: source.position.y + 48 },
      selected: false,
    } as WorkflowNode;

    const next = { ...current, nodes: [...current.nodes, copy] };
    scheduleSave(next);
    set({ document: next, selectedNodeId: copy.id });
  },

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),
}));

/** The currently selected node, or `null`. */
export function useSelectedWorkflowNode(): WorkflowNode | null {
  return useWorkflow((state) => {
    if (!state.selectedNodeId) return null;
    return state.document.nodes.find((node) => node.id === state.selectedNodeId) ?? null;
  });
}
