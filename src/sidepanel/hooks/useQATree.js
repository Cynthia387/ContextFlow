/**
 * QA 树 Hook
 *
 * 管理 QA 树的构建和选中路径状态
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  buildQATree,
  updateSelectedPath,
  switchToSibling,
  getSiblingInfo,
  isOnSelectedPath,
  getTreeStats,
  getSelectedPathAsList,
  debugPrintTree
} from '../utils/qa-tree.js';

/**
 * @param {Array} nodes - 节点数组
 * @param {Array} edges - 边数组
 * @param {Object} options - 配置选项
 * @param {boolean} options.debug - 是否输出调试信息
 * @returns {Object}
 */
export function useQATree(nodes, edges, options = {}) {
  const { debug = false } = options;

  // QA 树状态
  const [tree, setTree] = useState(null);

  // 当 nodes 或 edges 变化时重建树
  useEffect(() => {
    if (!nodes || nodes.length === 0) {
      setTree(null);
      return;
    }

    const newTree = buildQATree(nodes, edges || []);
    setTree(newTree);

    if (debug) {
      console.log('[useQATree] Tree built');
      debugPrintTree(newTree);
    }
  }, [nodes, edges, debug]);

  // 选择特定节点（更新选中路径）
  const selectNode = useCallback((nodeId) => {
    if (!tree || !nodeId) return;

    const updatedTree = updateSelectedPath(tree, nodeId);
    setTree(updatedTree);

    if (debug) {
      console.log('[useQATree] Selected node:', nodeId);
    }
  }, [tree, debug]);

  // 切换到兄弟节点
  const switchSibling = useCallback((nodeId, direction) => {
    if (!tree || !nodeId) return false;

    const updatedTree = switchToSibling(nodeId, direction, tree);
    if (updatedTree) {
      setTree(updatedTree);

      if (debug) {
        console.log('[useQATree] Switched sibling:', direction, 'new leaf:', updatedTree.activeLeafId);
      }
      return true;
    }

    return false;
  }, [tree, debug]);

  // 切换到上一个兄弟
  const switchToPrev = useCallback((nodeId) => {
    return switchSibling(nodeId, 'prev');
  }, [switchSibling]);

  // 切换到下一个兄弟
  const switchToNext = useCallback((nodeId) => {
    return switchSibling(nodeId, 'next');
  }, [switchSibling]);

  // 获取节点的兄弟信息
  const getNodeSiblingInfo = useCallback((nodeId) => {
    if (!tree || !nodeId) return null;
    return getSiblingInfo(nodeId, tree);
  }, [tree]);

  // 判断节点是否在选中路径上
  const isNodeSelected = useCallback((nodeId) => {
    if (!tree || !nodeId) return false;
    return isOnSelectedPath(nodeId, tree.selectedPath);
  }, [tree]);

  // 获取选中路径的节点列表
  const selectedPathList = useMemo(() => {
    if (!tree) return [];
    return getSelectedPathAsList(tree);
  }, [tree]);

  // 获取树统计信息
  const stats = useMemo(() => {
    if (!tree) return null;
    return getTreeStats(tree);
  }, [tree]);

  // 调试：打印树
  const printTree = useCallback(() => {
    if (tree) {
      debugPrintTree(tree);
    }
  }, [tree]);

  return {
    // 树数据
    tree,
    root: tree?.root || null,
    qNodeMap: tree?.qNodeMap || new Map(),
    aNodeMap: tree?.aNodeMap || new Map(),

    // 选中状态
    selectedPath: tree?.selectedPath || new Set(),
    activeLeafId: tree?.activeLeafId || null,
    selectedPathList,

    // 操作方法
    selectNode,
    switchToPrev,
    switchToNext,
    getNodeSiblingInfo,
    isNodeSelected,

    // 统计和调试
    stats,
    printTree,

    // 状态
    isReady: tree !== null && tree.root.questions.length > 0
  };
}

/**
 * 辅助 Hook：监听外部的分支切换事件
 * 用于同步 ChatGPT 页面的分支切换
 *
 * @param {function} onBranchChange - 分支切换回调
 */
export function useBranchChangeListener(onBranchChange) {
  useEffect(() => {
    const handleMessage = (message) => {
      if (message?.type === 'BRANCH_CHANGED' && message?.payload?.nodeId) {
        onBranchChange?.(message.payload.nodeId);
      }
    };

    try {
      chrome.runtime.onMessage.addListener(handleMessage);
    } catch {
      // 可能不在扩展环境中
    }

    return () => {
      try {
        chrome.runtime.onMessage.removeListener(handleMessage);
      } catch {
        // ignore
      }
    };
  }, [onBranchChange]);
}

export default useQATree;
