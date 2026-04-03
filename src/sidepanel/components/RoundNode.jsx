/**
 * Round 节点组件
 * 显示一对问答（User + Assistant）
 */
import React, { memo, useState, useCallback } from 'react';
import { Handle, Position } from '@xyflow/react';

/**
 * ContextFlow level colors (must match layoutUtils.js LEVEL_COLORS).
 */
const LEVEL_COLORS = {
  0: { bg: '#ede9fe', border: '#a78bfa' },  // Level 0 - violet
  1: { bg: '#eef2ff', border: '#818cf8' },  // Level 1 - indigo
  2: { bg: '#e0f2fe', border: '#38bdf8' },  // Level 2 - sky
  3: { bg: '#f0fdfa', border: '#2dd4bf' },  // Level 3 - teal
  default: { bg: '#f5f3ff', border: '#c4b5fd' }
};

function RoundNode({ id, data, selected }) {
  // 是否展示更多内容（不是“折叠整块节点”，而是“展开更多文本”）
  const [showMore, setShowMore] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // 获取节点颜色
  const colors = LEVEL_COLORS[data.level] || LEVEL_COLORS[data.level % 4] || LEVEL_COLORS.default;

  // 文本截断
  const truncate = (text, maxLength) => {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '…' : text;
  };

  // 展示策略：默认只给用户提问很短预览；点击 + 展开更多（但仍然不是全部）
  const PREVIEW_USER_LEN = 48;
  const EXPANDED_USER_LEN = 160;
  const EXPANDED_ASSISTANT_LEN = 160;

  const hasAssistant = !!(data.assistantContent && data.assistantContent.trim().length > 0);
  const hasMoreUserText = (data.userContent || '').length > PREVIEW_USER_LEN;

  // 只要“用户文本有更多”或“有 assistant 回复”就允许展开
  const canToggleMore = hasMoreUserText || hasAssistant;

  const toggleShowMore = useCallback((e) => {
    e.stopPropagation();
    setShowMore(prev => !prev);
  }, []);

  return (
    <div
      className={`round-node ${selected ? 'selected' : ''} ${isHovered ? 'hovered' : ''}`}
      style={{
        backgroundColor: colors.bg,
        borderColor: selected ? '#6366f1' : colors.border
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 顶部连接点 */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: colors.border }}
      />

      {/* 节点头部 */}
      <div className="node-header">
        <span className="node-round-number">Round {data.roundNumber}</span>
        {canToggleMore && (
          <button
            className="expand-btn"
            onClick={toggleShowMore}
            title={showMore ? 'Show less' : 'Show more'}
          >
            {showMore ? '−' : '+'}
          </button>
        )}
      </div>

      {/* 节点内容 */}
      <div className="node-content">
        {/* User 消息（默认短预览，展开后更长一点，但仍然不是全部） */}
        <div className="message user-message">
          <span className="message-role">👤</span>
          <span
            className="message-text"
            title={showMore
              ? truncate(data.userContent, EXPANDED_USER_LEN)
              : truncate(data.userContent, PREVIEW_USER_LEN)}
          >
            {showMore
              ? truncate(data.userContent, EXPANDED_USER_LEN)
              : truncate(data.userContent, PREVIEW_USER_LEN)}
          </span>
        </div>

        {/* Assistant 消息：默认不显示，展开后显示（同样只展示更多一点，而不是全部） */}
        {showMore && hasAssistant && (
          <div className="message assistant-message">
            <span className="message-role">🤖</span>
            <span
              className="message-text"
              title={truncate(data.assistantContent, EXPANDED_ASSISTANT_LEN)}
            >
              {truncate(data.assistantContent, EXPANDED_ASSISTANT_LEN)}
            </span>
          </div>
        )}
      </div>

      {/* 分支指示器 */}
      {data.branchCount > 1 && (
        <div className="branch-indicator" title={`${data.branchCount} branches`}>
          🌿 {data.branchCount}
        </div>
      )}

      {/* 底部连接点 */}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: colors.border }}
      />
    </div>
  );
}

export default memo(RoundNode);
