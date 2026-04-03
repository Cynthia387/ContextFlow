/**
 * 对话图谱组件
 * 使用 React Flow + QA 树实现可视化
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider
} from '@xyflow/react';
// 注意：不要在这里 import CSS！
// React Flow 的 CSS 在 src/sidepanel/styles/index.css 中通过 @import 引入

import QANode from './QANode';
import StartNode from './StartNode';
import { buildAndLayoutQATree } from '../utils/qaTreeLayout';

// 自定义节点类型
const nodeTypes = {
  qaNode: QANode,
  startNode: StartNode
};

// Default edge style — soft violet to complement ContextFlow palette
const defaultEdgeOptions = {
  type: 'smoothstep',
  animated: false,
  style: {
    stroke: '#c4b5fd',
    strokeWidth: 1.5
  }
};

// Sidepanel 右侧栏 vs 悬浮窗（iframe embedded）
const IS_EMBEDDED = new URLSearchParams(window.location.search).get('embedded') === '1';

const MINIMAP_HANDLE_HEIGHT = 18;
const MINIMAP_POS_KEY = 'cg:minimap:pos';
const MINIMAP_WIDTH = 160;
const MINIMAP_HEIGHT = 120;
const MINIMAP_MARGIN = 10; // 小地图距离容器边缘的最小距离

/**
 * 将小地图 offset 限制在容器可视范围内
 * 小地图默认位置是 bottom-left，offset 是相对于这个基准的偏移
 */
function clampMiniMapOffset(offset, containerWidth, containerHeight) {
  // 有效的 X 范围：0 到 (容器宽度 - 小地图宽度 - 左右边距)
  const maxX = Math.max(0, containerWidth - MINIMAP_WIDTH - MINIMAP_MARGIN * 2);
  // 有效的 Y 范围：-(容器高度 - 小地图高度 - 上下边距) 到 0
  const minY = Math.min(0, -(containerHeight - MINIMAP_HEIGHT - MINIMAP_MARGIN * 2));

  return {
    x: Math.max(0, Math.min(maxX, offset.x)),
    y: Math.max(minY, Math.min(0, offset.y))
  };
}

/**
 * 图谱内部组件（需要 ReactFlow context）
 */
