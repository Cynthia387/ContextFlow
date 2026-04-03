/**
 * 布局工具函数
 * 使用 dagre 进行自动布局
 */
import dagre from 'dagre';

/**
 * 节点尺寸配置
 */
const NODE_WIDTH = 220;
// 节点实际高度会随“显示更多”略有变化；dagre 使用固定高度做布局计算。
// 这里给一个相对保守的高度，避免 expanded 状态节点互相重叠。
const NODE_HEIGHT = 140;

/**
 * ContextFlow level colors (must match RoundNode.jsx LEVEL_COLORS).
 */
const LEVEL_COLORS = [
  '#ede9fe',  // Level 0 - violet
  '#eef2ff',  // Level 1 - indigo
  '#e0f2fe',  // Level 2 - sky
  '#f0fdfa'   // Level 3 - teal
];

/**
 * 从 rounds 数据构建图数据
 * @param {Array} rounds - 轮次数组
 * @returns {{ nodes: Array, edges: Array }}
 */
export function buildGraphData(rounds) {
  if (!rounds || rounds.length === 0) {
    return { nodes: [], edges: [] };
  }

  // --- helpers ---
  const normalizeText = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(normalizeText).join('');
    if (typeof value === 'object') {
      // ChatGPT API: { content_type: 'text', parts: [...] }
      if (Array.isArray(value.parts)) return value.parts.map(normalizeText).join('');
      // some structures might use "text"
      if (typeof value.text === 'string') return value.text;
    }
    try {
      return String(value);
    } catch {
      return '';
    }
  };

  const nodes = [];
  const edges = [];
  const nodeByRoundId = new Map();

  // 1) Create all nodes (use round.id as the ReactFlow node id to keep parent links stable)
  rounds.forEach((round, index) => {
    const nodeId = String(round.id || `round_${round.roundNumber || index + 1}`);

    // Extract message text (support multiple data shapes)
    let userContent = '';
    let assistantContent = '';
    let lastMessageId = '';

    if (round.userMessage) {
      userContent = normalizeText(round.userMessage.content);
      lastMessageId = round.userMessage.id || '';
    } else if (round.messages) {
      const userMsg = round.messages.find(m => m.role === 'user');
      userContent = normalizeText(userMsg?.content);
      lastMessageId = userMsg?.id || '';
    } else {
      userContent = normalizeText(round.userContent);
    }

    if (round.assistantMessage) {
      assistantContent = normalizeText(round.assistantMessage.content);
      lastMessageId = round.assistantMessage.id || lastMessageId;
    } else if (round.messages) {
      const assistantMsg = round.messages.find(m => m.role === 'assistant');
      assistantContent = normalizeText(assistantMsg?.content);
      lastMessageId = assistantMsg?.id || lastMessageId;
    } else {
      assistantContent = normalizeText(round.assistantContent);
    }

    // fallback for scrolling
    if (!lastMessageId) {
      lastMessageId = round.lastMessageId || round.assistantMessageId || round.userMessageId || round.id;
    }

    // level (prefer depth)
    const level = Number.isFinite(round.depth) ? round.depth : Math.min(index, 3);

    const nodeData = {
      id: nodeId,
      type: 'round',
      data: {
        roundNumber: round.roundNumber || index + 1,
        userContent,
        assistantContent,
        lastMessageId,
        level,
        color: LEVEL_COLORS[level % LEVEL_COLORS.length],
        hasChildren: false,
        branchCount: 1,
        raw: round
      },
      position: { x: 0, y: 0 }
    };

    nodes.push(nodeData);
    nodeByRoundId.set(nodeId, nodeData);
  });

  // 2) Create edges (prefer parentRoundId; DO NOT fall back to "previous" which breaks branching)
  rounds.forEach((round, index) => {
    const targetId = String(round.id || `round_${round.roundNumber || index + 1}`);
    const parentId = round.parentRoundId ? String(round.parentRoundId) : null;

    if (!parentId) return;
    if (!nodeByRoundId.has(parentId) || !nodeByRoundId.has(targetId)) return;

    const sourceNode = nodeByRoundId.get(parentId);
    const edgeColor = sourceNode?.data?.color || LEVEL_COLORS[0];

    edges.push({
      id: `edge-${parentId}-${targetId}`,
      source: parentId,
      target: targetId,
      type: 'smoothstep',
      animated: false,
      style: {
        stroke: edgeColor,
        strokeWidth: 2
      }
    });

    if (sourceNode) {
      sourceNode.data.hasChildren = true;
    }
  });

  // 处理分支（如果存在）
  // 查找有多个子节点的节点
  const childCount = new Map();
  edges.forEach(edge => {
    const count = childCount.get(edge.source) || 0;
    childCount.set(edge.source, count + 1);
  });

  childCount.forEach((count, nodeId) => {
    const node = nodes.find(n => n.id === nodeId);
    if (node && count > 1) {
      node.data.branchCount = count;
    }
  });

  return { nodes, edges };
}

/**
 * 使用 dagre 计算布局
 * @param {Array} nodes - 节点数组
 * @param {Array} edges - 边数组
 * @param {string} direction - 布局方向 ('TB' | 'LR')
 * @returns {{ nodes: Array, edges: Array }}
 */
export function getLayoutedElements(nodes, edges, direction = 'TB') {
  const dagreGraph = new dagre.graphlib.Graph();

  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 50,    // 节点水平间距
    ranksep: 80,    // 层级垂直间距
    marginx: 20,
    marginy: 20
  });

  // 添加节点到 dagre
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: NODE_WIDTH,
      height: NODE_HEIGHT
    });
  });

  // 添加边到 dagre
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  // 计算布局
  dagre.layout(dagreGraph);

  // 更新节点位置
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);

    return {
      ...node,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - NODE_HEIGHT / 2
      }
    };
  });

  return { nodes: layoutedNodes, edges };
}

/**
 * 查找节点的所有子孙节点
 * @param {string} nodeId - 节点 ID
 * @param {Array} edges - 边数组
 * @returns {Set<string>}
 */
export function findDescendants(nodeId, edges) {
  const descendants = new Set();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift();

    edges.forEach(edge => {
      if (edge.source === current && !descendants.has(edge.target)) {
        descendants.add(edge.target);
        queue.push(edge.target);
      }
    });
  }

  return descendants;
}

/**
 * 查找节点的所有祖先节点
 * @param {string} nodeId - 节点 ID
 * @param {Array} edges - 边数组
 * @returns {Set<string>}
 */
export function findAncestors(nodeId, edges) {
  const ancestors = new Set();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift();

    edges.forEach(edge => {
      if (edge.target === current && !ancestors.has(edge.source)) {
        ancestors.add(edge.source);
        queue.push(edge.source);
      }
    });
  }

  return ancestors;
}
