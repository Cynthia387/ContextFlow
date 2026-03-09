import {
  type ContextNode,
  type ContextTree,
  INITIAL_CONTEXT_TREE,
  type NodeStatus,
  type NodeType,
} from "../types/index.ts";
import {
  classifyMessage,
  type ClassifierCategory,
} from "../services/classifier.ts";
import {
  DEFAULT_STATE_FILE_PATH,
  readContextTree,
  writeContextTree,
} from "../utils/storage.ts";
import {
  consolidateSummaries,
  summarizeDialogue,
} from "../services/summarizer.ts";

export interface AddNodeInput {
  title: string;
  type: NodeType;
  summary?: string[];
  artifacts?: string[];
  definitionOfDone?: string;
  status?: NodeStatus;
}

export type IntentCategory = ClassifierCategory;

export interface IntentAnalysisResult {
  category: IntentCategory;
  confidence: "high" | "low";
  reason: string;
  suggestedBreadcrumb: string;
  currentNodeId: string | null;
  currentNodeTitle: string | null;
  detectedConcepts: string[];
  novelConcepts: string[];
  relatedConcepts: string[];
}

export interface RenderContextUIResult {
  breadcrumb: string;
  nextStep: string;
  tree: string;
  progressBar: string;
  analysis?: IntentAnalysisResult;
  quickActions: string[];
  suggestedCommands: string[];
  footer?: string;
}

export interface InitializeOptions {
  title?: string;
  definitionOfDone?: string;
}

const DETOUR_HINT_LABEL = "B?";
const MAX_SUMMARY_ITEMS = 7;
const INJECTED_CONTEXT_COLLAPSE_THRESHOLD = 6;
const INJECTED_CONTEXT_SIBLING_LIMIT = 2;
const PROGRESS_BAR_WIDTH = 10;

function createEmptyTree(): ContextTree {
  return {
    rootId: INITIAL_CONTEXT_TREE.rootId,
    nodes: {},
    focusPath: [...INITIAL_CONTEXT_TREE.focusPath],
  };
}

export class ContextManager {
  private tree: ContextTree = createEmptyTree();
  private isLoaded = false;
  private readonly stateFilePath: string;

  constructor(stateFilePath: string = DEFAULT_STATE_FILE_PATH) {
    this.stateFilePath = stateFilePath;
  }

  public async initialize(options: InitializeOptions = {}): Promise<ContextTree> {
    await this.ensureLoaded();

    if (this.tree.rootId && this.tree.nodes[this.tree.rootId]) {
      return this.getTree();
    }

    const rootTitle = options.title?.trim() || "Main Goal";
    const rootDefinitionOfDone =
      options.definitionOfDone?.trim() || "Complete the current primary objective.";

    const rootNode: ContextNode = {
      id: "A",
      title: rootTitle,
      type: "main",
      status: "in_progress",
      summary: [],
      artifacts: [],
      definitionOfDone: rootDefinitionOfDone,
      parentId: null,
      childrenIds: [],
    };

    this.tree = {
      rootId: rootNode.id,
      nodes: {
        [rootNode.id]: rootNode,
      },
      focusPath: [rootNode.id],
    };

    await this.persist();

    return this.getTree();
  }

