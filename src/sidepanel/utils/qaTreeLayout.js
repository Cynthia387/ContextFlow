/**
 * QA 树布局工具
 * 将 QA 树转换为 React Flow 的 nodes 和 edges
 */
import dagre from 'dagre';

/**
 * 节点尺寸配置
 */
const NODE_WIDTH = 240;
const NODE_HEIGHT = 100;
const START_NODE_WIDTH = 120;
const START_NODE_HEIGHT = 40;

/**
 * ContextFlow color palette.
 * Q nodes  → indigo   A nodes → teal   Start → violet   Edge → soft violet
 */
const COLORS = {
  question: {
    bg: '#eef2ff',
    border: '#818cf8',
    selectedBg: '#e0e7ff',
    selectedBorder: '#4f46e5'
  },
  answer: {
    bg: '#f0fdfa',
    border: '#2dd4bf',
    selectedBg: '#ccfbf1',
    selectedBorder: '#0d9488'
  },
  start: {
    bg: '#f5f3ff',
    border: '#a78bfa'
  },
  edge: {
    normal: '#c4b5fd',
    selected: '#6366f1'
  }
};

/**
 * 从 QA 树构建 React Flow 的 nodes 和 edges
 *
 * @param {Object} qaTree - QA 树对象
 * @param {Set<string>} selectedPath - 选中路径上的节点 ID
 * @param {Set<string>} expandedQNodes - 已展开的 Q 节点 ID（用于显示单个 A 节点）
 * @returns {{ nodes: Array, edges: Array }}
 */
export function buildFlowFromQATree(qaTree, selectedPath = new Set(), expandedQNodes = new Set()) {
  if (!qaTree || !qaTree.root || qaTree.root.questions.length === 0) {
    return { nodes: [], edges: [] };
  }

  const flowNodes = [];
  const flowEdges = [];
  const hasMultipleRoots = qaTree.root.questions.length > 1;

  // 如果有多个根节点，添加一个起始节点
  if (hasMultipleRoots) {
    flowNodes.push({
      id: 'start-node',
      type: 'startNode',
      data: {
        nodeType: 'start',
        colors: COLORS.start
      },
      position: { x: 0, y: 0 }
    });
  }

  /**
   * 处理 QNode
   */
  function processQNode(qNode, parentFlowNodeId = null) {
    const isSelected = selectedPath.has(qNode.userId);
    const colors = isSelected ?
      { bg: COLORS.question.selectedBg, border: COLORS.question.selectedBorder } :
      { bg: COLORS.question.bg, border: COLORS.question.border };

    const flowNodeId = `q-${qNode.userId}`;
    const hasSingleAnswer = qNode.answers.length === 1;
    const isExpanded = expandedQNodes.has(qNode.userId);
    const shouldCollapseAnswer = hasSingleAnswer && !isExpanded;

    // 如果折叠单个回答，存储回答信息供 Q 节点显示
    const collapsedAnswer = hasSingleAnswer ? qNode.answers[0] : null;

    flowNodes.push({
      id: flowNodeId,
      type: 'qaNode',
      data: {
        nodeType: 'question',
        nodeId: qNode.userId,
        content: qNode.content,
        preview: qNode.preview,
        createTime: qNode.createTime,
        isSelected,
        childCount: qNode.answers.length,
        colors,
        messageId: qNode.userId,
        category: qNode.category || null,
        // 折叠相关
        collapsedAnswer: collapsedAnswer ? {
          assistantId: collapsedAnswer.assistantId,
          content: collapsedAnswer.content,
          preview: collapsedAnswer.preview
        } : null,
        canExpand: hasSingleAnswer,  // 只要有单个回答就可以展开/折叠
        isExpanded: isExpanded
      },
      position: { x: 0, y: 0 }
    });

    // 创建从父节点到当前节点的边
    if (parentFlowNodeId) {
      const parentIsAnswer = parentFlowNodeId.startsWith('a-');
      const parentId = parentIsAnswer ? parentFlowNodeId.replace('a-', '') : null;
      const edgeSelected = isSelected && parentId && selectedPath.has(parentId);
      flowEdges.push({
        id: `edge-${parentFlowNodeId}-${flowNodeId}`,
        source: parentFlowNodeId,
        target: flowNodeId,
        type: 'smoothstep',
        animated: false,
        style: {
          stroke: edgeSelected ? COLORS.edge.selected : COLORS.edge.normal,
          strokeWidth: edgeSelected ? 2.5 : 1.5
        }
      });
    }

    // 处理回答
    if (shouldCollapseAnswer) {
      // 单个回答被折叠：直接连接到下一层的 Q 节点
      const aNode = qNode.answers[0];
      for (const nextQNode of aNode.nextQuestions) {
        processQNode(nextQNode, flowNodeId);
      }
    } else {
      // 多个回答或已展开：正常渲染所有 A 节点
      for (const aNode of qNode.answers) {
        processANode(aNode, flowNodeId);
      }
    }
  }

  /**
   * 处理 ANode
   */
  function processANode(aNode, parentFlowNodeId) {
    const isSelected = selectedPath.has(aNode.assistantId);
    const colors = isSelected ?
      { bg: COLORS.answer.selectedBg, border: COLORS.answer.selectedBorder } :
      { bg: COLORS.answer.bg, border: COLORS.answer.border };

    const flowNodeId = `a-${aNode.assistantId}`;

    flowNodes.push({
      id: flowNodeId,
      type: 'qaNode',
      data: {
        nodeType: 'answer',
        nodeId: aNode.assistantId,
        content: aNode.content,
        preview: aNode.preview,
        createTime: aNode.createTime,
        isSelected,
        childCount: aNode.nextQuestions.length,
        colors,
        messageId: aNode.assistantId
      },
      position: { x: 0, y: 0 }
    });

    // 创建从父节点到当前节点的边
    const parentSelected = selectedPath.has(parentFlowNodeId.replace('q-', ''));
    const edgeSelected = isSelected && parentSelected;
    flowEdges.push({
      id: `edge-${parentFlowNodeId}-${flowNodeId}`,
      source: parentFlowNodeId,
      target: flowNodeId,
      type: 'smoothstep',
      animated: false,
      style: {
        stroke: edgeSelected ? COLORS.edge.selected : COLORS.edge.normal,
        strokeWidth: edgeSelected ? 2.5 : 1.5
      }
    });

    // 递归处理后续问题
    for (const qNode of aNode.nextQuestions) {
      processQNode(qNode, flowNodeId);
    }
  }

  // 从根问题开始处理
  for (const qNode of qaTree.root.questions) {
    const parentId = hasMultipleRoots ? 'start-node' : null;
    processQNode(qNode, parentId);
  }

  // 如果有起始节点，创建到所有根 Q 节点的边
  if (hasMultipleRoots) {
    for (const qNode of qaTree.root.questions) {
      const isSelected = selectedPath.has(qNode.userId);
      flowEdges.push({
        id: `edge-start-q-${qNode.userId}`,
        source: 'start-node',
        target: `q-${qNode.userId}`,
        type: 'smoothstep',
        animated: false,
        style: {
          stroke: isSelected ? COLORS.edge.selected : COLORS.edge.normal,
          strokeWidth: isSelected ? 2.5 : 1.5
        }
      });
    }
  }

  return { nodes: flowNodes, edges: flowEdges };
}

