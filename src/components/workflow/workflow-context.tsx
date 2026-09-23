"use client";

import * as React from "react";
import type { ValidationIssue } from "@/types/workflow";

/**
 * Validation results are computed once per graph change by the canvas and shared
 * through context, rather than being written into node data. Writing them into
 * `node.data` would mutate the document on every keystroke and fight the
 * persistence layer.
 */

type IssuesContextValue = {
  byNode: Map<string, ValidationIssue[]>;
  documentIssues: ValidationIssue[];
};

const IssuesContext = React.createContext<IssuesContextValue>({
  byNode: new Map(),
  documentIssues: [],
});

export function WorkflowIssuesProvider({
  byNode,
  documentIssues,
  children,
}: IssuesContextValue & { children: React.ReactNode }) {
  const value = React.useMemo(
    () => ({ byNode, documentIssues }),
    [byNode, documentIssues],
  );

  return <IssuesContext.Provider value={value}>{children}</IssuesContext.Provider>;
}

/** All issues for one node. */
export function useNodeIssues(nodeId: string): ValidationIssue[] {
  const { byNode } = React.useContext(IssuesContext);
  return byNode.get(nodeId) ?? EMPTY;
}

/** Issues that are not attached to any single node (graph-level). */
export function useDocumentIssues(): ValidationIssue[] {
  return React.useContext(IssuesContext).documentIssues;
}

// Stable reference so the hook does not cause needless re-renders when empty.
const EMPTY: ValidationIssue[] = [];
