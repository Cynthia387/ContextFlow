/**
 * Mapping 树解析模块
 */

import { NODE_ROLES } from '../../shared/constants.js';
import { log } from '../../shared/utils.js';
import { processContent, hasValidContent } from './content-processor.js';

/**
 * 解析 mapping 为节点数组和边数组
 * @param {Object} mapping - 原始 mapping 对象
 * @param {string} conversationId - 对话 ID
 * @returns {{ nodes: ParsedNode[], edges: ParsedEdge[] }} 解析后的节点和边数组
 */
export function parseMapping(mapping, conversationId) {
  log('info', 'Parser', 'Parsing mapping...');
  log('debug', 'MappingParser', '=== parseMapping START ===');
  log('debug', 'MappingParser', 'Total mapping entries:', Object.keys(mapping).length);

  // 需要特殊判断的 content_type：这些是工具调用的中间产物
  // 但如果是"最后一条回复"（后代中没有其他回复类消息），则保留
  const TOOL_CONTENT_TYPES = new Set([
    'code',
    'execution_output',
    'tether_browsing_display',
    'tether_quote',
    'system_error',
    'model_editable_context',
  ]);

  // ========== "最后一条回复"判断辅助函数 ==========

  /**
   * 检查后代中(下一个USER类型之前)是否存在任何有内容的"回复类消息"
   * 包括：assistant
   */
  const hasAnyReplyDescendant = (nodeId, visited = new Set()) => {
      if (visited.has(nodeId)) return false;
      visited.add(nodeId);

      const node = mapping[nodeId];
      if (!node) return false;

      for (const childId of (node.children || [])) {
        const childNode = mapping[childId];
        if (!childNode) continue; // 仅防御空引用

        // --- 遇到 USER 节点立即截断 --- 
        // 可恶啊，Opus4.5 连DFS都写不好还要我自己来！
        const childRole = childNode.message?.author?.role;
        if (childRole === NODE_ROLES.USER) {
            continue; 
        }

        // 1. 命中检查
        if (childRole === NODE_ROLES.ASSISTANT) {
          if (hasValidContent(childNode.message?.content)) {
            return true;
          }
        }

        // 2. 递归下探
        // 即使当前节点是无效 Assistant 或 System/Tool，
        // 只要没遇到 User，就继续往下找
        if (hasAnyReplyDescendant(childId, visited)) {
          return true;
        }
      }

      return false;
    };

  /**
   * 检查后代中是否存在 user 消息
   */
  const hasUserDescendant = (nodeId, visited = new Set()) => {
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);

    const node = mapping[nodeId];
    if (!node) return false;

    for (const childId of (node.children || [])) {
      const childNode = mapping[childId];
      if (childNode?.message?.author?.role === NODE_ROLES.USER) {
        return true;
      }
      if (hasUserDescendant(childId, visited)) {
        return true;
      }
    }

    return false;
  };

  /**
   * 判断"回复类消息"是否应该被保留为最后一条
   * 条件：后代中没有其他回复类消息
   * 适用于：assistant (工具类型) 
   */
  const shouldKeepAsLastReply = (nodeId) => {
    const node = mapping[nodeId];
    if (!node?.message) {
      log('debug', 'MappingParser', `shouldKeepAsLastReply(${nodeId.substring(0,8)}): no message`);
      return false;
    }

    // 内容不能为空
    const hasContent = hasValidContent(node.message.content);
    log('debug', 'MappingParser', `shouldKeepAsLastReply(${nodeId.substring(0,8)}): hasValidContent=${hasContent}`);
    if (!hasContent) return false;

    // 如果后代中有任何其他回复类消息，则不保留
    const hasBetterCandidate = hasAnyReplyDescendant(nodeId);
    log('debug', 'MappingParser', `shouldKeepAsLastReply(${nodeId.substring(0,8)}): hasAnyReplyDescendant=${hasBetterCandidate}`);
    return !hasBetterCandidate;
  };

  // ========== 核心判断函数 ==========

  /**
   * 判断消息是否为有效的对话消息
   * @param {Object} message - 消息对象
   * @param {string} nodeId - 节点 ID（用于"最后一条回复"判断）
   */
  const isConversationMessage = (message, nodeId = null) => {
    if (!message) return false;

    const role = message.author?.role;
    const contentType = message.content?.content_type;
    const nodeIdShort = nodeId ? nodeId.substring(0, 8) : 'null';

    log('debug', 'MappingParser', `isConversationMessage(${nodeIdShort}): role=${role}, content_type=${contentType}`);

    // 1. system → 直接过滤
    if (role === 'system') {
      log('debug', 'MappingParser', `isConversationMessage(${nodeIdShort}): FILTERED - system role`);
      return false;
    }

    // 2. user → 直接保留
    if (role === NODE_ROLES.USER) {
      log('debug', 'MappingParser', `isConversationMessage(${nodeIdShort}): KEPT - user role`);
      return true;
    }

    // 3. assistant 消息
    if (role === NODE_ROLES.ASSISTANT) {
      // 3a. 不在工具类型列表 → 内容非空就保留
      if (!contentType || !TOOL_CONTENT_TYPES.has(contentType)) {
        const hasContent = hasValidContent(message.content);
        log('debug', 'MappingParser', `isConversationMessage(${nodeIdShort}): assistant non-tool, hasValidContent=${hasContent}`);
        return hasContent;
      }

      // 3b. 在工具类型列表 → 判断是否是"最后一条回复"
      if (nodeId) {
        const keep = shouldKeepAsLastReply(nodeId);
        log('debug', 'MappingParser', `isConversationMessage(${nodeIdShort}): assistant tool-type, shouldKeepAsLastReply=${keep}`);
        return keep;
      }
      log('debug', 'MappingParser', `isConversationMessage(${nodeIdShort}): FILTERED - assistant tool-type, no nodeId`);
      return false;
    }

    // 其他角色 → 过滤
    log('debug', 'MappingParser', `isConversationMessage(${nodeIdShort}): FILTERED - unknown role: ${role}`);
    return false;
  };

  // 获取节点角色（如果节点存在且有消息）
  const getNodeRole = (nodeId) => {
    const node = mapping[nodeId];
    return node?.message?.author?.role || null;
  };

  // 判断 mapping 中的节点是否为有效的对话节点
  const isValidConversationNode = (nodeId) => {
    const node = mapping[nodeId];
    return node?.message && isConversationMessage(node.message, nodeId);
  };

  // 向上追溯找到最近的有效祖先（跳过 tool/system/工具调用中间节点）
  const findValidAncestor = (nodeId) => {
    let current = mapping[nodeId]?.parent;
    const visited = new Set();

    while (current && !visited.has(current)) {
      visited.add(current);
      if (isValidConversationNode(current)) {
        return current;
      }
      current = mapping[current]?.parent;
    }
    return null;
  };

  // 向下递归找到所有有效的后代（跳过中间节点，收集直接可达的有效子节点）
  const findValidDescendants = (nodeId) => {
    const result = [];
    const queue = [...(mapping[nodeId]?.children || [])];
    const visited = new Set();

    while (queue.length > 0) {
      const childId = queue.shift();
      if (visited.has(childId)) continue;
      visited.add(childId);

      if (isValidConversationNode(childId)) {
        result.push(childId);
      } else {
        // 中间节点（tool/system/工具调用），继续向下搜索
        const grandChildren = mapping[childId]?.children || [];
        queue.push(...grandChildren);
      }
    }
    return result;
  };

  const nodes = [];

  // ========== 调试：统计 mapping 中各角色的原始数量 ==========
  const rawRoleStats = { user: 0, assistant: 0, tool: 0, system: 0, other: 0 };
  for (const nodeId in mapping) {
    const role = mapping[nodeId]?.message?.author?.role;
    if (role === 'user') rawRoleStats.user++;
    else if (role === 'assistant') rawRoleStats.assistant++;
    else if (role === 'tool') rawRoleStats.tool++;
    else if (role === 'system') rawRoleStats.system++;
    else rawRoleStats.other++;
  }
  log('debug', 'MappingParser', '=== RAW MAPPING STATS ===');
  log('debug', 'MappingParser', 'Raw role stats:', rawRoleStats);

  // 第一遍：创建所有有效的对话节点
  for (const nodeId in mapping) {
    const node = mapping[nodeId];

    // 跳过非对话消息（没有消息、system、tool、工具调用中间产物）
    // 传入 nodeId 用于工具类型消息的"最后一条"判断
    if (!node.message || !isConversationMessage(node.message, nodeId)) {
      continue;
    }

    const role = node.message.author.role;

    // 计算有效的父节点和子节点
    const validParent = findValidAncestor(nodeId);
    const validChildren = findValidDescendants(nodeId);

    const parsedNode = {
      id: nodeId,
      conversationId,
      role: role,
      content: processContent(node.message.content) || '',
      createTime: node.message.create_time || Date.now() / 1000,
      // 使用有效的父子关系（跳过 tool/system 节点）
      parent: validParent,
      children: validChildren,
      // 保留原始父子关系用于调试
      _rawParent: node.parent || null,
      _rawChildren: node.children || [],
      metadata: {
        status: node.message.status,
        weight: node.message.weight,
        endTurn: node.message.end_turn,
        ...node.message.metadata
      }
    };

    nodes.push(parsedNode);
  }

  // 构建有效节点集合
  const validNodeIds = new Set(nodes.map(n => n.id));
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // 第二遍：创建 edges（基于有效的父子关系）
  const edges = [];

  for (const node of nodes) {
    for (const childId of node.children) {
      // 验证子节点确实是有效节点
      if (!validNodeIds.has(childId)) continue;

      const childNode = nodeMap.get(childId);
      if (!childNode) continue;

      edges.push({
        // 可重复计算的主键
        id: `${conversationId}:${node.id}->${childId}`,
        conversationId,
        source: node.id,
        target: childId,
        sourceRole: node.role,
        targetRole: childNode.role,
        // 用于排序，优先用 target.createTime
        orderKey: childNode.createTime || node.createTime || Date.now() / 1000
      });
    }
  }

  // ========== 调试：统计各角色节点数量 ==========
  const roleStats = { user: 0, assistant: 0, tool: 0, other: 0 };
  for (const node of nodes) {
    if (node.role === 'user') roleStats.user++;
    else if (node.role === 'assistant') roleStats.assistant++;
    else if (node.role === 'tool') roleStats.tool++;
    else roleStats.other++;
  }
  log('debug', 'MappingParser', '=== parseMapping RESULT ===');
  log('debug', 'MappingParser', 'Role stats:', roleStats);
  log('debug', 'MappingParser', 'Total nodes:', nodes.length, 'Total edges:', edges.length);

  log('info', 'Parser', `Parsed ${nodes.length} nodes, ${edges.length} edges`);

  return { nodes, edges };
}