/**
 * 使用 dagre 计算布局
 *
 * @param {Array} nodes - React Flow 节点数组
 * @param {Array} edges - React Flow 边数组
 * @param {string} direction - 布局方向 ('TB' | 'LR')
 * @returns {{ nodes: Array, edges: Array }}
 */
export function applyDagreLayout(nodes, edges, direction = 'TB') {
  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const dagreGraph = new dagre.graphlib.Graph();

  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 40,    // 节点水平间距
    ranksep: 60,    // 层级垂直间距
    marginx: 20,
    marginy: 20
  });

  // 添加节点到 dagre
  nodes.forEach((node) => {
    const isStartNode = node.data?.nodeType === 'start';
    dagreGraph.setNode(node.id, {
      width: isStartNode ? START_NODE_WIDTH : NODE_WIDTH,
      height: isStartNode ? START_NODE_HEIGHT : NODE_HEIGHT
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
    const isStartNode = node.data?.nodeType === 'start';
    const width = isStartNode ? START_NODE_WIDTH : NODE_WIDTH;
    const height = isStartNode ? START_NODE_HEIGHT : NODE_HEIGHT;

    return {
      ...node,
      position: {
        x: nodeWithPosition.x - width / 2,
        y: nodeWithPosition.y - height / 2
      }
    };
  });

  return { nodes: layoutedNodes, edges };
}

/**
 * 一步完成：从 QA 树构建并布局
 *
 * @param {Object} qaTree
 * @param {Set<string>} selectedPath
 * @param {string} direction
 * @param {Set<string>} expandedQNodes - 已展开的 Q 节点 ID
 * @returns {{ nodes: Array, edges: Array }}
 */
export function buildAndLayoutQATree(qaTree, selectedPath, direction = 'TB', expandedQNodes = new Set()) {
  const { nodes, edges } = buildFlowFromQATree(qaTree, selectedPath, expandedQNodes);
  return applyDagreLayout(nodes, edges, direction);
}
