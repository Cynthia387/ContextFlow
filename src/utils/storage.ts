import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  type ContextNode,
  type ContextTree,
  INITIAL_CONTEXT_TREE,
} from "../types/index.ts";

const NODE_TYPES = ["main", "subtask", "detour", "concept", "decision"] as const;
const NODE_STATUSES = ["in_progress", "parked", "done", "blocked"] as const;

export const DEFAULT_STATE_FILE_PATH = path.resolve(process.cwd(), "state.json");

function createEmptyTree(): ContextTree {
  return {
    rootId: INITIAL_CONTEXT_TREE.rootId,
    nodes: {},
    focusPath: [...INITIAL_CONTEXT_TREE.focusPath],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isValidNodeType(value: unknown): boolean {
  return typeof value === "string" && NODE_TYPES.includes(value as (typeof NODE_TYPES)[number]);
}

function isValidNodeStatus(value: unknown): boolean {
  return (
    typeof value === "string" &&
    NODE_STATUSES.includes(value as (typeof NODE_STATUSES)[number])
  );
}

function validateNode(nodeId: string, value: unknown): ContextNode {
  if (!isObject(value)) {
    throw new Error(`State file is malformed: node "${nodeId}" is not an object.`);
  }

  const {
    id,
    title,
    type,
    status,
    summary,
    artifacts,
    definitionOfDone,
    parentId,
    childrenIds,
  } = value;

  if (id !== nodeId || typeof id !== "string") {
    throw new Error(`State file is malformed: node "${nodeId}" has an invalid id.`);
  }

  if (typeof title !== "string" || title.trim().length === 0) {
    throw new Error(`State file is malformed: node "${nodeId}" has an invalid title.`);
  }

  if (!isValidNodeType(type)) {
    throw new Error(`State file is malformed: node "${nodeId}" has an invalid type.`);
  }

  if (!isValidNodeStatus(status)) {
    throw new Error(`State file is malformed: node "${nodeId}" has an invalid status.`);
  }

  if (!isStringArray(summary)) {
    throw new Error(`State file is malformed: node "${nodeId}" has an invalid summary.`);
  }

  if (!isStringArray(artifacts)) {
    throw new Error(`State file is malformed: node "${nodeId}" has invalid artifacts.`);
  }

  if (
    definitionOfDone !== undefined &&
    typeof definitionOfDone !== "string"
  ) {
    throw new Error(
      `State file is malformed: node "${nodeId}" has an invalid definitionOfDone.`,
    );
  }

  if (
    parentId !== undefined &&
    parentId !== null &&
    typeof parentId !== "string"
  ) {
    throw new Error(`State file is malformed: node "${nodeId}" has an invalid parentId.`);
  }

  if (childrenIds !== undefined && !isStringArray(childrenIds)) {
    throw new Error(`State file is malformed: node "${nodeId}" has invalid childrenIds.`);
  }

  return {
    id,
    title,
    type,
    status,
    summary: [...summary],
    artifacts: [...artifacts],
    definitionOfDone,
    parentId: parentId ?? null,
    childrenIds: childrenIds ? [...childrenIds] : [],
  };
}

function validateTree(value: unknown): ContextTree {
  if (!isObject(value)) {
    throw new Error("State file is malformed: tree root is not an object.");
  }

  const { rootId, nodes, focusPath } = value;

  if (rootId !== null && typeof rootId !== "string") {
    throw new Error("State file is malformed: rootId must be a string or null.");
  }

  if (!isObject(nodes)) {
    throw new Error("State file is malformed: nodes must be an object.");
  }

  if (!isStringArray(focusPath)) {
    throw new Error("State file is malformed: focusPath must be a string array.");
  }

  const validatedNodes: Record<string, ContextNode> = {};

  for (const [nodeId, nodeValue] of Object.entries(nodes)) {
    validatedNodes[nodeId] = validateNode(nodeId, nodeValue);
  }

  if (rootId !== null && !(rootId in validatedNodes)) {
    throw new Error("State file is malformed: rootId does not exist in nodes.");
  }

  for (const focusNodeId of focusPath) {
    if (!(focusNodeId in validatedNodes)) {
      throw new Error(
        `State file is malformed: focus path contains unknown node "${focusNodeId}".`,
      );
    }
  }

  return {
    rootId,
    nodes: validatedNodes,
    focusPath: [...focusPath],
  };
}

export async function readContextTree(
  filePath: string = DEFAULT_STATE_FILE_PATH,
): Promise<ContextTree> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return validateTree(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createEmptyTree();
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse state file "${filePath}": invalid JSON.`);
    }

    throw error;
  }
}

export async function writeContextTree(
  tree: ContextTree,
  filePath: string = DEFAULT_STATE_FILE_PATH,
): Promise<void> {
  const validatedTree = validateTree(tree);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(validatedTree, null, 2)}\n`, "utf8");
}