/**
 * 构建节点映射（ID -> Node）
 * @param {ParsedNode[]} nodes - 节点数组
 * @returns {Map<string, ParsedNode>}
 */
export function buildNodeMap(nodes) {
  const nodeMap = new Map();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  return nodeMap;
}

/**
 * 查找根节点
 * @param {ParsedNode[]} nodes - 节点数组
 * @returns {ParsedNode|null}
 */
export function findRootNode(nodes) {
  // 根节点通常是第一个用户消息
  return nodes.find(node => node.role === NODE_ROLES.USER && !node.parent) || null;
}

/**
 * 获取节点的所有祖先
 * @param {string} nodeId - 节点 ID
 * @param {Map<string, ParsedNode>} nodeMap - 节点映射
 * @returns {ParsedNode[]} 祖先节点数组（从根到父）
 */
export function getAncestors(nodeId, nodeMap) {
  const ancestors = [];
  let currentId = nodeId;

  while (currentId && nodeMap.has(currentId)) {
    const node = nodeMap.get(currentId);
    if (node.parent) {
      const parentNode = nodeMap.get(node.parent);
      if (parentNode) {
        ancestors.unshift(parentNode);
      }
    }
    currentId = node.parent;
  }

  return ancestors;
}

/**
 * 获取节点的所有后代
 * @param {string} nodeId - 节点 ID
 * @param {Map<string, ParsedNode>} nodeMap - 节点映射
 * @returns {ParsedNode[]} 后代节点数组
 */
