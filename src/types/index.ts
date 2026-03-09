export type NodeType = "main" | "subtask" | "detour" | "concept" | "decision";

export type NodeStatus = "in_progress" | "parked" | "done" | "blocked";

export interface ContextNode {
  id: string;
  title: string;
  type: NodeType;
  status: NodeStatus;
  summary: string[];
  artifacts: string[];
  definitionOfDone?: string;
  parentId?: string | null;
  childrenIds?: string[];
}

export interface ContextTree {
  rootId: string | null;
  nodes: Record<string, ContextNode>;
  focusPath: string[];
}

export const INITIAL_CONTEXT_TREE: ContextTree = {
  rootId: null,
  nodes: {},
  focusPath: [],
};