  public async addNode(parentId: string, nodeData: AddNodeInput): Promise<ContextNode> {
    await this.ensureLoaded();

    if (!this.tree.rootId) {
      throw new Error("Context tree has not been initialized.");
    }

    const parent = this.getNodeOrThrow(parentId);

    if (parent.status === "done") {
      throw new Error(`Cannot add a child to completed node "${parentId}".`);
    }

    const title = nodeData.title.trim();
    if (title.length === 0) {
      throw new Error("Node title cannot be empty.");
    }

    const nodeId = this.generateChildId(parentId);
    const newNode: ContextNode = {
      id: nodeId,
      title,
      type: nodeData.type,
      status: nodeData.status ?? "in_progress",
      summary: [...(nodeData.summary ?? [])],
      artifacts: [...(nodeData.artifacts ?? [])],
      definitionOfDone: nodeData.definitionOfDone,
      parentId,
      childrenIds: [],
    };

    this.tree.nodes[nodeId] = newNode;
    parent.childrenIds = [...(parent.childrenIds ?? []), nodeId];

    if (parent.status === "parked" || parent.status === "blocked") {
      parent.status = "in_progress";
    }

    if (newNode.status === "in_progress") {
      this.tree.focusPath = this.buildPathToNode(nodeId);
    }

    const activeNode = this.getActiveNodeFromTree(this.tree);
    if (activeNode) {
      const fallbackDialogue = `Created ${newNode.type} node ${newNode.title} under ${parent.title}.`;
      this.applyDialogueSummary(activeNode, nodeData.summary?.join(" ") || fallbackDialogue);
    }

    await this.persist();

    return this.cloneNode(newNode);
  }

  public async switchFocus(nodeId: string): Promise<ContextTree> {
    await this.ensureLoaded();

    const targetNode = this.getNodeOrThrow(nodeId);

    if (targetNode.status === "done") {
      throw new Error(`Cannot switch focus to completed node "${nodeId}".`);
    }

    const focusPath = this.buildPathToNode(nodeId);

    for (const focusNodeId of focusPath) {
      const node = this.getNodeOrThrow(focusNodeId);
      if (node.status === "done") {
        throw new Error(
          `Cannot build a valid focus path because ancestor "${focusNodeId}" is completed.`,
        );
      }
      if (node.status === "parked" || node.status === "blocked") {
        node.status = "in_progress";
      }
    }

    this.tree.focusPath = focusPath;
    this.applyDialogueSummary(
      targetNode,
      `Switched focus to ${targetNode.title}.`,
    );
    await this.persist();

    return this.getTree();
  }

  public async updateNodeStatus(
    nodeId: string,
    status: NodeStatus,
  ): Promise<ContextNode> {
    await this.ensureLoaded();

    const node = this.getNodeOrThrow(nodeId);
    const isInFocusPath = this.tree.focusPath.includes(nodeId);

    node.status = status;

    if (status === "in_progress") {
      this.tree.focusPath = this.buildPathToNode(nodeId);
    } else if (isInFocusPath) {
      const parentId = node.parentId ?? null;

      if (parentId) {
        const parentPath = this.buildPathToNode(parentId);
        const parentNode = this.getNodeOrThrow(parentId);

        if (parentNode.status === "parked" || parentNode.status === "blocked") {
          parentNode.status = "in_progress";
        }

        this.tree.focusPath = parentPath;
      } else if (status === "done") {
        this.tree.focusPath = [];
      } else {
        this.tree.focusPath = this.tree.rootId ? [this.tree.rootId] : [];
      }
    }

    const activeNode = this.getActiveNodeFromTree(this.tree);
    if (activeNode) {
      const fallbackDialogue =
        activeNode.id === node.id
          ? `Updated ${node.title} status to ${status}.`
          : `Returned to ${activeNode.title} after marking ${node.title} as ${status}.`;
      this.applyDialogueSummary(activeNode, fallbackDialogue);
    }

    await this.persist();

    return this.cloneNode(node);
  }

  public getCurrentTree(): ContextTree {
    return this.getTree();
  }

  public async updateNodeSummary(nodeId: string, text: string): Promise<ContextNode> {
    await this.ensureLoaded();

    const node = this.getNodeOrThrow(nodeId);
    if (!text.trim()) {
      throw new Error("Summary text cannot be empty.");
    }

    this.applyDialogueSummary(node, text);

    await this.persist();

    return this.cloneNode(node);
  }

  public async consolidateSummary(nodeId: string): Promise<ContextNode> {
    await this.ensureLoaded();

    const node = this.getNodeOrThrow(nodeId);
    this.consolidateNodeSummary(node, true);

    await this.persist();

    return this.cloneNode(node);
  }

