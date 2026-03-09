"use strict";

const fs = require("node:fs");
const path = require("node:path");

const NODE_TYPES = new Set(["main", "subtask", "detour", "concept", "decision"]);
const NODE_STATUSES = new Set(["in_progress", "parked", "done", "blocked"]);
const MAX_SUMMARY_ITEMS = 7;
const CONSOLIDATED_SUMMARY_TARGET = 3;
const PROGRESS_BAR_WIDTH = 10;
const DETOUR_HINT_LABEL = "B?";
const INJECTED_CONTEXT_COLLAPSE_THRESHOLD = 6;
const INJECTED_CONTEXT_SIBLING_LIMIT = 2;
const DEFAULT_STATE_FILE = "state.json";

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
const FILE_PATH_PATTERN =
  /(?:^|[\s(])((?:\.{0,2}\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9]+)(?=$|[\s),:;])/g;
const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const STOP_WORDS = new Set([
  "a","an","and","are","as","at","be","by","do","does","for","from","go","how","i","if","in","instead","into","is","it",
  "let","me","my","now","of","on","or","part","people","please","should","so","step","that","the","this","to","up","use",
  "wait","we","what","when","why","with","work"
]);

function createEmptyTree() {
  return { rootId: null, nodes: {}, focusPath: [], virtual: false };
}

function createVirtualInitialState() {
  return {
    rootId: null,
    nodes: {},
    focusPath: [],
    virtual: true,
  };
}

function cloneNode(node) {
  return {
    ...node,
    summary: [...(node.summary || [])],
    artifacts: [...(node.artifacts || [])],
    childrenIds: [...(node.childrenIds || [])],
  };
}

function cloneTree(tree) {
  return {
    rootId: tree.rootId,
    nodes: Object.fromEntries(Object.entries(tree.nodes).map(([id, node]) => [id, cloneNode(node)])),
    focusPath: [...tree.focusPath],
    virtual: Boolean(tree.virtual),
  };
}

function validateTree(tree) {
  if (!tree || typeof tree !== "object") {
    throw new Error("State tree is invalid.");
  }
  if (tree.rootId !== null && typeof tree.rootId !== "string") {
    throw new Error("rootId must be a string or null.");
  }
  if (!tree.nodes || typeof tree.nodes !== "object" || Array.isArray(tree.nodes)) {
    throw new Error("nodes must be an object.");
  }
  if (!Array.isArray(tree.focusPath)) {
    throw new Error("focusPath must be an array.");
  }
  for (const [nodeId, node] of Object.entries(tree.nodes)) {
    if (!node || typeof node !== "object") {
      throw new Error(`Node "${nodeId}" is invalid.`);
    }
    if (node.id !== nodeId) {
      throw new Error(`Node "${nodeId}" has a mismatched id.`);
    }
    if (!NODE_TYPES.has(node.type)) {
      throw new Error(`Node "${nodeId}" has an invalid type.`);
    }
    if (!NODE_STATUSES.has(node.status)) {
      throw new Error(`Node "${nodeId}" has an invalid status.`);
    }
    if (!Array.isArray(node.summary) || !Array.isArray(node.artifacts)) {
      throw new Error(`Node "${nodeId}" has invalid summary or artifacts.`);
    }
  }
  return tree;
}

function readContextTree(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = validateTree(JSON.parse(raw));
    parsed.virtual = false;
    return parsed;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return createVirtualInitialState();
    }
    throw error;
  }
}