function GraphContent({
  qaTree,
  selectedPath,
  currentNodeId,
  onNodeClick,
  onNodeDoubleClick,
  onNodeContextMenu,
  graphContainerRef,
  showMiniMap,
  onToggleMiniMap
}) {
  const { fitView, setCenter, getZoom, getViewport } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [expandedQNodes, setExpandedQNodes] = useState(new Set());

  const [miniMapOffset, setMiniMapOffset] = useState(() => {
    if (IS_EMBEDDED) return { x: 0, y: 0 };
    try {
      const raw = localStorage.getItem(MINIMAP_POS_KEY);
      if (!raw) return { x: 0, y: 0 };
      const parsed = JSON.parse(raw);
      if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
        return { x: parsed.x, y: parsed.y };
      }
    } catch {
      // ignore
    }
    return { x: 0, y: 0 };
  });

  const miniMapOffsetRef = useRef(miniMapOffset);
  useEffect(() => {
    miniMapOffsetRef.current = miniMapOffset;
  }, [miniMapOffset]);

  // 监听容器尺寸变化，自动修正小地图位置
  useEffect(() => {
    if (IS_EMBEDDED || !showMiniMap) return;

    const container = graphContainerRef?.current;
    if (!container) return;

    const checkAndClampOffset = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;

      const currentOffset = miniMapOffsetRef.current;
      const clampedOffset = clampMiniMapOffset(currentOffset, width, height);

      // 只有当位置真的需要修正时才更新
      if (clampedOffset.x !== currentOffset.x || clampedOffset.y !== currentOffset.y) {
        setMiniMapOffset(clampedOffset);
        try {
          localStorage.setItem(MINIMAP_POS_KEY, JSON.stringify(clampedOffset));
        } catch {
          // ignore
        }
      }
    };

    // 初始检查
    checkAndClampOffset();

    // 监听容器尺寸变化
    const resizeObserver = new ResizeObserver(checkAndClampOffset);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [showMiniMap, graphContainerRef]);

  // Draggable minimap (sidebar mode only)
  useEffect(() => {
    if (IS_EMBEDDED || !showMiniMap) return;

    const root = graphContainerRef?.current || document;
    const panel = root.querySelector?.('[data-testid="rf__minimap"]');
    if (!panel) return;

    panel.classList.add('cg-minimap');
    panel.classList.add('cg-minimap-draggable');

    const drag = {
      dragging: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      startOffsetX: 0,
      startOffsetY: 0
    };

    const onPointerDown = (e) => {
      if (e.button !== 0) return;
      const rect = panel.getBoundingClientRect();
      const y = e.clientY - rect.top;
      // 只允许在顶部“拖拽条”区域拖动，避免和 minimap 交互冲突
      if (y > MINIMAP_HANDLE_HEIGHT) return;

      e.preventDefault();
      e.stopPropagation();

      drag.dragging = true;
      drag.pointerId = e.pointerId;
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      drag.startOffsetX = miniMapOffsetRef.current.x;
      drag.startOffsetY = miniMapOffsetRef.current.y;
      panel.classList.add('cg-minimap-dragging');

      try {
        panel.setPointerCapture?.(e.pointerId);
      } catch {
        // ignore
      }
    };

    const onPointerMove = (e) => {
      if (!drag.dragging) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      setMiniMapOffset({ x: drag.startOffsetX + dx, y: drag.startOffsetY + dy });
    };

    const endDrag = () => {
      if (!drag.dragging) return;
      drag.dragging = false;
      panel.classList.remove('cg-minimap-dragging');

      // 拖动结束时进行边界检查
      const container = graphContainerRef?.current;
      if (container) {
        const { width, height } = container.getBoundingClientRect();
        const clampedOffset = clampMiniMapOffset(miniMapOffsetRef.current, width, height);
        if (clampedOffset.x !== miniMapOffsetRef.current.x || clampedOffset.y !== miniMapOffsetRef.current.y) {
          setMiniMapOffset(clampedOffset);
        }
        try {
          localStorage.setItem(MINIMAP_POS_KEY, JSON.stringify(clampedOffset));
        } catch {
          // ignore
        }
      } else {
        try {
          localStorage.setItem(MINIMAP_POS_KEY, JSON.stringify(miniMapOffsetRef.current));
        } catch {
          // ignore
        }
      }
    };

    panel.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    return () => {
      panel.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      panel.classList.remove('cg-minimap-dragging');
      panel.classList.remove('cg-minimap-draggable');
      // cg-minimap class is harmless; keep it
    };
  }, [showMiniMap, graphContainerRef]);

  // 标记是否已经初始化过视图
  const hasInitializedView = useRef(false);

  // 用于追踪是否应该 fitView（只在数据变化时，不在展开/折叠时）
  const prevQaTreeRef = useRef(null);
  const prevSelectedPathRef = useRef(null);
  const prevCurrentNodeIdRef = useRef(null);
  const prevNodeCountRef = useRef(0); // 追踪节点数量，用于判断是否真的是数据变化

  // DEBUG: 监控视口变化
  const lastViewportRef = useRef(null);
  useEffect(() => {
    const checkViewport = () => {
      const viewport = getViewport();
      const last = lastViewportRef.current;
      if (!last || last.x !== viewport.x || last.y !== viewport.y || last.zoom !== viewport.zoom) {
        console.log('[Graph DEBUG] Viewport changed:', viewport, 'from:', last);
        lastViewportRef.current = { ...viewport };
      }
    };
    const intervalId = setInterval(checkViewport, 200);
    return () => clearInterval(intervalId);
  }, [getViewport]);

  // 展开/折叠回答的处理函数
  const handleExpandAnswer = useCallback((nodeId) => {
    setExpandedQNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  // 当 QA 树、选中路径或展开状态变化时，更新图谱
  useEffect(() => {
    if (!qaTree || !qaTree.root || qaTree.root.questions.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    // 检测是否是 QA 树数据变化（通过节点数量判断，而不是引用）
    // 如果只是选中路径变化（selectNode），节点数量不会变，不应该触发 fitView
    const currentNodeCount = (qaTree.qNodeMap?.size || 0) + (qaTree.aNodeMap?.size || 0);
    const isTreeDataChange = prevNodeCountRef.current !== currentNodeCount;
    prevNodeCountRef.current = currentNodeCount;
    prevQaTreeRef.current = qaTree;
    prevSelectedPathRef.current = selectedPath;

    console.log('[Graph DEBUG] useEffect triggered:',
      'isTreeDataChange:', isTreeDataChange,
      'nodeCount:', currentNodeCount,
      'prev:', prevNodeCountRef.current
    );

    // 从 QA 树构建并布局
    const { nodes: layoutedNodes, edges: layoutedEdges } = buildAndLayoutQATree(
      qaTree,
      selectedPath,
      'TB',
      expandedQNodes
    );

    // 为节点注入展开回调
    const nodesWithHandlers = layoutedNodes.map(node => ({
      ...node,
      data: {
        ...node.data,
        onExpandAnswer: handleExpandAnswer
      }
    }));

    console.log('[Graph] Layout complete:',
      nodesWithHandlers.length, 'nodes,',
      layoutedEdges.length, 'edges'
    );

    setNodes(nodesWithHandlers);
    setEdges(layoutedEdges);

    // 只在 QA 树数据变化时适应视图（新对话或刷新），选中路径变化不触发
    if (isTreeDataChange) {
      console.log('[Graph DEBUG] isTreeDataChange=true => calling fitView');
      setTimeout(() => {
        fitView({ padding: 0.2, duration: 300 });
      }, 100);
    } else {
      console.log('[Graph DEBUG] isTreeDataChange=false => NOT calling fitView');
    }

  }, [qaTree, selectedPath, expandedQNodes, setNodes, setEdges, fitView, handleExpandAnswer]);

  // 处理节点点击
  const handleNodeClick = useCallback((event, node) => {
    console.log('[Graph DEBUG] Node clicked:', node.id, node.data?.nodeType);
    // 忽略起始节点的点击
    if (node.data?.nodeType === 'start') return;
    onNodeClick?.(node.data.nodeId, node.data);
  }, [onNodeClick]);

  // 处理节点双击
  const handleNodeDoubleClick = useCallback((event, node) => {
    if (node.data?.nodeType === 'start') return;
    onNodeDoubleClick?.(node.data.nodeId, node.data);
  }, [onNodeDoubleClick]);

  // 处理节点右键
  const handleNodeContextMenu = useCallback((event, node) => {
    if (node.data?.nodeType === 'start') return;
    onNodeContextMenu?.(event, node.data.nodeId, node.data);
  }, [onNodeContextMenu]);

  // MiniMap 节点颜色
  const nodeColor = useCallback((node) => {
    if (node.data?.nodeType === 'start') {
      return '#94a3b8';
    }
    if (node.data?.isSelected) {
      return node.data?.nodeType === 'question' ? '#3b82f6' : '#22c55e';
    }
    return node.data?.nodeType === 'question' ? '#93c5fd' : '#86efac';
  }, []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick}
      onNodeDoubleClick={handleNodeDoubleClick}
      onNodeContextMenu={handleNodeContextMenu}
      nodeTypes={nodeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      nodeDragThreshold={5}
      minZoom={0.1}
      maxZoom={2}
      attributionPosition="bottom-left"
      proOptions={{ hideAttribution: true }}
      style={{ width: '100%', height: '100%' }}
    >
      <Controls
        showZoom={true}
        showFitView={true}
        showInteractive={false}
        position="bottom-right"
      />

      {showMiniMap && (
        <MiniMap
          className={IS_EMBEDDED ? 'cg-minimap embedded' : 'cg-minimap'}
          style={
            IS_EMBEDDED
              ? { width: 140, height: 105 }
              : {
                  width: 160,
                  height: 120,
                  transform: `translate(${miniMapOffset.x}px, ${miniMapOffset.y}px)`
                }
          }
          nodeColor={nodeColor}
          nodeStrokeWidth={3}
          zoomable
          pannable
          position="bottom-left"
        />
      )}
      <Background variant="dots" gap={20} size={1} color="#e5e7eb" />
    </ReactFlow>
  );
}

/**
 * 对话图谱组件（带 Provider）
 */
function ConversationGraph({
  qaTree,
  selectedPath,
  currentNodeId,
  onNodeClick,
  onNodeDoubleClick,
  onNodeContextMenu,
  showMiniMap = !IS_EMBEDDED,
  onToggleMiniMap
}) {
  const containerRef = useRef(null);

  return (
    <div
      ref={containerRef}
      className="graph-container"
    >
      <ReactFlowProvider>
        <GraphContent
          qaTree={qaTree}
          selectedPath={selectedPath}
          currentNodeId={currentNodeId}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeContextMenu={onNodeContextMenu}
          graphContainerRef={containerRef}
          showMiniMap={showMiniMap}
          onToggleMiniMap={onToggleMiniMap}
        />
      </ReactFlowProvider>
    </div>
  );
}

export default ConversationGraph;
