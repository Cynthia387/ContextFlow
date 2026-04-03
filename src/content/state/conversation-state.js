/**
 * 对话状态管理器
 * 管理内存中的对话数据，支持增量更新
 */

import { log } from '../../shared/utils.js';
import { parseMapping, getNodeStatistics } from '../parser/mapping-parser.js';
import { extractBranches, buildRounds, analyzeBranchStructure } from '../parser/branch-extractor.js';

/**
 * 对话状态类
 */
class ConversationState {
  constructor() {
    this.conversationId = null;
    this.title = null;
    this.mapping = {};           // 完整的 mapping（包括 API 和增量）
    this.nodes = [];             // 解析后的节点数组
    this.edges = [];             // 边数组（节点之间的父子关系）
    this.rounds = [];            // 轮次数组
    this.branches = [];          // 分支数组
    this.analysis = null;        // 分支分析
    this.createTime = null;
    this.updateTime = null;
    this.lastUpdateTime = null;
    this.incrementalCount = 0;   // 增量节点计数
    this.isInitialized = false;
  }

  /**
   * 初始化状态（从 API 获取的完整数据）
   * @param {Object} conversationData - 完整的对话数据
   */
  initialize(conversationData) {
    this.conversationId = conversationData.id;
    this.title = conversationData.title;
    this.mapping = { ...conversationData.mapping };
    this.nodes = conversationData.nodes;
    this.edges = conversationData.edges || [];
    this.rounds = conversationData.rounds;
    this.branches = conversationData.branches;
    this.analysis = conversationData.analysis;
    this.createTime = conversationData.createTime;
    this.updateTime = conversationData.updateTime;
    this.lastUpdateTime = Date.now();
    this.incrementalCount = 0;
    this.isInitialized = true;

    log('info', 'State', 'Conversation state initialized', {
      id: this.conversationId,
      nodes: this.nodes.length,
      edges: this.edges.length,
      rounds: this.rounds.length,
      branches: this.branches.length
    });
  }

  /**
   * 添加增量节点
   * @param {Object} messageData - 从 DOM 提取的消息数据
   * @returns {boolean} 是否成功添加
   */
  addIncrementalNode(messageData) {
    if (!this.isInitialized) {
      log('warn', 'State', 'Cannot add incremental node: state not initialized');
      return false;
    }

    const nodeId = messageData.id;

    // 检查是否已存在
    if (this.mapping[nodeId]) {
      log('debug', 'State', `Node ${nodeId} already exists, skipping`);
      return false;
    }

    log('info', 'State', 'Adding incremental node', {
      id: nodeId,
      role: messageData.role,
      contentLength: messageData.content?.length || 0
    });

    // 构建 mapping 节点（模拟 API 格式）
    this.mapping[nodeId] = {
      id: nodeId,
      message: {
        id: nodeId,
        author: {
          role: messageData.role
        },
        content: {
          content_type: 'text',
          parts: [messageData.content || '']
        },
        create_time: messageData.timestamp / 1000,
        metadata: {
          is_incremental: true,
          source: 'dom',
          timestamp: messageData.timestamp
        }
      },
      parent: messageData.parent,
      children: []
    };

    // 更新父节点的 children 数组
    if (messageData.parent && this.mapping[messageData.parent]) {
      const parentChildren = this.mapping[messageData.parent].children;
      if (!parentChildren.includes(nodeId)) {
        parentChildren.push(nodeId);
        log('debug', 'State', `Updated parent ${messageData.parent} children`);
      }
    }

    // 重新解析整个 mapping
    this.reparse();

    this.incrementalCount++;
    this.lastUpdateTime = Date.now();

    log('info', 'State', 'Incremental node added successfully', {
      totalNodes: this.nodes.length,
      incrementalCount: this.incrementalCount
    });

    return true;
  }

  /**
   * 重新解析节点、边、轮次和分支
   * @private
   */
  reparse() {
    try {
      // 重新解析 nodes 和 edges
      const { nodes, edges } = parseMapping(this.mapping, this.conversationId);
      this.nodes = nodes;
      this.edges = edges;

      // 重新构建 rounds
      this.rounds = buildRounds(this.nodes);

      // 重新提取 branches
      this.branches = extractBranches(this.nodes);

      // 重新分析分支结构
      this.analysis = analyzeBranchStructure(this.nodes);

      const stats = getNodeStatistics(this.nodes);
      log('debug', 'State', 'Reparsed conversation', { ...stats, edges: this.edges.length });

    } catch (error) {
      log('error', 'State', 'Failed to reparse:', error);
    }
  }

  /**
   * 获取完整数据（用于发送到 background）
   * @returns {Object}
   */
  getFullData() {
    return {
      id: this.conversationId,
      title: this.title,
      createTime: this.createTime,
      updateTime: this.updateTime,
      mapping: this.mapping,
      nodes: this.nodes,
      edges: this.edges,
      rounds: this.rounds,
      branches: this.branches,
      analysis: this.analysis,
      metadata: {
        lastUpdateTime: this.lastUpdateTime,
        incrementalCount: this.incrementalCount,
        isFullyLoaded: this.isInitialized
      }
    };
  }

  /**
   * 获取增量更新数据（仅新增的节点）
   * @param {string} nodeId - 新增节点的 ID
   * @returns {Object}
   */
  getIncrementalUpdate(nodeId) {
    const newNode = this.nodes.find(n => n.id === nodeId);

    return {
      type: 'incremental',
      conversationId: this.conversationId,
      newNode: newNode,
      updatedNodes: this.nodes,
      updatedEdges: this.edges,
      updatedBranches: this.branches,
      updatedRounds: this.rounds,
      updatedAnalysis: this.analysis,
      timestamp: Date.now()
    };
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      conversationId: this.conversationId,
      totalNodes: this.nodes.length,
      totalEdges: this.edges.length,
      totalRounds: this.rounds.length,
      totalBranches: this.branches.length,
      branchPoints: this.analysis?.branchPointsCount || 0,
      incrementalNodes: this.incrementalCount,
      lastUpdateTime: this.lastUpdateTime,
      isInitialized: this.isInitialized
    };
  }

  /**
   * 清空状态
   */
  clear() {
    this.conversationId = null;
    this.title = null;
    this.mapping = {};
    this.nodes = [];
    this.edges = [];
    this.rounds = [];
    this.branches = [];
    this.analysis = null;
    this.createTime = null;
    this.updateTime = null;
    this.lastUpdateTime = null;
    this.incrementalCount = 0;
    this.isInitialized = false;

    log('info', 'State', 'Conversation state cleared');
  }

  /**
   * 检查是否已初始化
   * @returns {boolean}
   */
  isReady() {
    return this.isInitialized && this.conversationId !== null;
  }

  /**
   * 获取所有节点
   * @returns {Object[]} 节点数组
   */
  getNodes() {
    return this.nodes;
  }
}

// 导出单例实例
export const conversationState = new ConversationState();