function writeContextTree(tree, filePath) {
  const serializableTree = {
    rootId: tree.rootId,
    nodes: tree.nodes,
    focusPath: tree.focusPath,
  };
  validateTree(serializableTree);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(serializableTree, null, 2)}\n`, "utf8");
}

function getActiveNodeFromTree(tree) {
  const activeNodeId = tree.focusPath[tree.focusPath.length - 1] || tree.rootId;
  if (!activeNodeId) return null;
  return tree.nodes[activeNodeId] || null;
}

function extractConceptTokens(text) {
  const rawTokens = text.match(/[A-Za-z0-9]+/g) || [];
  const uniqueTokens = new Set();
  for (const rawToken of rawTokens) {
    const token = rawToken.toLowerCase();
    const isAcronym = /^[A-Z0-9]{2,}$/.test(rawToken);
    if (token.length < 4 && !isAcronym) continue;
    if (STOP_WORDS.has(token)) continue;
    uniqueTokens.add(isAcronym ? rawToken : token);
  }
  return [...uniqueTokens];
}

function buildFocusScope(tree) {
  const focusIds = tree.focusPath.length > 0 ? tree.focusPath : tree.rootId ? [tree.rootId] : [];
  return focusIds
    .map((nodeId) => tree.nodes[nodeId])
    .filter(Boolean)
    .flatMap((node) => [node.title, node.definitionOfDone || "", ...(node.summary || []), ...(node.artifacts || [])])
    .join(" ")
    .toLowerCase();
}

function classifyMessage(userMessage, currentTree) {
  const message = userMessage.trim();
  const activeNode = getActiveNodeFromTree(currentTree);
  const currentNodeId = activeNode ? activeNode.id : null;
  const currentNodeTitle = activeNode ? activeNode.title : null;
  const focusScope = buildFocusScope(currentTree);
  const detectedConcepts = extractConceptTokens(message);
  const relatedConcepts = detectedConcepts.filter((token) => focusScope.includes(token.toLowerCase()));
  const novelConcepts = detectedConcepts.filter((token) => !focusScope.includes(token.toLowerCase()));
  const hasQuestionMark = /[?？]/.test(message);
  const hasCompletionSignal = COMPLETION_PATTERNS.some((pattern) => pattern.test(message));
  const hasContextSwitchSignal = CONTEXT_SWITCH_PATTERNS.some((pattern) => pattern.test(message));
  const hasSubtaskSignal = SUBTASK_PATTERNS.some((pattern) => pattern.test(message));
  const hasDetourSignal = hasQuestionMark || DETOUR_PATTERNS.some((pattern) => pattern.test(message));
  const anchorsToCurrentWork =
    /\b(that|this|current)\b/i.test(message) ||
    /\bpart of\b/i.test(message) ||
    relatedConcepts.length > 0 ||
    (activeNode && activeNode.type === "main" && hasSubtaskSignal);

  if (hasCompletionSignal && currentTree.focusPath.length > 1) {
    return buildClassifierResult("COMPLETION", "high", "The message indicates the current branch is complete.", currentNodeId, currentNodeTitle, detectedConcepts, novelConcepts, relatedConcepts);
  }
  if (hasContextSwitchSignal) {
    return buildClassifierResult("CONTEXT_SWITCH", "high", "The message explicitly asks for a different goal.", currentNodeId, currentNodeTitle, detectedConcepts, novelConcepts, relatedConcepts);
  }
  if (hasDetourSignal && novelConcepts.length > 0 && !anchorsToCurrentWork) {
    return buildClassifierResult("DETOUR", "low", "The message asks about a new concept outside the current flow.", currentNodeId, currentNodeTitle, detectedConcepts, novelConcepts, relatedConcepts);
  }
  if (hasSubtaskSignal && (anchorsToCurrentWork || (activeNode && activeNode.type === "main"))) {
    return buildClassifierResult("SUBTASK", "high", "The message looks like a concrete next step.", currentNodeId, currentNodeTitle, detectedConcepts, novelConcepts, relatedConcepts);
  }
  return buildClassifierResult("ELABORATION", "high", "The message deepens the current branch.", currentNodeId, currentNodeTitle, detectedConcepts, novelConcepts, relatedConcepts);
}

function buildClassifierResult(category, confidence, reason, currentNodeId, currentNodeTitle, detectedConcepts, novelConcepts, relatedConcepts) {
  return { category, confidence, reason, currentNodeId, currentNodeTitle, detectedConcepts, novelConcepts, relatedConcepts };
}

function extractArtifacts(dialogue) {
  const artifacts = new Set();
  for (const match of dialogue.matchAll(FILE_PATH_PATTERN)) {
    if (match[1]) artifacts.add(match[1].trim());
  }
  for (const codeBlock of dialogue.match(CODE_BLOCK_PATTERN) || []) {
    const snippet = codeBlock
      .replace(/^```[a-zA-Z0-9_-]*\n?/, "")
      .replace(/```$/, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (snippet) artifacts.add(`codeblock:${snippet.slice(0, 80)}`);
  }
  return [...artifacts];
}

function stripArtifactsFromText(dialogue) {
  return dialogue
    .replace(CODE_BLOCK_PATTERN, " ")
    .replace(FILE_PATH_PATTERN, " the referenced file ")
    .replace(/`+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

function buildSummary(text) {
  const firstSentence = text
    .split(/(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .find(Boolean) || text;
  const words = firstSentence.match(/[A-Za-z0-9_.-]+/g) || [];
  if (words.length === 0) return "Captured implementation details.";
  const summary = words.slice(0, 15).join(" ").trim();
  return /[.!?]$/.test(summary) ? summary : `${summary}.`;
}

function summarizeDialogue(dialogue) {
  const normalized = dialogue.trim();
  if (!normalized) return { summary: "", artifacts: [] };
  return {
    summary: buildSummary(stripArtifactsFromText(normalized)),
    artifacts: extractArtifacts(normalized),
  };
}

function consolidateSummaries(bullets) {
  const normalized = bullets.map((bullet) => bullet.trim()).filter(Boolean);
  if (normalized.length <= CONSOLIDATED_SUMMARY_TARGET) {
    return [...new Set(normalized)];
  }
  const chunkSize = Math.ceil(normalized.length / CONSOLIDATED_SUMMARY_TARGET);
  const consolidated = new Set();
  for (let index = 0; index < normalized.length; index += chunkSize) {
    const chunk = normalized.slice(index, index + chunkSize);
    consolidated.add(buildSummary(chunk.join(" ")));
  }
  return [...consolidated].slice(0, CONSOLIDATED_SUMMARY_TARGET);
}

class ContextManager {
  constructor(stateFilePath) {
    this.stateFilePath = resolveStateFilePath(stateFilePath);
    this.tree = readContextTree(this.stateFilePath);
  }

  save() {
    writeContextTree(this.tree, this.stateFilePath);
  }

  getCurrentTree() {
    return cloneTree(this.tree);
  }

  initialize(options = {}) {
    if (this.tree.rootId && this.tree.nodes[this.tree.rootId]) {
      return this.getCurrentTree();
    }
    const rootNode = {
      id: "A",
      title: (options.title || "Main Goal").trim(),
      type: "main",
      status: "in_progress",
      summary: [],
      artifacts: [],
      definitionOfDone: (options.definitionOfDone || "Complete the current primary objective.").trim(),
      parentId: null,
      childrenIds: [],
    };
    this.tree = { rootId: "A", nodes: { A: rootNode }, focusPath: ["A"], virtual: false };
    this.save();
    return this.getCurrentTree();
  }

  getNodeOrThrow(nodeId) {
    const node = this.tree.nodes[nodeId];
    if (!node) throw new Error(`Node "${nodeId}" does not exist.`);
    return node;
  }

  buildPathToNode(nodeId) {
    const pathIds = [];
    const visited = new Set();
    let currentId = nodeId;
    while (currentId) {
      if (visited.has(currentId)) throw new Error(`Cycle detected for "${nodeId}".`);
      visited.add(currentId);
      const node = this.getNodeOrThrow(currentId);
      pathIds.push(currentId);
      currentId = node.parentId || null;
    }
    pathIds.reverse();
    return pathIds;
  }

  generateChildId(parentId) {
    const parent = this.getNodeOrThrow(parentId);
    const existingIds = new Set(Object.keys(this.tree.nodes));
    let index = (parent.childrenIds || []).length + 1;
    let candidate = `${parentId}.${index}`;
    while (existingIds.has(candidate)) {
      index += 1;
      candidate = `${parentId}.${index}`;
    }
    return candidate;
  }

  applyDialogueSummary(node, dialogue) {
    const result = summarizeDialogue(dialogue);
    if (result.summary && !node.summary.includes(result.summary)) {
      node.summary = [...node.summary, result.summary];
      if (node.summary.length > MAX_SUMMARY_ITEMS) {
        node.summary = consolidateSummaries(node.summary);
      }
    }
    if (result.artifacts.length > 0) {
      node.artifacts = [...new Set([...node.artifacts, ...result.artifacts])];
    }
  }

  addNode(parentId, nodeData) {
    const parent = this.getNodeOrThrow(parentId);
    const nodeId = this.generateChildId(parentId);
    const node = {
      id: nodeId,
      title: nodeData.title.trim(),
      type: nodeData.type,
      status: nodeData.status || "in_progress",
      summary: [...(nodeData.summary || [])],
      artifacts: [...(nodeData.artifacts || [])],
      definitionOfDone: nodeData.definitionOfDone,
      parentId,
      childrenIds: [],
    };
    this.tree.nodes[nodeId] = node;
    parent.childrenIds = [...(parent.childrenIds || []), nodeId];
    if (node.status === "in_progress") this.tree.focusPath = this.buildPathToNode(nodeId);
    const activeNode = getActiveNodeFromTree(this.tree);
    if (activeNode) {
      this.applyDialogueSummary(activeNode, node.summary.join(" ") || `Created ${node.type} node ${node.title} under ${parent.title}.`);
    }
    this.save();
    return cloneNode(node);
  }

  updateNodeStatus(nodeId, status) {
    const node = this.getNodeOrThrow(nodeId);
    const isFocused = this.tree.focusPath.includes(nodeId);
    node.status = status;
    if (status === "in_progress") {
      this.tree.focusPath = this.buildPathToNode(nodeId);
    } else if (isFocused) {
      const parentId = node.parentId || null;
      if (parentId) {
        this.tree.focusPath = this.buildPathToNode(parentId);
      } else if (status === "done") {
        this.tree.focusPath = [];
      }
    }
    const activeNode = getActiveNodeFromTree(this.tree);
    if (activeNode) {
      this.applyDialogueSummary(activeNode, activeNode.id === node.id ? `Updated ${node.title} status to ${status}.` : `Returned to ${activeNode.title} after marking ${node.title} as ${status}.`);
    }
    this.save();
    return cloneNode(node);
  }

  updateNodeSummary(nodeId, text) {
    const node = this.getNodeOrThrow(nodeId);
    this.applyDialogueSummary(node, text);
    this.save();
    return cloneNode(node);
  }

  mergeUp(nodeId) {
    const targetNodeId = nodeId || this.tree.focusPath[this.tree.focusPath.length - 1];
    const node = this.getNodeOrThrow(targetNodeId);
    const parent = this.getNodeOrThrow(node.parentId);
    parent.summary = consolidateSummaries([...parent.summary, ...node.summary]);
    parent.artifacts = [...new Set([...parent.artifacts, ...node.artifacts])];
    for (const childId of node.childrenIds || []) {
      const child = this.getNodeOrThrow(childId);
      child.parentId = parent.id;
      parent.childrenIds = [...(parent.childrenIds || []), childId];
    }
    parent.childrenIds = (parent.childrenIds || []).filter((childId) => childId !== node.id);
    delete this.tree.nodes[node.id];
    this.tree.focusPath = this.buildPathToNode(parent.id);
    this.applyDialogueSummary(parent, `Merged ${node.title} back into ${parent.title}.`);
    this.save();
    return this.getCurrentTree();
  }

  analyzeIntent(userMessage, currentTree) {
    const result = classifyMessage(userMessage, currentTree || this.tree);
    if (result.category === "COMPLETION" && result.currentNodeId && this.tree.focusPath.length > 1) {
      this.updateNodeStatus(result.currentNodeId, "done");
      const latestTree = this.getCurrentTree();
      const latestNode = getActiveNodeFromTree(latestTree);
      return this.buildIntentResult(result.category, result.confidence, result.reason, latestTree, latestNode ? latestNode.id : latestTree.rootId, latestNode ? latestNode.title : null, result.detectedConcepts, result.novelConcepts, result.relatedConcepts);
    }
    return this.buildIntentResult(result.category, result.confidence, result.reason, currentTree || this.tree, result.currentNodeId, result.currentNodeTitle, result.detectedConcepts, result.novelConcepts, result.relatedConcepts);
  }

  buildIntentResult(category, confidence, reason, currentTree, currentNodeId, currentNodeTitle, detectedConcepts, novelConcepts, relatedConcepts) {
    return {
      category,
      confidence,
      reason,
      suggestedBreadcrumb: this.buildBreadcrumb(currentTree, currentNodeId, currentNodeTitle, category === "DETOUR" && confidence === "low"),
      currentNodeId,
      currentNodeTitle,
      detectedConcepts,
      novelConcepts,
      relatedConcepts,
    };
  }

  buildBreadcrumb(tree, currentNodeId, currentNodeTitle, showTentativeDetour) {
    if (!tree.rootId) return showTentativeDetour ? `Focus: (${DETOUR_HINT_LABEL})` : "Focus: (empty)";
    const labels = tree.focusPath.length > 0 ? tree.focusPath : [tree.rootId];
    const parts = labels.map((nodeId) => {
      const node = tree.nodes[nodeId];
      if (!node) return nodeId;
      return node.id === currentNodeId && currentNodeTitle ? `${node.id} (${node.title})` : node.id;
    });
    if (showTentativeDetour) parts.push(`(${DETOUR_HINT_LABEL})`);
    return `Focus: ${parts.join(" > ")}`;
  }

  getTypeEmoji(type) {
    return { main: "🎯", subtask: "🖇️", detour: "🔀", concept: "💡", decision: "🧭" }[type] || "•";
  }

  getStatusEmoji(status) {
    return { done: "✅", in_progress: "⏳", parked: "🅿️", blocked: "⛔" }[status] || "•";
  }

  formatNodeLabel(node) {
    return `${this.getTypeEmoji(node.type)} ${this.getStatusEmoji(node.status)} ${node.id} ${node.title}`;
  }

  renderNodeTree(tree, nodeId, activeNodeId, prefix, isLast, isRoot) {
    const node = tree.nodes[nodeId];
    if (!node) return [];
    const connector = isRoot ? "" : isLast ? "└── " : "├── ";
    const linePrefix = isRoot ? "" : `${prefix}${connector}`;
    const lines = [`${linePrefix}${this.formatNodeLabel(node)}`];
    if (node.id === activeNodeId && node.summary.length > 0) {
      const bulletPrefix = isRoot ? "    " : `${prefix}${isLast ? "    " : "│   "}`;
      for (const bullet of node.summary) lines.push(`${bulletPrefix}• ${bullet}`);
    }
    const children = node.childrenIds || [];
    children.forEach((childId, index) => {
      const nextPrefix = isRoot ? "" : `${prefix}${isLast ? "    " : "│   "}`;
      lines.push(...this.renderNodeTree(tree, childId, activeNodeId, nextPrefix, index === children.length - 1, false));
    });
    return lines;
  }

  renderMarkdownTree(tree, activeNodeId) {
    if (!tree.rootId) return "_No active tree found._";
    return this.renderNodeTree(tree, tree.rootId, activeNodeId, "", true, true).join("\n");
  }

  buildProgressBar(tree) {
    const nodes = Object.values(tree.nodes);
    const total = nodes.length;
    const done = nodes.filter((node) => node.status === "done").length;
    if (total === 0) return "[----------] 0/0";
    const filled = Math.round((done / total) * PROGRESS_BAR_WIDTH);
    return `[${"#".repeat(filled)}${"-".repeat(PROGRESS_BAR_WIDTH - filled)}] ${done}/${total}`;
  }

  buildQuickActions(node) {
    const actions = ["[Done]", "[Park]"];
    if (node.parentId) actions.unshift("[Merge]");
    return actions;
  }

  buildSuggestedCommands(node, analysis) {
    const commands = new Set(["back", "done", "park"]);
    if (node.parentId) commands.add("merge");
    if (analysis && analysis.category === "CONTEXT_SWITCH") commands.add("move_to <nodeId>");
    commands.add("rename_node <new_title>");
    return [...commands];
  }

  buildNextStep(tree, currentNode, analysis) {
    if (analysis && analysis.category === "COMPLETION" && currentNode.parentId) {
      const parent = tree.nodes[currentNode.parentId];
      return parent ? `Return to ${parent.id} (${parent.title}).` : "Return to the parent branch.";
    }
    if (analysis && analysis.category === "DETOUR" && analysis.confidence === "low") {
      return `Confirm whether "${analysis.novelConcepts[0] || "the new topic"}" should become a detour, then return to ${currentNode.id}.`;
    }
    if (currentNode.summary.length > 0) return currentNode.summary[currentNode.summary.length - 1];
    return currentNode.definitionOfDone || `Continue work on ${currentNode.id} (${currentNode.title}).`;
  }

  buildUserActionFooter(node, analysis) {
    const commands = this.buildSuggestedCommands(node, analysis).map((command) => `'${command}'`).join(", ");
    if (!analysis || analysis.confidence !== "low") return `Commands: ${commands}`;
    if (analysis.category === "DETOUR") return `User Action Required: I've placed this in a detour. Type 'merge' if you'd rather keep this in the main flow.\nCommands: ${commands}`;
    return `User Action Required: Review the current classification for ${node.title}.\nCommands: ${commands}`;
  }

  renderContextUI(userMessage, precomputedAnalysis) {
    const currentTree = this.getCurrentTree();
    const currentNode = getActiveNodeFromTree(currentTree);
    if (!currentTree.rootId || !currentNode) {
      return {
        breadcrumb: "Focus: (empty)",
        nextStep: currentTree.virtual
          ? "Virtual Initial State: start a new tree from the user's first real request."
          : "Initialize the context tree.",
        tree: currentTree.virtual
          ? "_Virtual Initial State: no `state.json` found in the current project root._"
          : "_No active tree found._",
        progressBar: "[----------] 0/0",
        quickActions: [],
        suggestedCommands: ["init"],
        footer: currentTree.virtual
          ? "Cold Start: `state.json` is missing. The first real request should initialize the tree automatically."
          : undefined,
        analysis: userMessage ? this.analyzeIntent(userMessage, currentTree) : undefined,
      };
    }
    const analysis = precomputedAnalysis || (userMessage ? this.analyzeIntent(userMessage, currentTree) : undefined);
    const latestTree = analysis && analysis.category === "COMPLETION" ? this.getCurrentTree() : currentTree;
    const latestNode = getActiveNodeFromTree(latestTree) || currentNode;
    return {
      breadcrumb: analysis && analysis.category === "DETOUR" && analysis.confidence === "low"
        ? analysis.suggestedBreadcrumb
        : this.buildBreadcrumb(latestTree, latestNode.id, latestNode.title, false),
      nextStep: this.buildNextStep(latestTree, latestNode, analysis),
      tree: this.renderMarkdownTree(latestTree, latestNode.id),
      progressBar: this.buildProgressBar(latestTree),
      analysis,
      quickActions: this.buildQuickActions(latestNode),
      suggestedCommands: this.buildSuggestedCommands(latestNode, analysis),
      footer: this.buildUserActionFooter(latestNode, analysis),
    };
  }
}

function resolveStateFilePath(explicitPath) {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  const discoveredStatePath = findNearestStateFile(process.cwd());
  if (discoveredStatePath) {
    return discoveredStatePath;
  }

  return path.resolve(process.cwd(), DEFAULT_STATE_FILE);
}

function findNearestStateFile(startDirectory) {
  let currentDirectory = path.resolve(startDirectory);

  while (true) {
    const candidatePath = path.join(currentDirectory, DEFAULT_STATE_FILE);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return null;
    }

    currentDirectory = parentDirectory;
  }
}

module.exports = {
  ContextManager,
  classifyMessage,
  summarizeDialogue,
  consolidateSummaries,
  readContextTree,
  writeContextTree,
  resolveStateFilePath,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args.find((arg) =>
    ["--view", "--context", "/context", "/contextflow", "--done", "/done"].includes(arg),
  ) || "--view";
  const explicitPath = args.find((arg) => !arg.startsWith("--") && !arg.startsWith("/"));
  const stateFilePath = resolveStateFilePath(explicitPath);
  const manager = new ContextManager(stateFilePath);

  if (command === "--done" || command === "/done") {
    const currentTree = manager.getCurrentTree();
    const activeNodeId =
      currentTree.focusPath[currentTree.focusPath.length - 1] || currentTree.rootId;

    if (activeNodeId) {
      manager.updateNodeStatus(activeNodeId, "done");
    }
  }

  const ui = manager.renderContextUI();
  console.log("# Context Tree\n");
  console.log(ui.progressBar);
  console.log("");
  console.log(ui.tree);
  console.log("\n## Breadcrumb\n");
  console.log(ui.breadcrumb);
  console.log(`Next: ${ui.nextStep}`);
  console.log("\n## Quick Actions\n");
  console.log(ui.quickActions.join(" "));
  console.log("\n## Suggested Commands\n");
  console.log(ui.suggestedCommands.map((command) => `- ${command}`).join("\n"));
  if (ui.footer) {
    console.log("\n## Footer\n");
    console.log(ui.footer);
  }
}