  public async mergeUp(nodeId?: string): Promise<ContextTree> {
    await this.ensureLoaded();

    const targetNodeId = nodeId ?? this.tree.focusPath.at(-1);
    if (!targetNodeId) {
      throw new Error("No active node is available to merge.");
    }

    const node = this.getNodeOrThrow(targetNodeId);
    const parentId = node.parentId ?? null;
    if (!parentId) {
      throw new Error(`Node "${targetNodeId}" has no parent to merge into.`);
    }

    const parent = this.getNodeOrThrow(parentId);
    parent.summary = consolidateSummaries([...parent.summary, ...node.summary]);
    parent.artifacts = [...new Set([...parent.artifacts, ...node.artifacts])];

    for (const childId of node.childrenIds ?? []) {
      const childNode = this.getNodeOrThrow(childId);
      childNode.parentId = parent.id;
      parent.childrenIds = [...(parent.childrenIds ?? []), childId];
    }

    parent.childrenIds = (parent.childrenIds ?? []).filter((childId) => childId !== node.id);
    this.deleteNode(node.id);
    this.tree.focusPath = this.buildPathToNode(parent.id);
    this.applyDialogueSummary(parent, `Merged ${node.title} back into ${parent.title}.`);

    await this.persist();

    return this.getTree();
  }

  public async moveTo(nodeId: string, targetParentId: string): Promise<ContextTree> {
    await this.ensureLoaded();

    const node = this.getNodeOrThrow(nodeId);
    const newParent = this.getNodeOrThrow(targetParentId);

    if (node.id === newParent.id) {
      throw new Error("A node cannot be moved under itself.");
    }

    if (this.isDescendantOf(targetParentId, node.id)) {
      throw new Error(`Cannot move node "${nodeId}" under its own descendant "${targetParentId}".`);
    }

    const oldParentId = node.parentId ?? null;
    if (oldParentId) {
      const oldParent = this.getNodeOrThrow(oldParentId);
      oldParent.childrenIds = (oldParent.childrenIds ?? []).filter((childId) => childId !== node.id);
    }

    node.parentId = newParent.id;
    newParent.childrenIds = [...(newParent.childrenIds ?? []), node.id];
    this.tree.focusPath = this.buildPathToNode(node.id);
    this.applyDialogueSummary(node, `Moved ${node.title} under ${newParent.title}.`);

    await this.persist();

    return this.getTree();
  }

  public async renameNode(nodeId: string, newTitle: string): Promise<ContextNode> {
    await this.ensureLoaded();

    const node = this.getNodeOrThrow(nodeId);
    const title = newTitle.trim();
    if (!title) {
      throw new Error("New node title cannot be empty.");
    }

    node.title = title;
    this.applyDialogueSummary(node, `Renamed node to ${title}.`);

    await this.persist();

    return this.cloneNode(node);
  }

  public async analyzeIntent(
    userMessage: string,
    currentTree: ContextTree,
  ): Promise<IntentAnalysisResult> {
    await this.ensureLoaded();

    const result = classifyMessage(userMessage, currentTree);

    if (
      result.category === "COMPLETION" &&
      result.currentNodeId &&
      currentTree.focusPath.length > 1
    ) {
      await this.updateNodeStatus(result.currentNodeId, "done");
      const latestTree = this.getTree();
      const latestNode = this.getActiveNodeFromTree(latestTree);

      return this.buildIntentResult(
        result.category,
        result.confidence,
        result.reason,
        latestTree,
        latestNode?.id ?? latestTree.rootId,
        latestNode?.title ?? null,
        result.detectedConcepts,
        result.novelConcepts,
        result.relatedConcepts,
      );
    }

    return this.buildIntentResult(
      result.category,
      result.confidence,
      result.reason,
      currentTree,
      result.currentNodeId,
      result.currentNodeTitle,
      result.detectedConcepts,
      result.novelConcepts,
      result.relatedConcepts,
    );
  }

