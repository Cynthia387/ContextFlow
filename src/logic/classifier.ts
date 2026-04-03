import type { ContextNode, ContextTree } from "../types/index.ts";

export type ClassifierCategory =
  | "ELABORATION"
  | "SUBTASK"
  | "DETOUR"
  | "CONTEXT_SWITCH"
  | "COMPLETION";

export interface ClassifierResult {
  category: ClassifierCategory;
  confidence: "high" | "low";
  reason: string;
  currentNodeId: string | null;
  currentNodeTitle: string | null;
  detectedConcepts: string[];
  novelConcepts: string[];
  relatedConcepts: string[];
}

const SHORT_MESSAGE_WORD_THRESHOLD = 10;
const COMPLETION_PATTERNS = [
  /\b(done|finished|resolved|complete|completed)\b/i,
  /\bgot it\b/i,
  /\bthat helps\b/i,
  /\bback to\b/i,
  /\breturn to\b/i,
  /\bresume\b/i,
];
const CONTEXT_SWITCH_PATTERNS = [
  /\bunrelated\b/i,
  /\bnew goal\b/i,
  /\bdifferent task\b/i,
  /\banother project\b/i,
  /\bswitch to\b/i,
  /\bseparate issue\b/i,
];
const SUBTASK_PATTERNS = [
  /\bnext\b/i,
  /\bthen\b/i,
  /\bstep\s*\d+\b/i,
  /\bstep\s+(one|two|three|four|five)\b/i,
  /\bpart of\b/i,
  /\bimplement\b/i,
  /\bbuild\b/i,
  /\bcreate\b/i,
  /\badd\b/i,
  /\bfix\b/i,
  /\bupdate\b/i,
  /\brefactor\b/i,
  /\bcontinue\b/i,
  /\bexplain\b/i,
];
const DETOUR_PATTERNS = [/\bhow\b/i, /\bwhat is\b/i, /\bwhy\b/i];
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "do",
  "does",
  "for",
  "from",
  "go",
  "how",
  "i",
  "if",
  "in",
  "into",
  "instead",
  "is",
  "it",
  "let",
  "me",
  "my",
  "now",
  "of",
  "on",
  "or",
  "part",
  "people",
  "please",
  "should",
  "so",
  "step",
  "that",
  "the",
  "this",
  "to",
  "up",
  "use",
  "wait",
  "we",
  "what",
  "when",
  "why",
  "with",
  "work",
]);

