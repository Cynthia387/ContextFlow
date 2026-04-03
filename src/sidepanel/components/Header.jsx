/**
 * Minimal top toolbar (sidepanel only).
 *
 * User feedback:
 * - Remove verbose title/stats ("ContextFlow", branch counts, QA counts)
 * - Keep it clean: buttons only
 * - Must be responsive at narrow widths (no clipped buttons)
 */

import React from 'react';

const iconUrl = (name) => chrome.runtime.getURL(`assets/${name}`);

export default function Header({
  onRefresh,
  isLoading,
  viewMode = 'graph',
  onViewModeChange,
  miniMapVisible = false,
  onToggleMiniMap
}) {
  return (
    <header className="header header-toolbar" aria-label="ContextFlow toolbar">
      <div className="header-toolbar-left">
        <div className="view-toggle" role="tablist" aria-label="View mode">
          <button
            className={'view-toggle-btn' + (viewMode === 'graph' ? ' active' : '')}
            onClick={() => onViewModeChange?.('graph')}
            title="Graph"
            aria-label="Graph"
            type="button"
          >
            <img className="toolbar-icon" src={iconUrl('graph.svg')} alt="Graph" />
          </button>
          <button
            className={'view-toggle-btn' + (viewMode === 'tree' ? ' active' : '')}
            onClick={() => onViewModeChange?.('tree')}
            title="Tree"
            aria-label="Tree"
            type="button"
          >
            <img className="toolbar-icon" src={iconUrl('tree.svg')} alt="Tree" />
          </button>
        </div>
      </div>

      <div className="header-toolbar-right">
        {viewMode === 'graph' && typeof onToggleMiniMap === 'function' && (
          <button
            className={'minimap-btn' + (miniMapVisible ? ' active' : '')}
            onClick={onToggleMiniMap}
            title={miniMapVisible ? 'Hide minimap' : 'Show minimap'}
            aria-label={miniMapVisible ? 'Hide minimap' : 'Show minimap'}
            type="button"
          >
            <img className="toolbar-icon" src={iconUrl('minimap.svg')} alt="Minimap" />
          </button>
        )}
        <button
          className="refresh-btn icon-btn"
          onClick={onRefresh}
          disabled={isLoading}
          title="Refresh"
          aria-label="Refresh"
          type="button"
        >
          <span className={isLoading ? 'spinning' : ''}>
            <img className="toolbar-icon" src={iconUrl('fresh.svg')} alt="Refresh" />
          </span>
        </button>
      </div>
    </header>
  );
}