  public async renderContextUI(
    userMessage?: string,
    precomputedAnalysis?: IntentAnalysisResult,
  ): Promise<RenderContextUIResult> {
    await this.ensureLoaded();

    const currentTree = this.getTree();
    const currentNode = this.getActiveNodeFromTree(currentTree);

    if (!currentTree.rootId || !currentNode) {
      const emptyBreadcrumb = "Focus: (empty)";
      return {
        breadcrumb: emptyBreadcrumb,
        nextStep: "Initialize the context tree.",
        tree: "_No active tree found._",
        progressBar: "[----------] 0/0",
        quickActions: [],
        suggestedCommands: ["init"],
        analysis:
          precomputedAnalysis ??
          (userMessage ? await this.analyzeIntent(userMessage, currentTree) : undefined),
      };
    }

    const analysis =
      precomputedAnalysis ??
      (userMessage ? await this.analyzeIntent(userMessage, currentTree) : undefined);

    const latestTree =
      analysis?.category === "COMPLETION" ? this.getTree() : currentTree;
    const latestNode = this.getActiveNodeFromTree(latestTree) ?? currentNode;

    const breadcrumb =
      analysis?.category === "DETOUR" && analysis.confidence === "low"
        ? analysis.suggestedBreadcrumb
        : this.buildBreadcrumb(
            latestTree,
            latestNode.id,
            latestNode.title,
            false,
          );

    return {
      breadcrumb,
      nextStep: this.buildNextStep(latestTree, latestNode, analysis),
      tree: this.renderMarkdownTree(latestTree, latestNode.id),
      progressBar: this.buildProgressBar(latestTree),
      analysis,
      quickActions: this.buildQuickActions(latestNode),
      suggestedCommands: this.buildSuggestedCommands(latestNode, analysis),
      footer: this.buildUserActionFooter(latestNode, analysis),
    };
  }

  public async getInjectedContext(): Promise<string> {
    await this.ensureLoaded();

    const tree = this.getTree();
    if (!tree.rootId) {
      return "System Context:\nCurrent Focus: (empty).\nSummary so far: No active tree.";
    }

    const focusPath = tree.focusPath.length > 0 ? tree.focusPath : [tree.rootId];
    const pathNodes = focusPath
      .map((nodeId) => tree.nodes[nodeId])
      .filter((node): node is ContextNode => Boolean(node));

    if (pathNodes.length === 0) {
      return "System Context:\nCurrent Focus: (empty).\nSummary so far: No active tree.";
    }

    const rootNode = pathNodes[0];
    const activeNode = pathNodes[pathNodes.length - 1];
    const collapse = this.shouldCollapseInjectedContext(tree, pathNodes);
    const lines = [
      "System Context:",
      `Current Focus: ${activeNode.id} (${activeNode.title}).`,
      `We are here because of ${pathNodes.map((node) => `${node.id} (${node.title})`).join(" -> ")}.`,
      `Root Definition of Done: ${rootNode.definitionOfDone ?? "Not specified."}`,
      `Collapse Mode: ${collapse ? "enabled" : "disabled"}.`,
      "Summary so far:",
    ];

    for (const node of pathNodes) {
      lines.push(
        `- ${node.id} (${node.title}) [${node.type}, ${node.status}]`,
      );
      lines.push(`  Summary: ${this.formatSummaryForInjection(node)}`);
      lines.push(`  Artifacts: ${this.formatArtifactsForInjection(node)}`);

      if (collapse) {
        const siblingLine = this.formatSiblingSnapshot(tree, node.id);
        if (siblingLine) {
          lines.push(`  Recent siblings: ${siblingLine}`);
        }
      }
    }

    return lines.join("\n");
  }

  private async ensureLoaded(): Promise<void> {
    if (this.isLoaded) {
      return;
    }

    this.tree = await readContextTree(this.stateFilePath);
    this.isLoaded = true;
  }

  private async persist(): Promise<void> {
    await writeContextTree(this.tree, this.stateFilePath);
  }

  private getNodeOrThrow(nodeId: string): ContextNode {
    const node = this.tree.nodes[nodeId];
    if (!node) {
      throw new Error(`Node "${nodeId}" does not exist.`);
    }
    return node;
  }

