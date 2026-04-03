/**
 * 起始节点组件
 * 用于多根节点时显示的虚拟起始节点
 */
import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';

function StartNode({ data }) {
  const { colors } = data;

  return (
    <div
      className="start-node"
      style={{
        backgroundColor: colors?.bg || '#f1f5f9',
        borderColor: colors?.border || '#94a3b8'
      }}
    >
      <span className="start-node-icon">💬</span>
      <span className="start-node-text">Start</span>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: colors?.border || '#94a3b8',
          width: 8,
          height: 8
        }}
      />
    </div>
  );
}

export default memo(StartNode);