export function getDescendants(nodeId, nodeMap) {
  const descendants = [];
  const queue = [nodeId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    const node = nodeMap.get(currentId);

    if (!node) continue;

    for (const childId of node.children) {
      const childNode = nodeMap.get(childId);
      if (childNode) {
        descendants.push(childNode);
        queue.push(childId);
      }
    }
  }

  return descendants;
}

/**
 * 获取从根到指定节点的路径
 * @param {string} nodeId - 节点 ID
 * @param {Map<string, ParsedNode>} nodeMap - 节点映射
 * @returns {ParsedNode[]} 路径节点数组（从根到目标）
 */
export function getPathToRoot(nodeId, nodeMap) {
  const path = [];
  let currentId = nodeId;

  while (currentId && nodeMap.has(currentId)) {
    const node = nodeMap.get(currentId);
    path.unshift(node);
    currentId = node.parent;
  }

  return path;
}

/**
 * 统计节点信息
 * @param {ParsedNode[]} nodes - 节点数组
 * @returns {Object} 统计信息
 */
export function getNodeStatistics(nodes) {
  const stats = {
    total: nodes.length,
    user: 0,
    assistant: 0,
    tool: 0,
    maxDepth: 0,
    branchPoints: 0
  };

  for (const node of nodes) {
    if (node.role === NODE_ROLES.USER) {
      stats.user++;
    } else if (node.role === NODE_ROLES.ASSISTANT) {
      stats.assistant++;
    } else if (node.role === 'tool') {
      stats.tool++;
    }

    if (node.children.length > 1) {
      stats.branchPoints++;
    }
  }

  return stats;
}