  private cloneNode(node: ContextNode): ContextNode {
    return {
      ...node,
      summary: [...node.summary],
      artifacts: [...node.artifacts],
      childrenIds: [...(node.childrenIds ?? [])],
    };
  }

  private deleteNode(nodeId: string): void {
    delete this.tree.nodes[nodeId];
  }

  private generateChildId(parentId: string): string {
    const parent = this.getNodeOrThrow(parentId);
    const existingIds = new Set(Object.keys(this.tree.nodes));
    let nextIndex = (parent.childrenIds?.length ?? 0) + 1;
    let candidateId = `${parentId}.${nextIndex}`;

    while (existingIds.has(candidateId)) {
      nextIndex += 1;
      candidateId = `${parentId}.${nextIndex}`;
    }

    return candidateId;
  }

  private buildPathToNode(nodeId: string): string[] {
    const path: string[] = [];
    const visited = new Set<string>();
    let currentId: string | null | undefined = nodeId;

    while (currentId) {
      if (visited.has(currentId)) {
        throw new Error(`Cycle detected while building focus path for node "${nodeId}".`);
      }

      visited.add(currentId);
      const currentNode = this.getNodeOrThrow(currentId);
      path.push(currentId);
      currentId = currentNode.parentId ?? null;
    }

    path.reverse();

    if (this.tree.rootId && path[0] !== this.tree.rootId) {
      throw new Error(`Node "${nodeId}" is not connected to the current root.`);
    }

    return path;
  }

  private getTree(): ContextTree {
    return {
      rootId: this.tree.rootId,
      nodes: Object.fromEntries(
        Object.entries(this.tree.nodes).map(([nodeId, node]) => [
          nodeId,
          {
            ...this.cloneNode(node),
          },
        ]),
      ),
      focusPath: [...this.tree.focusPath],
    };
  }

  private buildIntentResult(
    category: IntentCategory,
    confidence: "high" | "low",
    reason: string,
    currentTree: ContextTree,
    currentNodeId: string | null,
    currentNodeTitle: string | null,
    detectedConcepts: string[],
    novelConcepts: string[],
    relatedConcepts: string[],
  ): IntentAnalysisResult {
    return {
      category,
      confidence,
      reason,
      suggestedBreadcrumb: this.buildBreadcrumb(
        currentTree,
        currentNodeId,
        currentNodeTitle,
        category === "DETOUR" && confidence === "low",
      ),
      currentNodeId,
      currentNodeTitle,
      detectedConcepts,
      novelConcepts,
      relatedConcepts,
    };
  }

  private getActiveNodeFromTree(tree: ContextTree): ContextNode | null {
    const activeNodeId = tree.focusPath.at(-1) ?? tree.rootId;
    if (!activeNodeId) {
      return null;
    }

    return tree.nodes[activeNodeId] ?? null;
  }

  private buildBreadcrumb(
    tree: ContextTree,
    currentNodeId: string | null,
    currentNodeTitle: string | null,
    showTentativeDetour: boolean,
  ): string {
    if (!tree.rootId) {
      return showTentativeDetour ? `Focus: (${DETOUR_HINT_LABEL})` : "Focus: (empty)";
    }

    const labels = tree.focusPath.length > 0 ? tree.focusPath : [tree.rootId];
    const breadcrumbParts = labels.map((nodeId) => {
      const node = tree.nodes[nodeId];
      if (!node) {
        return nodeId;
      }

      if (node.id === currentNodeId && currentNodeTitle) {
        return `${node.id} (${node.title})`;
      }

      return node.id;
    });

    if (showTentativeDetour) {
      breadcrumbParts.push(`(${DETOUR_HINT_LABEL})`);
    }

    return `Focus: ${breadcrumbParts.join(" > ")}`;
  }

