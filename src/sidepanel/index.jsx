/**
 * Side Panel React 入口
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { STORAGE_KEYS } from '../shared/constants';

// 获取根元素
const container = document.getElementById('root');
const root = createRoot(container);

// If rendered inside the floating panel iframe, tighten spacing a bit
try {
  const params = new URLSearchParams(window.location.search);
  if (params.has('embedded')) {
    document.documentElement.classList.add('embedded');
  }
} catch {
  // ignore
}

/**
 * Apply sidepanel UI zoom (CSS zoom). This is independent from webpage zoom.
 * Note: we intentionally do NOT apply this in embedded mode (floating panel iframe).
 */
(() => {
  const isEmbedded = document.documentElement.classList.contains('embedded');
  if (isEmbedded) return;

  const clampZoom = (v) => {
    const z = Number(v);
    if (!Number.isFinite(z)) return 1;
    return Math.max(0.5, Math.min(2.5, z));
  };

  const applyZoom = (z) => {
    const zoom = clampZoom(z);
    // 'zoom' is supported in Chromium and reflows layout naturally.
    document.documentElement.style.zoom = String(zoom);
  };

  // Initial load
  try {
    chrome.storage.local.get(STORAGE_KEYS.SIDEPANEL_UI_ZOOM).then((res) => {
      applyZoom(res?.[STORAGE_KEYS.SIDEPANEL_UI_ZOOM] ?? 1);
    });
  } catch {
    // ignore
  }

  // Live updates
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (!changes?.[STORAGE_KEYS.SIDEPANEL_UI_ZOOM]) return;
      applyZoom(changes[STORAGE_KEYS.SIDEPANEL_UI_ZOOM].newValue ?? 1);
    });
  } catch {
    // ignore
  }
})();

// 渲染应用
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