export function classifyMessage(
  userMessage: string,
  currentTree: ContextTree,
): ClassifierResult {
  const message = userMessage.trim();
  const activeNode = getActiveNodeFromTree(currentTree);
  const currentNodeId = activeNode?.id ?? null;
  const currentNodeTitle = activeNode?.title ?? null;
  const focusScope = buildFocusScope(currentTree);
  const detectedConcepts = extractConceptTokens(message);
  const relatedConcepts = detectedConcepts.filter((token) =>
    focusScope.includes(token.toLowerCase()),
  );
  const novelConcepts = detectedConcepts.filter(
    (token) => !focusScope.includes(token.toLowerCase()),
  );
  const wordCount = countWords(message);
  const hasQuestionMark = /[?？]/.test(message);
  const hasCompletionSignal = COMPLETION_PATTERNS.some((pattern) => pattern.test(message));
  const hasContextSwitchSignal = CONTEXT_SWITCH_PATTERNS.some((pattern) =>
    pattern.test(message),
  );
  const hasSubtaskSignal = SUBTASK_PATTERNS.some((pattern) => pattern.test(message));
  const hasDetourSignal =
    hasQuestionMark || DETOUR_PATTERNS.some((pattern) => pattern.test(message));
  const anchorsToCurrentWork =
    /\b(that|this|current)\b/i.test(message) ||
    /\bpart of\b/i.test(message) ||
    relatedConcepts.length > 0 ||
    (activeNode?.type === "main" && hasSubtaskSignal);

  if (hasCompletionSignal && currentTree.focusPath.length > 1) {
    return buildResult(
      "COMPLETION",
      "high",
      "The message indicates the current branch is understood or complete and should be popped.",
      currentNodeId,
      currentNodeTitle,
      detectedConcepts,
      novelConcepts,
      relatedConcepts,
    );
  }

  if (hasContextSwitchSignal) {
    return buildResult(
      "CONTEXT_SWITCH",
      "high",
      "The message explicitly requests a different goal or unrelated branch.",
      currentNodeId,
      currentNodeTitle,
      detectedConcepts,
      novelConcepts,
      relatedConcepts,
    );
  }

  if (hasDetourSignal && novelConcepts.length > 0 && !anchorsToCurrentWork) {
    return buildResult(
      "DETOUR",
      "low",
      "The message asks about a new concept that is not anchored to the current task flow.",
      currentNodeId,
      currentNodeTitle,
      detectedConcepts,
      novelConcepts,
      relatedConcepts,
    );
  }

  if (hasSubtaskSignal && (anchorsToCurrentWork || activeNode?.type === "main")) {
    return buildResult(
      "SUBTASK",
      "high",
      "The message looks like a concrete next step within the current goal.",
      currentNodeId,
      currentNodeTitle,
      detectedConcepts,
      novelConcepts,
      relatedConcepts,
    );
  }

  if (hasDetourSignal && novelConcepts.length > 0) {
    return buildResult(
      "DETOUR",
      "low",
      "The message leans toward a side exploration because it introduces a new concept.",
      currentNodeId,
      currentNodeTitle,
      detectedConcepts,
      novelConcepts,
      relatedConcepts,
    );
  }

  if (wordCount > 0 && wordCount < SHORT_MESSAGE_WORD_THRESHOLD && !hasQuestionMark) {
    return buildResult(
      "ELABORATION",
      "high",
      "A short non-question message usually deepens the current branch without creating a new node.",
      currentNodeId,
      currentNodeTitle,
      detectedConcepts,
      novelConcepts,
      relatedConcepts,
    );
  }

  if (novelConcepts.length >= 3 && relatedConcepts.length === 0) {
    return buildResult(
      "CONTEXT_SWITCH",
      "low",
      "The message introduces several unrelated concepts and may represent a new root objective.",
      currentNodeId,
      currentNodeTitle,
      detectedConcepts,
      novelConcepts,
      relatedConcepts,
    );
  }

  return buildResult(
    "ELABORATION",
    "high",
    "The message deepens the current branch by default.",
    currentNodeId,
    currentNodeTitle,
    detectedConcepts,
    novelConcepts,
    relatedConcepts,
  );
}

function buildResult(
  category: ClassifierCategory,
  confidence: "high" | "low",
  reason: string,
  currentNodeId: string | null,
  currentNodeTitle: string | null,
  detectedConcepts: string[],
  novelConcepts: string[],
  relatedConcepts: string[],
): ClassifierResult {
  return {
    category,
    confidence,
    reason,
    currentNodeId,
    currentNodeTitle,
    detectedConcepts,
    novelConcepts,
    relatedConcepts,
  };
}

function getActiveNodeFromTree(tree: ContextTree): ContextNode | null {
  const activeNodeId = tree.focusPath.at(-1) ?? tree.rootId;
  if (!activeNodeId) {
    return null;
  }

  return tree.nodes[activeNodeId] ?? null;
}

function buildFocusScope(tree: ContextTree): string {
  const focusIds = tree.focusPath.length > 0 ? tree.focusPath : tree.rootId ? [tree.rootId] : [];

  return focusIds
    .map((nodeId) => tree.nodes[nodeId])
    .filter((node): node is ContextNode => Boolean(node))
    .flatMap((node) => [
      node.title,
      node.definitionOfDone ?? "",
      ...node.summary,
      ...node.artifacts,
    ])
    .join(" ")
    .toLowerCase();
}

function extractConceptTokens(text: string): string[] {
  const uniqueTokens = new Set<string>();
  const rawTokens = text.match(/[A-Za-z0-9]+/g) ?? [];

  for (const rawToken of rawTokens) {
    const token = rawToken.toLowerCase();
    const isAcronym = /^[A-Z0-9]{2,}$/.test(rawToken);

    if (token.length < 4 && !isAcronym) {
      continue;
    }

    if (STOP_WORDS.has(token)) {
      continue;
    }

    uniqueTokens.add(isAcronym ? rawToken : token);
  }

  return [...uniqueTokens];
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }

  return trimmed.split(/\s+/).length;
}