  private buildNextStep(
    tree: ContextTree,
    currentNode: ContextNode,
    analysis?: IntentAnalysisResult,
  ): string {
    if (analysis?.category === "COMPLETION") {
      const parentId = currentNode.parentId ?? null;
      if (parentId) {
        const parent = tree.nodes[parentId];
        return parent
          ? `Return to ${parent.id} (${parent.title}).`
          : "Return to the parent branch.";
      }
    }

    if (analysis?.category === "DETOUR" && analysis.confidence === "low") {
      const conceptLabel = analysis.novelConcepts[0] ?? "the new topic";
      return `Confirm whether "${conceptLabel}" should become a detour, then return to ${currentNode.id}.`;
    }

    if (analysis?.category === "CONTEXT_SWITCH") {
      return "Create a new root branch or switch to the new goal explicitly.";
    }

    const latestSummary = currentNode.summary.at(-1);
    if (latestSummary) {
      return latestSummary;
    }

    const childCount = currentNode.childrenIds?.length ?? 0;
    if (childCount > 0) {
      return `Continue working in ${currentNode.id} or switch to one of its ${childCount} child nodes.`;
    }

    if (currentNode.definitionOfDone) {
      return currentNode.definitionOfDone;
    }

    return `Continue work on ${currentNode.id} (${currentNode.title}).`;
  }

  private buildQuickActions(node: ContextNode): string[] {
    const actions = ["[Done]", "[Park]"];

    if (node.parentId) {
      actions.unshift("[Merge]");
    }

    return actions;
  }

  private buildSuggestedCommands(
    node: ContextNode,
    analysis?: IntentAnalysisResult,
  ): string[] {
    const commands = new Set<string>(["back", "done", "park"]);

    if (node.parentId) {
      commands.add("merge");
    }

    if (analysis?.category === "DETOUR" && analysis.confidence === "low") {
      commands.add("merge");
    }

    if (analysis?.category === "CONTEXT_SWITCH") {
      commands.add("move_to <nodeId>");
    }

    commands.add("rename_node <new_title>");

    return [...commands];
  }

  private buildUserActionFooter(
    node: ContextNode,
    analysis?: IntentAnalysisResult,
  ): string | undefined {
    const commands = this.buildSuggestedCommands(node, analysis)
      .map((command) => `'${command}'`)
      .join(", ");

    if (!analysis || analysis.confidence !== "low") {
      return `Commands: ${commands}`;
    }

    if (analysis.category === "DETOUR") {
      return `User Action Required: I've placed this in a detour. Type 'merge' if you'd rather keep this in the main flow.\nCommands: ${commands}`;
    }

    if (analysis.category === "CONTEXT_SWITCH") {
      return `User Action Required: I've treated this as a new branch. Type 'move_to <nodeId>' if it belongs elsewhere.\nCommands: ${commands}`;
    }

    return `User Action Required: Review the current classification for ${node.title}.\nCommands: ${commands}`;
  }

  private applyDialogueSummary(node: ContextNode, dialogue: string): void {
    const { summary, artifacts } = summarizeDialogue(dialogue);

    if (summary && !node.summary.includes(summary)) {
      node.summary = [...node.summary, summary];
      if (node.summary.length > MAX_SUMMARY_ITEMS) {
        this.consolidateNodeSummary(node);
      }
    }

    if (artifacts.length > 0) {
      node.artifacts = [...new Set([...node.artifacts, ...artifacts])];
    }
  }

  private consolidateNodeSummary(node: ContextNode, force: boolean = false): void {
    if (!force && node.summary.length <= MAX_SUMMARY_ITEMS) {
      return;
    }

    if (force && node.summary.length <= 3) {
      return;
    }

    node.summary = consolidateSummaries(node.summary);
  }

  private shouldCollapseInjectedContext(
    tree: ContextTree,
    _pathNodes: ContextNode[],
  ): boolean {
    return Object.keys(tree.nodes).length > INJECTED_CONTEXT_COLLAPSE_THRESHOLD;
  }

  private formatSummaryForInjection(node: ContextNode): string {
    if (node.summary.length === 0) {
      return "No summary yet.";
    }

    const scopedSummary =
      node.summary.length > 3 ? consolidateSummaries(node.summary) : node.summary;

    return scopedSummary.join(" | ");
  }

