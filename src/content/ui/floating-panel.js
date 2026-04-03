/**
 * Floating panel UI injected into ChatGPT page.
 *
 * Renders the extension sidepanel UI inside an iframe.
 *
 * Features:
 * - Borderless floating window (rounded + shadow)
 * - Drag to move
 * - Resize (custom handle)
 * - Opacity slider
 * - Minimize / restore
 * - Lock (pin) to prevent drag/resize
 * - Click-through mode (let mouse events pass to page)
 *   - includes a small peel handle to exit click-through
 * - Persist state in chrome.storage.local
 */

import { log, throttle } from '../../shared/utils.js';

const PANEL_ID = '__chatgpt_graph_floating_panel__';
const STYLE_ID = '__chatgpt_graph_floating_panel_style__';
const STORAGE_KEY = 'chatgpt_graph_floating_panel_state_v1';

const DEFAULT_STATE = {
  x: 24,
  y: 88,
  width: 420,
  height: 640,
  opacity: 0.96,
  minimized: false,
  locked: false,
  clickThrough: false,
  /**
   * User preference: hide the toolbar for a clean, distraction-free view.
   * Note: the toolbar is ALSO forced hidden while locked or in click-through.
   */
  controlsHidden: false
};

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

async function loadState() {
  try {
    const res = await chrome.storage.local.get([STORAGE_KEY]);
    const s = res?.[STORAGE_KEY];
    if (!s || typeof s !== 'object') return { ...DEFAULT_STATE };
    return {
      ...DEFAULT_STATE,
      ...s,
      opacity: clamp(Number(s.opacity ?? DEFAULT_STATE.opacity), 0.25, 1)
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

const saveState = throttle(async (partial) => {
  try {
    const res = await chrome.storage.local.get([STORAGE_KEY]);
    const prev = res?.[STORAGE_KEY] && typeof res[STORAGE_KEY] === 'object' ? res[STORAGE_KEY] : {};
    const next = { ...DEFAULT_STATE, ...prev, ...partial };
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
  } catch (e) {
    // ignore
  }
}, 120);

function ensureStyles() {
  // IMPORTANT: always update the style text so extension updates take effect
  // without requiring a hard refresh. Stale CSS is a frequent cause of
  // "overlap" regressions when the panel is re-injected.
  const existing = document.getElementById(STYLE_ID);
  const style = existing || document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${PANEL_ID} {
      position: fixed;
      z-index: 2147483646;
      border-radius: 14px;
      box-shadow: 0 10px 28px rgba(0,0,0,.18);
      background: rgba(255,255,255,.86);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      opacity: var(--cgAlpha, 0.96);
      transition: opacity .12s ease;
      overflow: hidden;
      resize: none;
      min-width: 280px;
      min-height: 240px;
      max-width: min(92vw, 840px);
      max-height: 92vh;
      display: flex;
      flex-direction: column;
      transform: translateZ(0);
      user-select: none;
    }
    #${PANEL_ID}.cg-controls-hidden .cg-header {
      display: none;
    }
    #${PANEL_ID}.cg-popover-open {
      overflow: visible;
    }
    #${PANEL_ID}.cg-minimized {
      height: 44px !important;
      min-height: 44px !important;
      resize: none;
      overflow: visible;
    }
    #${PANEL_ID}.cg-locked {
      resize: none;
    }

    /* ============================================================
       Header layout: flex-start + margin-left:auto (no space-between)
       This prevents negative gap / overlap issues at narrow widths.
    ============================================================ */
    #${PANEL_ID} .cg-header {
      height: 40px;
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: var(--cg-gap, 8px);
      padding: 0 var(--cg-pad, 10px);
      background: rgba(255,255,255,.90);
      border-bottom: 1px solid rgba(15, 23, 42, .08);
      cursor: grab;
      flex-wrap: nowrap;
      white-space: nowrap;
      overflow: hidden;
    }
    #${PANEL_ID}.cg-locked .cg-header {
      cursor: default;
    }
    #${PANEL_ID} .cg-bar-left {
      display: flex;
      align-items: center;
      gap: var(--cg-gap, 6px);
      cursor: default;
      min-width: 0;
      flex-shrink: 0;
    }
    #${PANEL_ID} .cg-bar-right {
      display: flex;
      align-items: center;
      gap: var(--cg-gap, 6px);
      cursor: default;
      min-width: 0;
      flex-shrink: 0;
      margin-left: auto;
    }

    /* ============================================================
       Responsive compact levels (overflow-driven)
       Level 0: default
       Level 1: shrink sizes/gaps
       Level 2: hide refresh
       Level 3: hide refresh + minimap
       Level 4: hide refresh + minimap + opacity
    ============================================================ */
    #${PANEL_ID}[data-cg-compact="1"] {
      --cg-gap: 4px;
      --cg-pad: 8px;
      --cg-btn: 26px;
      --cg-view-btn: 26px;
      --cg-slider: 56px;
    }
    #${PANEL_ID}[data-cg-compact="2"] {
      --cg-gap: 4px;
      --cg-pad: 8px;
      --cg-btn: 26px;
      --cg-view-btn: 26px;
      --cg-slider: 56px;
    }
    #${PANEL_ID}[data-cg-compact="2"] .cg-header [data-action="refresh"] {
      display: none !important;
    }
    #${PANEL_ID}[data-cg-compact="3"] {
      --cg-gap: 4px;
      --cg-pad: 8px;
      --cg-btn: 26px;
      --cg-view-btn: 26px;
      --cg-slider: 56px;
    }
    #${PANEL_ID}[data-cg-compact="3"] .cg-header [data-action="refresh"] {
      display: none !important;
    }
    #${PANEL_ID}[data-cg-compact="3"] .cg-header [data-action="minimap"] {
      display: none !important;
    }
    #${PANEL_ID}[data-cg-compact="4"] {
      --cg-gap: 4px;
      --cg-pad: 6px;
      --cg-btn: 24px;
      --cg-view-btn: 24px;
    }
    #${PANEL_ID}[data-cg-compact="4"] .cg-header [data-action="refresh"] {
      display: none !important;
    }
    #${PANEL_ID}[data-cg-compact="4"] .cg-header [data-action="minimap"] {
      display: none !important;
    }
    #${PANEL_ID}[data-cg-compact="4"] .cg-header .cg-opacity {
      display: none !important;
    }

    /* NOTE: Do NOT hide the view toggle in compact mode.
       Users want Graph/Tree switching always visible, even at minimum size. */

    #${PANEL_ID} .cg-view-toggle {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      background: rgba(241, 245, 249, .92);
      border: 1px solid rgba(15, 23, 42, .10);
      border-radius: 10px;
      flex-shrink: 0;
    }
    #${PANEL_ID} .cg-view-btn {
      width: var(--cg-view-btn, 30px);
      height: var(--cg-view-btn, 30px);
      border: none;
      background: transparent;
      border-radius: 8px;
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background-color 0.15s ease, box-shadow 0.15s ease;
    }
    #${PANEL_ID} .cg-icon {
      width: 16px;
      height: 16px;
      opacity: 0.7;
      transition: opacity 0.15s ease;
    }
    #${PANEL_ID} .cg-btn:hover .cg-icon,
    #${PANEL_ID} .cg-view-btn:hover .cg-icon {
      opacity: 0.9;
    }
    #${PANEL_ID} .cg-btn.cg-active .cg-icon,
    #${PANEL_ID} .cg-view-btn.cg-active .cg-icon {
      opacity: 1;
    }
    #${PANEL_ID} .cg-view-btn:hover {
      background: rgba(255,255,255,0.7);
    }
    #${PANEL_ID} .cg-view-btn.cg-active {
      background: rgba(255,255,255,0.96);
      box-shadow: 0 2px 10px rgba(0,0,0,0.10);
    }
    #${PANEL_ID} .cg-btn {
      width: var(--cg-btn, 28px);
      height: var(--cg-btn, 28px);
      border: 1px solid rgba(15, 23, 42, .10);
      background: rgba(255, 255, 255, .86);
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background .12s ease, border-color .12s ease;
    }
    #${PANEL_ID} .cg-btn:hover {
      background: rgba(248, 250, 252, .96);
      border-color: rgba(15, 23, 42, .18);
    }
    #${PANEL_ID} .cg-btn.cg-active {
      border-color: rgba(37, 99, 235, .45);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, .14);
    }
    #${PANEL_ID} .cg-opacity {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0 8px;
      border: 1px solid rgba(15, 23, 42, .10);
      border-radius: 999px;
      background: rgba(255,255,255,.86);
      height: var(--cg-btn, 28px);
      /* Allow the opacity control to shrink a bit before we start hiding things. */
      flex: 0 1 auto;
      min-width: 0;
    }
    #${PANEL_ID} .cg-opacity input[type="range"] {
      width: var(--cg-slider, 70px);
      min-width: 56px;
      accent-color: #2563eb;
    }

    #${PANEL_ID} .cg-body {
      flex: 1 1 auto;
      min-height: 0;
    }
    #${PANEL_ID}.cg-minimized .cg-body {
      display: none;
    }
    #${PANEL_ID} iframe {
      width: 100%;
      height: 100%;
      border: none;
      background: transparent;
    }

    #${PANEL_ID} .cg-resizer {
      position: absolute;
      right: 4px;
      bottom: 4px;
      width: 18px;
      height: 18px;
      border-radius: 8px;
      cursor: nwse-resize;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0.12;
      transition: opacity .12s ease;
      z-index: 2;
      background: rgba(255,255,255,0.35);
      border: 1px solid rgba(15, 23, 42, .10);
      pointer-events: auto;
    }
    #${PANEL_ID}:hover .cg-resizer {
      opacity: 0.55;
    }
    #${PANEL_ID} .cg-resizer:hover {
      opacity: 0.9;
    }
    #${PANEL_ID} .cg-resizer::before {
      content: '';
      width: 10px;
      height: 10px;
      border-right: 2px solid rgba(15, 23, 42, .35);
      border-bottom: 2px solid rgba(15, 23, 42, .35);
      border-radius: 1px;
      transform: translate(1px, 1px);
    }
    #${PANEL_ID}.cg-locked .cg-resizer,
    #${PANEL_ID}.cg-minimized .cg-resizer,
    #${PANEL_ID}.cg-through .cg-resizer {
      display: none;
    }

    /* Mini bar (when main toolbar hidden) */
    #${PANEL_ID} .cg-mini-bar {
      height: 30px;
      flex: 0 0 auto;
      display: none;
      align-items: center;
      justify-content: flex-start;
      gap: 8px;
      padding: 0 10px;
      background: rgba(255,255,255,.90);
      border-bottom: 1px solid rgba(15, 23, 42, .08);
      cursor: grab;
    }
    #${PANEL_ID}.cg-locked .cg-mini-bar {
      cursor: default;
    }
    #${PANEL_ID}.cg-controls-hidden:not(.cg-tree-search-expanded) .cg-mini-bar {
      display: flex;
    }
    #${PANEL_ID}.cg-through .cg-mini-bar {
      display: none;
    }
    #${PANEL_ID} .cg-mini-left {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #${PANEL_ID} .cg-mini-right {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-left: auto;
    }

    #${PANEL_ID} .cg-popover {
      position: absolute;
      top: 10px;
      left: 10px;
      right: 10px;
      padding: 10px;
      border-radius: 14px;
      border: 1px solid rgba(15, 23, 42, .12);
      background: rgba(255,255,255,.94);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      box-shadow: 0 14px 34px rgba(0,0,0,.20);
      display: none;
      z-index: 4;
    }
    #${PANEL_ID}.cg-popover-open .cg-popover {
      display: block;
    }

    #${PANEL_ID} .cg-popover-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    #${PANEL_ID} .cg-popover-row + .cg-popover-row {
      margin-top: 10px;
    }
    #${PANEL_ID} .cg-popover-left {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1 1 auto;
      min-width: 0;
    }
    #${PANEL_ID} .cg-popover-right {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 0 0 auto;
    }
    #${PANEL_ID} .cg-popover-label {
      font: 600 12px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      color: rgba(15, 23, 42, .86);
      white-space: nowrap;
    }
    #${PANEL_ID}.cg-through {
      pointer-events: none;
    }
    #${PANEL_ID}.cg-through .cg-peel {
      pointer-events: auto;
    }
    #${PANEL_ID}.cg-through .cg-popover {
      display: none !important;
    }
    #${PANEL_ID} .cg-peel {
      position: absolute;
      top: 10px;
      left: 10px;
      width: 28px;
      height: 28px;
      border-radius: 10px;
      border: 1px solid rgba(15, 23, 42, .12);
      background: rgba(255, 255, 255, .92);
      box-shadow: 0 8px 22px rgba(0,0,0,.18);
      display: none;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 2;
    }
    #${PANEL_ID}.cg-through .cg-peel {
      display: flex;
    }

  `.trim();

  if (!existing) document.documentElement.appendChild(style);
}

function getPanelEl() {
  return document.getElementById(PANEL_ID);
}

function applyState(panel, state) {
  panel.style.left = `${state.x}px`;
  panel.style.top = `${state.y}px`;
  panel.style.width = `${state.width}px`;
  panel.style.height = `${state.height}px`;
  panel.style.setProperty('--cgAlpha', String(state.opacity));
  panel.classList.toggle('cg-minimized', !!state.minimized);
  panel.classList.toggle('cg-locked', !!state.locked);
  panel.classList.toggle('cg-through', !!state.clickThrough);

  // Effective toolbar visibility: user-hidden OR forced hidden while locked / click-through.
  const effectiveHidden = !!state.controlsHidden || !!state.locked || !!state.clickThrough;
  panel.classList.toggle('cg-controls-hidden', effectiveHidden);

  panel.querySelectorAll('[data-action="lock"]').forEach((btn) => {
    btn.classList.toggle('cg-active', !!state.locked);
  });
  panel.querySelectorAll('[data-action="through"]').forEach((btn) => {
    btn.classList.toggle('cg-active', !!state.clickThrough);
  });
  panel.querySelectorAll('[data-action="toggleToolbar"]').forEach((btn) => {
    btn.classList.toggle('cg-active', !effectiveHidden);
  });

  // Keep both opacity sliders (header + popover) in sync.
  panel.querySelectorAll('input[data-action="opacity"]').forEach((input) => {
    const v = String(state.opacity);
    if (input.value !== v) input.value = v;
  });

  try {
    panel.__cgAfterApplyState?.(state);
  } catch {
    // ignore
  }

  // Native resize is disabled; custom resizer handle is hidden via CSS when locked/minimized.
  panel.style.resize = 'none';
}

function keepOnScreen(state) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = clamp(state.width, 280, Math.min(840, Math.floor(vw * 0.92)));
  const h = clamp(state.height, 240, Math.floor(vh * 0.92));
  const x = clamp(state.x, 8, Math.max(8, vw - w - 8));
  const y = clamp(state.y, 8, Math.max(8, vh - h - 8));
  return { ...state, x, y, width: w, height: h };
}

function setupDragging(panel, dragEl, getState, setState) {
  if (!dragEl) return;

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;

  const isInteractive = (el) => {
    if (!el) return false;
    return (
      el.closest('button') ||
      el.closest('input') ||
      el.closest('select') ||
      el.closest('a')
    );
  };

  dragEl.addEventListener('pointerdown', (e) => {
    const state = getState();
    if (state.locked) return;
    if (isInteractive(e.target)) return;
    dragging = true;
    dragEl.setPointerCapture(e.pointerId);
    startX = e.clientX;
    startY = e.clientY;
    originX = state.x;
    originY = state.y;
    dragEl.style.cursor = 'grabbing';
    e.preventDefault();
  });

  dragEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const next = keepOnScreen({ ...getState(), x: originX + dx, y: originY + dy });
    setState(next);
    applyState(panel, next);
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    dragEl.style.cursor = '';
    const s = getState();
    saveState({ x: s.x, y: s.y });
  };

  dragEl.addEventListener('pointerup', endDrag);
  dragEl.addEventListener('pointercancel', endDrag);
}

function setupResizePersistence(panel, getState, setState) {
  let initialized = false;
  const ro = new ResizeObserver(() => {
    const s = getState();
    if (s.minimized || s.locked) return;

    const rect = panel.getBoundingClientRect();
    const newWidth = Math.round(rect.width);
    const newHeight = Math.round(rect.height);

    // Skip the initial trigger - we don't want to overwrite the loaded state
    // with the default/computed size before the panel is fully rendered.
    if (!initialized) {
      initialized = true;
      // Only skip if the size matches what we already have in state
      // (meaning applyState worked correctly)
      if (Math.abs(newWidth - s.width) < 2 && Math.abs(newHeight - s.height) < 2) {
        return;
      }
    }

    // Only update if size actually changed (avoid unnecessary saves)
    if (Math.abs(newWidth - s.width) < 2 && Math.abs(newHeight - s.height) < 2) {
      return;
    }

    const next = keepOnScreen({ ...s, width: newWidth, height: newHeight });
    setState(next);
    // IMPORTANT: when resizing hits the viewport bounds, we may need to
    // adjust x/y to keep the toolbar (and the whole panel) on screen.
    applyState(panel, next);
    saveState({ width: next.width, height: next.height, x: next.x, y: next.y });
  });
  ro.observe(panel);
}

function buildPanel(state, setState, getState) {
  ensureStyles();

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'ContextFlow floating panel');
  panel.dataset.cgCompact = '0';

  const header = document.createElement('div');
  header.className = 'cg-header';
  const iconUrl = (name) => chrome.runtime.getURL(`assets/${name}`);
  header.innerHTML = `
    <div class="cg-bar-left">
      <div class="cg-view-toggle" role="tablist" aria-label="View mode">
        <button class="cg-view-btn" data-action="view" data-mode="graph" title="Graph"><img class="cg-icon" src="${iconUrl('graph.svg')}" alt="Graph"></button>
        <button class="cg-view-btn" data-action="view" data-mode="tree" title="Tree"><img class="cg-icon" src="${iconUrl('tree.svg')}" alt="Tree"></button>
      </div>
      <button class="cg-btn" data-action="refresh" title="Refresh"><img class="cg-icon" src="${iconUrl('fresh.svg')}" alt="Refresh"></button>
      <button class="cg-btn cg-minimap-btn" data-action="minimap" title="Toggle minimap" style="display:none;"><img class="cg-icon" src="${iconUrl('minimap.svg')}" alt="Minimap"></button>
    </div>
    <div class="cg-bar-right">
      <button class="cg-btn cg-search" data-action="search" title="Search" aria-label="Search" style="display:none;"><img class="cg-icon" src="${iconUrl('search.svg')}" alt="Search"></button>
      <div class="cg-opacity" title="Opacity">
        <span style="font-size:12px; opacity:.85;">α</span>
        <input data-action="opacity" type="range" min="0.25" max="1" step="0.05" value="${state.opacity}">
      </div>
      <button class="cg-btn" data-action="controls" title="Controls"><img class="cg-icon" src="${iconUrl('setting.svg')}" alt="Controls"></button>
      <button class="cg-btn" data-action="hideToolbar" title="Hide toolbar"><img class="cg-icon" src="${iconUrl('down.svg')}" alt="Hide"></button>
      <button class="cg-btn" data-action="close" title="Close (Esc)"><img class="cg-icon" src="${iconUrl('close.svg')}" alt="Close"></button>
    </div>
  `.trim();

  // Mini bar: shown when the main toolbar is hidden.
  // Keeps the window draggable and exposes:
  // - Search button (only when tree search row is collapsed)
  // - Show toolbar button
  const miniBar = document.createElement('div');
  miniBar.className = 'cg-mini-bar';
  miniBar.innerHTML = `
    <div class="cg-mini-left">
      <button class="cg-btn cg-mini-search" data-action="search" title="Search" aria-label="Search" style="display:none;"><img class="cg-icon" src="${iconUrl('search.svg')}" alt="Search"></button>
    </div>
    <div class="cg-mini-right">
      <button class="cg-btn" data-action="showToolbar" title="Show toolbar" aria-label="Show toolbar"><img class="cg-icon" src="${iconUrl('control.svg')}" alt="Show"></button>
      <button class="cg-btn" data-action="close" title="Close"><img class="cg-icon" src="${iconUrl('close.svg')}" alt="Close"></button>
    </div>
  `.trim();

  const body = document.createElement('div');
  body.className = 'cg-body';

  const iframe = document.createElement('iframe');
  // Pass a hint to the UI so it can tighten spacing if needed.
  iframe.src = chrome.runtime.getURL('src/sidepanel/index.html?embedded=1');
  iframe.loading = 'lazy';
  iframe.allow = 'clipboard-read; clipboard-write';
  body.appendChild(iframe);

  const peel = document.createElement('button');
  peel.className = 'cg-peel'; 
  peel.title = 'Exit click-through (Alt+Shift+T)';
  peel.innerHTML = `<img class="cg-icon" src="${iconUrl('transparency.svg')}" alt="Click-through">`;

  const popover = document.createElement('div');
  popover.className = 'cg-popover';
  popover.innerHTML = `
    <div class="cg-popover-row">
      <div class="cg-popover-left">
        <span class="cg-popover-label">View</span>
        <div class="cg-view-toggle" role="tablist" aria-label="View mode">
          <button class="cg-view-btn" data-action="view" data-mode="graph" title="Graph"><img class="cg-icon" src="${iconUrl('graph.svg')}" alt="Graph"></button>
          <button class="cg-view-btn" data-action="view" data-mode="tree" title="Tree"><img class="cg-icon" src="${iconUrl('tree.svg')}" alt="Tree"></button>
        </div>
      </div>
      <div class="cg-popover-right">
        <button class="cg-btn" data-action="refresh" title="Refresh"><img class="cg-icon" src="${iconUrl('fresh.svg')}" alt="Refresh"></button>
        <button class="cg-btn" data-action="closePopover" title="Close"><img class="cg-icon" src="${iconUrl('close.svg')}" alt="Close"></button>
      </div>
    </div>
    <div class="cg-popover-row">
      <div class="cg-popover-left">
        <span class="cg-popover-label">Opacity</span>
        <div class="cg-opacity" title="Opacity">
          <span style="font-size:12px; opacity:.85;">α</span>
          <input data-action="opacity" type="range" min="0.25" max="1" step="0.05" value="${state.opacity}">
        </div>
      </div>
      <div class="cg-popover-right">
        <button class="cg-btn" data-action="toggleToolbar" title="Toggle toolbar"><img class="cg-icon" src="${iconUrl('control.svg')}" alt="Toolbar"></button>
      </div>
    </div>
    <div class="cg-popover-row">
      <div class="cg-popover-left">
        <span class="cg-popover-label">Window</span>
      </div>
      <div class="cg-popover-right">
        <button class="cg-btn" data-action="lock" title="Lock / Unlock (Alt+Shift+L)"><img class="cg-icon" src="${iconUrl('stick.svg')}" alt="Lock"></button>
        <button class="cg-btn" data-action="through" title="Click-through (Alt+Shift+T)"><img class="cg-icon" src="${iconUrl('transparency.svg')}" alt="Click-through"></button>
        <button class="cg-btn" data-action="minimize" title="Minimize / Restore"><img class="cg-icon" src="${iconUrl('minimize.svg')}" alt="Minimize"></button>
        <button class="cg-btn" data-action="close" title="Close (Esc)"><img class="cg-icon" src="${iconUrl('close.svg')}" alt="Close"></button>
      </div>
    </div>
  `.trim();

  panel.appendChild(header);
  panel.appendChild(miniBar);
  panel.appendChild(body);
  panel.appendChild(peel);
  const resizer = document.createElement('div');
  resizer.className = 'cg-resizer';
  resizer.title = 'Resize';
  panel.appendChild(resizer);
  panel.appendChild(popover);

  const closePopover = () => {
    panel.classList.remove('cg-popover-open');
  };
  const openPopover = () => {
    if (getState().clickThrough) return;
    panel.classList.add('cg-popover-open');
  };
  const togglePopover = () => {
    if (panel.classList.contains('cg-popover-open')) closePopover();
    else openPopover();
  };

  const postToIframe = (type, payload = {}) => {
    try {
      if (!iframe.contentWindow) return;
      iframe.contentWindow.postMessage({ type, payload }, '*');
    } catch {
      // ignore
    }
  };

  // ------------------------------------------------------------
  // Quick UI state (tree search collapsed, minimap visibility)
  // ------------------------------------------------------------
  const headerSearchBtn = header.querySelector('[data-action="search"]');
  const miniSearchBtn = miniBar.querySelector('[data-action="search"]');
  const headerMinimapBtn = header.querySelector('[data-action="minimap"]');
  let currentViewMode = 'graph';
  let treeToolbarCollapsed = false;
  let minimapVisible = false;

  // ------------------------------------------------------------
  // Header responsiveness: overflow-driven + hysteresis
  // ------------------------------------------------------------
  let currentCompactLevel = 0;
  let compactUpdateScheduled = false;
  const HYSTERESIS_SLACK = 14; // px slack required before allowing downgrade
  const OVERFLOW_TOL = 1; // tolerate 1px rounding
  const MIN_GROUP_GAP = 2; // px - avoid visual/actual overlap

  const getHeaderMetrics = () => {
    const headerEl = panel.querySelector('.cg-header');
    if (!headerEl) return null;
    const left = headerEl.querySelector('.cg-bar-left');
    const right = headerEl.querySelector('.cg-bar-right');
    return { headerEl, left, right };
  };

  const isTooTight = (m) => {
    if (!m) return false;
    const { headerEl, left, right } = m;
    const overflow = headerEl.scrollWidth - headerEl.clientWidth;
    if (overflow > OVERFLOW_TOL) return true;
    // Extra safety: detect near-overlap between left and right groups.
    // This catches cases where scrollWidth isn't reliable due to layout quirks.
    if (left && right) {
      const lr = left.getBoundingClientRect();
      const rr = right.getBoundingClientRect();
      const gap = rr.left - lr.right;
      if (gap < MIN_GROUP_GAP) return true;
    }
    return false;
  };

  const hasSlackForLevel = (testLevel, m) => {
    if (!m) return false;
    const { headerEl, left, right } = m;
    // Must fit, and have extra slack so we don't bounce at the boundary.
    const overflow = headerEl.scrollWidth - headerEl.clientWidth;
    if (overflow > OVERFLOW_TOL) return false;
    // NOTE: scrollWidth is clamped to at least clientWidth, so "clientWidth - scrollWidth"
    // is almost always 0 and cannot be used to estimate available slack.
    // Instead, use real geometry: require extra GAP between groups before relaxing.
    if (left && right) {
      const lr = left.getBoundingClientRect();
      const rr = right.getBoundingClientRect();
      const gap = rr.left - lr.right;
      if (gap < MIN_GROUP_GAP + HYSTERESIS_SLACK) return false;
    }
    return true;
  };

  const applyCompactLevel = (lv) => {
    panel.dataset.cgCompact = String(lv);
    currentCompactLevel = lv;
  };

  const updateHeaderCompact = () => {
    // If the header is hidden, no need to compute.
    if (panel.classList.contains('cg-controls-hidden')) {
      applyCompactLevel(0);
      return;
    }

    const m0 = getHeaderMetrics();
    if (!m0) return;

    // Ensure current level is applied before measuring.
    panel.dataset.cgCompact = String(currentCompactLevel);
    void m0.headerEl.offsetWidth;

    // Tighten step-by-step until it fits or we hit max.
    while (currentCompactLevel < 4) {
      const m = getHeaderMetrics();
      if (!isTooTight(m)) break;
      applyCompactLevel(currentCompactLevel + 1);
      void m.headerEl.offsetWidth;
    }

    // Relax step-by-step, but only if we have enough slack (hysteresis).
    while (currentCompactLevel > 0) {
      const test = currentCompactLevel - 1;
      panel.dataset.cgCompact = String(test);
      const m = getHeaderMetrics();
      if (!m) {
        panel.dataset.cgCompact = String(currentCompactLevel);
        break;
      }
      void m.headerEl.offsetWidth;
      if (hasSlackForLevel(test, m)) {
        currentCompactLevel = test;
        continue;
      }
      // Not enough slack: revert and stop.
      panel.dataset.cgCompact = String(currentCompactLevel);
      break;
    }
  };

  const scheduleCompactUpdate = () => {
    if (compactUpdateScheduled) return;
    compactUpdateScheduled = true;
    requestAnimationFrame(() => {
      compactUpdateScheduled = false;
      updateHeaderCompact();
    });
  };

  // ResizeObserver to track panel width changes
  const panelResizeObserver = new ResizeObserver(() => {
    scheduleCompactUpdate();
  });
  panelResizeObserver.observe(panel);

  const updateSearchButtons = (s = getState()) => {
    const effectiveHidden = !!s.controlsHidden || !!s.locked || !!s.clickThrough;
    const shouldShow = currentViewMode === 'tree' && !!treeToolbarCollapsed;

    if (headerSearchBtn) {
      headerSearchBtn.style.display = !effectiveHidden && shouldShow ? 'inline-flex' : 'none';
    }
    if (miniSearchBtn) {
      miniSearchBtn.style.display = effectiveHidden && shouldShow ? 'inline-flex' : 'none';
    }
  };

  const updateMinimapButton = () => {
    if (headerMinimapBtn) {
      // Only show minimap button in graph mode
      headerMinimapBtn.style.display = currentViewMode === 'graph' ? 'inline-flex' : 'none';
      headerMinimapBtn.classList.toggle('cg-active', minimapVisible);
    }
  };

  // Let applyState call back into this so visibility updates whenever controls are hidden/shown.
  panel.__cgAfterApplyState = (s) => {
    updateSearchButtons(s);
    scheduleCompactUpdate();
    // Notify iframe about controls visibility state
    const effectiveHidden = !!s.controlsHidden || !!s.locked || !!s.clickThrough;
    postToIframe('CG_CONTROLS_STATE', { hidden: effectiveHidden });
  };

  const setActiveViewMode = (mode) => {
    currentViewMode = String(mode || 'graph');
    panel.querySelectorAll('[data-action="view"]').forEach((btn) => {
      btn.classList.toggle('cg-active', btn.dataset.mode === currentViewMode);
    });
    // Update tree-search-expanded class based on current view mode
    panel.classList.toggle('cg-tree-search-expanded', !treeToolbarCollapsed && currentViewMode === 'tree');
    updateSearchButtons();
    updateMinimapButton();
    scheduleCompactUpdate();
  };

  // Try to sync initial view mode from the embedded UI
  iframe.addEventListener('load', () => {
    postToIframe('CG_REQUEST_VIEW_MODE', {});
    postToIframe('CG_REQUEST_MINIMAP_STATE', {});
    // Send initial controls state
    const s = getState();
    const effectiveHidden = !!s.controlsHidden || !!s.locked || !!s.clickThrough;
    postToIframe('CG_CONTROLS_STATE', { hidden: effectiveHidden });
  });

  // Listen for view mode updates from iframe
  const msgHandler = (e) => {
    if (e?.source !== iframe.contentWindow) return;
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'CG_VIEW_MODE' && data.payload?.mode) {
      setActiveViewMode(String(data.payload.mode));
      return;
    }

    if (data.type === 'CG_TREE_TOOLBAR_STATE') {
      treeToolbarCollapsed = !!data.payload?.collapsed;
      // Update class to control mini-bar visibility
      panel.classList.toggle('cg-tree-search-expanded', !treeToolbarCollapsed && currentViewMode === 'tree');
      updateSearchButtons();
      scheduleCompactUpdate();
    }

    // Handle minimap visibility state from iframe
    if (data.type === 'CG_MINIMAP_STATE') {
      minimapVisible = !!data.payload?.visible;
      updateMinimapButton();
    }

    // Handle request to show the main toolbar (from embedded search bar)
    if (data.type === 'CG_SHOW_TOOLBAR') {
      const s = getState();
      if (s.locked) {
        // If locked, open the popover so user can unlock
        openPopover();
      } else {
        const next = { ...s, controlsHidden: false };
        setState(next);
        applyState(panel, next);
        saveState({ controlsHidden: false });
      }
    }

    // Handle request to close the floating panel (from embedded UI)
    if (data.type === 'CG_CLOSE_PANEL') {
      closeFloatingPanel();
    }
  };
  panel.__cgMsgHandler = msgHandler;
  window.addEventListener('message', msgHandler);

  // Wire actions
  panel.querySelectorAll('[data-action="close"]').forEach((btn) => {
    btn.addEventListener('click', () => closeFloatingPanel());
  });

  panel.querySelectorAll('[data-action="minimize"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      closePopover();
      const next = { ...getState(), minimized: !getState().minimized };
      setState(next);
      applyState(panel, next);
      saveState({ minimized: next.minimized });
    });
  });

  panel.querySelectorAll('[data-action="lock"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      // When locking, auto-hide controls (as requested) and close the control bar.
      const next = { ...getState(), locked: !getState().locked };
      setState(next);
      closePopover();
      applyState(panel, next);
      saveState({ locked: next.locked });
    });
  });

  panel.querySelectorAll('[data-action="through"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = { ...getState(), clickThrough: !getState().clickThrough };
      setState(next);
      closePopover();
      applyState(panel, next);
      saveState({ clickThrough: next.clickThrough });
    });
  });

  peel.addEventListener('click', () => {
    const next = { ...getState(), clickThrough: false };
    setState(next);
    applyState(panel, next);
    saveState({ clickThrough: false });
  });

  panel.querySelectorAll('[data-action="opacity"]').forEach((input) => {
    input.addEventListener('input', (e) => {
      const v = clamp(Number(e.target.value), 0.25, 1);
      const next = { ...getState(), opacity: v };
      setState(next);
      applyState(panel, next);
      saveState({ opacity: v });
    });
  });

  panel.querySelectorAll('[data-action="refresh"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      closePopover();
      postToIframe('CG_REFRESH', {});
    });
  });

  // Minimap toggle button
  panel.querySelectorAll('[data-action="minimap"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      postToIframe('CG_TOGGLE_MINIMAP', {});
    });
  });

  panel.querySelectorAll('[data-action="view"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const mode = btn.dataset.mode;
      if (!mode) return;
      setActiveViewMode(mode);
      postToIframe('CG_SET_VIEW_MODE', { mode });
      e.stopPropagation();
    });
  });

  header.querySelector('[data-action="controls"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopover();
  });
  panel.querySelectorAll('[data-action="closePopover"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closePopover();
    });
  });

  header.querySelector('[data-action="hideToolbar"]')?.addEventListener('click', () => {
    closePopover();
    const next = { ...getState(), controlsHidden: true };
    setState(next);
    applyState(panel, next);
    saveState({ controlsHidden: true });
  });

  panel.querySelectorAll('[data-action="toggleToolbar"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = { ...getState(), controlsHidden: !getState().controlsHidden };
      setState(next);
      applyState(panel, next);
      saveState({ controlsHidden: next.controlsHidden });
    });
  });

  // Search button (shown when the embedded tree search row is collapsed).
  // Both the header and the mini bar use the same action.
  const runSearch = () => {
    closePopover();
    postToIframe('CG_TREE_FOCUS_SEARCH', {});
  };
  panel.querySelectorAll('[data-action="search"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      runSearch();
    });
  });

  // Mini bar: restore the main toolbar.
  // If the toolbar is hidden because the panel is locked, open the popover so the user can unlock.
  miniBar.querySelector('[data-action="showToolbar"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const s = getState();
    if (s.locked) {
      openPopover();
      return;
    }
    const next = { ...s, controlsHidden: false };
    setState(next);
    applyState(panel, next);
    saveState({ controlsHidden: false });
  });

  // Custom resize handle (bottom-right)
  let resizing = false;
  let rStartX = 0;
  let rStartY = 0;
  let rStartW = 0;
  let rStartH = 0;

  const startResize = (e) => {
    const s = getState();
    if (s.locked || s.minimized || s.clickThrough) return;
    closePopover();
    resizing = true;
    const rect = panel.getBoundingClientRect();
    rStartX = e.clientX;
    rStartY = e.clientY;
    rStartW = rect.width;
    rStartH = rect.height;
    try {
      resizer.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    // Avoid selecting text / triggering drag.
    e.preventDefault();
    e.stopPropagation();
  };

  const onResizeMove = (e) => {
    if (!resizing) return;
    if (e.buttons !== 1) return;
    const dx = e.clientX - rStartX;
    const dy = e.clientY - rStartY;
    const s = getState();
    const next = keepOnScreen({
      ...s,
      width: Math.round(rStartW + dx),
      height: Math.round(rStartH + dy)
    });
    setState(next);
    applyState(panel, next);
    e.preventDefault();
  };

  const endResize = () => {
    if (!resizing) return;
    resizing = false;
    const s = getState();
    saveState({ width: s.width, height: s.height, x: s.x, y: s.y });
  };

  resizer.addEventListener('pointerdown', startResize);
  resizer.addEventListener('pointermove', onResizeMove);
  resizer.addEventListener('pointerup', endResize);
  resizer.addEventListener('pointercancel', endResize);
  resizer.addEventListener('lostpointercapture', endResize);

  // Clicking outside closes the popover (but not the floating panel)
  const docPointerHandler = (e) => {
    if (!panel.classList.contains('cg-popover-open')) return;
    if (popover.contains(e.target)) return;
    const menu = header.querySelector('[data-action="controls"]');
    if (menu && menu.contains(e.target)) return;
    closePopover();
  };
  panel.__cgDocPointerHandler = docPointerHandler;
  document.addEventListener('pointerdown', docPointerHandler, true);

  // Dragging + resize persistence
  // Drag handles: full header when visible, and the mini bar when controls are hidden.
  setupDragging(panel, header, getState, setState);
  setupDragging(panel, miniBar, getState, setState);
  setupResizePersistence(panel, getState, setState);

  // Escape closes (only when panel exists)
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeFloatingPanel();
    }
  };
  panel.__cgEscHandler = escHandler;
  window.addEventListener('keydown', escHandler, { capture: true });

  // Store ResizeObserver for cleanup
  panel.__cgPanelResizeObserver = panelResizeObserver;

  // Apply initial
  applyState(panel, state);

  // Expose state accessors for hotkey actions
  panel.__cgGetState = getState;
  panel.__cgSetState = setState;

  return panel;
}

export async function ensureFloatingPanel() {
  const existing = getPanelEl();
  if (existing) return existing;

  let state = keepOnScreen(await loadState());
  const getState = () => state;
  const setState = (next) => {
    state = next;
  };

  const panel = buildPanel(state, setState, getState);
  document.documentElement.appendChild(panel);
  await saveState({ ...state });
  log('info', 'FloatingPanel', 'Panel created');
  return panel;
}

export function closeFloatingPanel() {
  const panel = getPanelEl();
  if (!panel) return;
  try {
    if (panel.__cgEscHandler) {
      window.removeEventListener('keydown', panel.__cgEscHandler, { capture: true });
    }
    if (panel.__cgMsgHandler) {
      window.removeEventListener('message', panel.__cgMsgHandler);
    }
    if (panel.__cgDocPointerHandler) {
      document.removeEventListener('pointerdown', panel.__cgDocPointerHandler, true);
    }
    if (panel.__cgPanelResizeObserver) {
      panel.__cgPanelResizeObserver.disconnect();
    }
  } catch {
    // ignore
  }
  panel.remove();
  log('info', 'FloatingPanel', 'Panel closed');
}

export async function toggleFloatingPanel() {
  const panel = getPanelEl();
  if (panel) {
    closeFloatingPanel();
    return false;
  }
  await ensureFloatingPanel();
  return true;
}

export async function toggleClickThrough() {
  const panel = getPanelEl();
  if (!panel) return;
  const state = panel.__cgGetState ? panel.__cgGetState() : keepOnScreen(await loadState());
  const next = keepOnScreen({ ...state, clickThrough: !state.clickThrough });
  panel.__cgSetState?.(next);
  if (next.clickThrough) panel.classList.remove('cg-popover-open');
  applyState(panel, next);
  await saveState({ clickThrough: next.clickThrough });
}

export async function toggleLock() {
  const panel = getPanelEl();
  if (!panel) return;
  const state = panel.__cgGetState ? panel.__cgGetState() : keepOnScreen(await loadState());
  const next = keepOnScreen({ ...state, locked: !state.locked });
  panel.__cgSetState?.(next);
  if (next.locked) panel.classList.remove('cg-popover-open');
  applyState(panel, next);
  await saveState({ locked: next.locked });
}
