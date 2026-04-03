/**
 * 分支提取模块
 */

import { log } from '../../shared/utils.js';
import { buildNodeMap, getPathToRoot } from './mapping-parser.js';

/**
 * 找出所有分支点
 * @param {ParsedNode[]} nodes - 节点数组
 * @returns {BranchPoint[]} 分支点数组
 */
export function findBranchPoints(nodes) {
  log('info', 'BranchExtractor', 'Finding branch points...');

  const branchPoints = [];

  for (const node of nodes) {
    // 分支点：有多个子节点
    if (node.children && node.children.length > 1) {
      branchPoints.push({
        nodeId: node.id,
        role: node.role,
        content: node.content.substring(0, 60) + '...',
        childrenCount: node.children.length,
        childrenIds: node.children
      });
    }
  }

  log('info', 'BranchExtractor', `Found ${branchPoints.length} branch points`);

  return branchPoints;
}

/**
 * 找出所有叶子节点
 * @param {ParsedNode[]} nodes - 节点数组
 * @returns {ParsedNode[]} 叶子节点数组
 */
export function findLeafNodes(nodes) {
  return nodes.filter(node => {
    return !node.children || node.children.length === 0;
  });
}

/**
 * 提取所有分支（每个叶子节点代表一条完整路径）
 * @param {ParsedNode[]} nodes - 节点数组
 * @returns {Branch[]} 分支数组
 */
export function extractBranches(nodes) {
  log('info', 'BranchExtractor', 'Extracting branches...');

  const nodeMap = buildNodeMap(nodes);
  const leafNodes = findLeafNodes(nodes);
  const branches = [];

  for (const leafNode of leafNodes) {
    const path = getPathToRoot(leafNode.id, nodeMap);

    branches.push({
      id: leafNode.id,
      path: path,
      messageCount: path.length,
      depth: path.length
    });
  }

  log('info', 'BranchExtractor', `Extracted ${branches.length} branches`);

  return branches;
}

/**
 * 构建轮次（Round）数组
 * 一个 Round = 用户消息 + AI 回复
 * @param {ParsedNode[]} nodes - 节点数组
 * @returns {Round[]} 轮次数组
 */
export function buildRounds(nodes) {
  log('info', 'BranchExtractor', 'Building rounds...');

  if (!nodes || nodes.length === 0) {
    return [];
  }

  const nodeMap = buildNodeMap(nodes);

  // 只基于用户消息创建 Round（一个 Round = user + (可选) assistant）
  // ⚠️ 注意：mapping 的遍历顺序不稳定，因此这里必须显式排序，
  // 否则 parentRoundId / depth 会在不同运行间漂移。
  const userNodes = nodes
    .filter(node => node.role === 'user')
    .slice()
    .sort((a, b) => (a.createTime || 0) - (b.createTime || 0));

  // 第一遍：先创建所有 rounds（不依赖 rounds 数组的顺序）
  const rounds = userNodes.map((userNode, index) => {
    // 找到对应的 assistant 回复：优先取 user 的子节点里第一个 assistant
    const assistantNode = (userNode.children || [])
      .map(childId => nodeMap.get(childId))
      .filter(child => child && child.role === 'assistant')[0] || null;

    return {
      // 用 user message id 作为 round id 的后缀，保证跨更新稳定 & 可追踪
      id: `round_${userNode.id}`,
      conversationId: userNode.conversationId,
      roundNumber: index + 1,
      depth: 0, // 第二遍计算

      // 完整消息对象（便于 sidepanel 直接展示）
      userMessage: {
        id: userNode.id,
        role: 'user',
        content: userNode.content || '',
        createTime: userNode.createTime
      },
      assistantMessage: assistantNode ? {
        id: assistantNode.id,
        role: 'assistant',
        content: assistantNode.content || '',
        createTime: assistantNode.createTime
      } : null,

      // 保留 ID 引用（便于通过 nodes 反查/补全）
      userMessageId: userNode.id,
      assistantMessageId: assistantNode ? assistantNode.id : null,

      // 第二遍计算
      parentRoundId: null,

      createTime: userNode.createTime
    };
  });

  // 建立辅助索引：messageId -> roundId
  const userToRoundId = new Map();
  const assistantToRoundId = new Map();
  const roundById = new Map();

  rounds.forEach(r => {
    roundById.set(r.id, r);
    if (r.userMessageId) userToRoundId.set(r.userMessageId, r.id);
    if (r.assistantMessageId) assistantToRoundId.set(r.assistantMessageId, r.id);
  });

  // 第二遍：计算 parentRoundId（不依赖 rounds 的顺序）
  for (const round of rounds) {
    const userNode = nodeMap.get(round.userMessageId);
    if (!userNode || !userNode.parent) {
      round.parentRoundId = null;
      continue;
    }

    const parentNode = nodeMap.get(userNode.parent);
    if (!parentNode) {
      // parent 可能是 system/client-created-root（parseMapping 会跳过），属于根
      round.parentRoundId = null;
      continue;
    }

    if (parentNode.role === 'assistant') {
      round.parentRoundId = assistantToRoundId.get(parentNode.id) || null;
    } else if (parentNode.role === 'user') {
      round.parentRoundId = userToRoundId.get(parentNode.id) || null;
    } else {
      round.parentRoundId = null;
    }
  }

  // 第三遍：计算 depth（memoized DFS，保证分支正确）
  const depthMemo = new Map();
  const visiting = new Set();

  const computeDepth = (roundId) => {
    if (!roundId) return 0;
    if (depthMemo.has(roundId)) return depthMemo.get(roundId);
    if (visiting.has(roundId)) {
      // 理论上不应出现环，出现则兜底为 0
      return 0;
    }

    visiting.add(roundId);

    const r = roundById.get(roundId);
    if (!r || !r.parentRoundId) {
      depthMemo.set(roundId, 0);
      visiting.delete(roundId);
      return 0;
    }

    const d = computeDepth(r.parentRoundId) + 1;
    depthMemo.set(roundId, d);
    visiting.delete(roundId);
    return d;
  };

  rounds.forEach(r => {
    r.depth = computeDepth(r.id);
  });

  log('info', 'BranchExtractor', `Built ${rounds.length} rounds`);

  return rounds;
}

/**
 * 分析分支结构
 * @param {ParsedNode[]} nodes - 节点数组
 * @returns {Object} 分支结构分析结果
 */
export function analyzeBranchStructure(nodes) {
  const branchPoints = findBranchPoints(nodes);
  const branches = extractBranches(nodes);
  const leafNodes = findLeafNodes(nodes);

  return {
    totalNodes: nodes.length,
    branchPointsCount: branchPoints.length,
    branchesCount: branches.length,
    leafNodesCount: leafNodes.length,
    branchPoints,
    branches,
    leafNodes
  };
}

/**
 * 获取节点的兄弟节点
 * @param {string} nodeId - 节点 ID
 * @param {ParsedNode[]} nodes - 节点数组
 * @returns {ParsedNode[]} 兄弟节点数组
 */
export function getSiblings(nodeId, nodes) {
  const nodeMap = buildNodeMap(nodes);
  const node = nodeMap.get(nodeId);

  if (!node || !node.parent) {
    return [];
  }

  const parent = nodeMap.get(node.parent);
  if (!parent) {
    return [];
  }

  return parent.children
    .filter(childId => childId !== nodeId)
    .map(childId => nodeMap.get(childId))
    .filter(child => child !== undefined);
}