  private formatArtifactsForInjection(node: ContextNode): string {
    if (node.artifacts.length === 0) {
      return "None.";
    }

    return node.artifacts.join(", ");
  }

  private formatSiblingSnapshot(tree: ContextTree, nodeId: string): string {
    const node = tree.nodes[nodeId];
    if (!node?.parentId) {
      return "";
    }

    const parent = tree.nodes[node.parentId];
    if (!parent) {
      return "";
    }

    const siblings = (parent.childrenIds ?? [])
      .filter((childId) => childId !== nodeId)
      .map((childId) => tree.nodes[childId])
      .filter((sibling): sibling is ContextNode => Boolean(sibling))
      .slice(-INJECTED_CONTEXT_SIBLING_LIMIT);

    if (siblings.length === 0) {
      return "";
    }

    return siblings
      .map((sibling) => `${sibling.id} (${sibling.title}) [${sibling.status}]`)
      .join(", ");
  }

  private isDescendantOf(nodeId: string, potentialAncestorId: string): boolean {
    let currentId: string | null | undefined = nodeId;

    while (currentId) {
      if (currentId === potentialAncestorId) {
        return true;
      }

      const node = this.tree.nodes[currentId];
      currentId = node?.parentId ?? null;
    }

    return false;
  }

  private renderMarkdownTree(tree: ContextTree, activeNodeId: string): string {
    if (!tree.rootId) {
      return "_No active tree found._";
    }

    const lines = this.renderNodeTree(tree, tree.rootId, activeNodeId, "", true, true);
    return lines.join("\n");
  }

  private renderNodeTree(
    tree: ContextTree,
    nodeId: string,
    activeNodeId: string,
    prefix: string,
    isLast: boolean,
    isRoot: boolean = false,
  ): string[] {
    const node = tree.nodes[nodeId];
    if (!node) {
      return [];
    }

    const connector = isRoot ? "" : isLast ? "└── " : "├── ";
    const linePrefix = isRoot ? "" : `${prefix}${connector}`;
    const lines = [`${linePrefix}${this.formatNodeLabel(node)}`];

    if (node.id === activeNodeId && node.summary.length > 0) {
      const childPrefix = isRoot ? "    " : `${prefix}${isLast ? "    " : "│   "}`;
      for (const bullet of node.summary) {
        lines.push(`${childPrefix}• ${bullet}`);
      }
    }

    const children = node.childrenIds ?? [];
    children.forEach((childId, index) => {
      const nextPrefix = isRoot ? "" : `${prefix}${isLast ? "    " : "│   "}`;
      lines.push(
        ...this.renderNodeTree(
          tree,
          childId,
          activeNodeId,
          nextPrefix,
          index === children.length - 1,
          false,
        ),
      );
    });

    return lines;
  }

  private formatNodeLabel(node: ContextNode): string {
    return `${this.getTypeEmoji(node.type)} ${this.getStatusEmoji(node.status)} ${node.id} ${node.title}`;
  }

  private getTypeEmoji(type: NodeType): string {
    switch (type) {
      case "main":
        return "🎯";
      case "subtask":
        return "🖇️";
      case "detour":
        return "🔀";
      case "concept":
        return "💡";
      case "decision":
        return "🧭";
      default:
        return "•";
    }
  }

  private getStatusEmoji(status: NodeStatus): string {
    switch (status) {
      case "done":
        return "✅";
      case "in_progress":
        return "⏳";
      case "parked":
        return "🅿️";
      case "blocked":
        return "⛔";
      default:
        return "•";
    }
  }

  private buildProgressBar(tree: ContextTree): string {
    const nodes = Object.values(tree.nodes);
    const total = nodes.length;
    const done = nodes.filter((node) => node.status === "done").length;

    if (total === 0) {
      return "[----------] 0/0";
    }

    const filled = Math.round((done / total) * PROGRESS_BAR_WIDTH);
    const bar = `${"#".repeat(filled)}${"-".repeat(PROGRESS_BAR_WIDTH - filled)}`;

    return `[${bar}] ${done}/${total}`;
  }
}
