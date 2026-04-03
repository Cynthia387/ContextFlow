/**
 * Git-tree style QA view.
 *
 * Requirements implemented:
 * - Two modes switchable (done in Header/App)
 * - Git-tree mode is more直观, supports click-jump
 * - Default only show Q nodes; only show A nodes when a Q has multiple answers
 * - If a Q has a single answer, we show an inline answer preview (not a node)
 * - Search filter (Q/A) for practicality
 * - One-key toggle: show All / only Q / only A
 * - Default expand ALL branches
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const iconUrl = (name) => chrome.runtime.getURL(`assets/${name}`);

const IS_EMBEDDED = (() => {
  try {
    return new URLSearchParams(window.location.search).get('embedded') === '1';
  } catch {
    return false;
  }
})();

const PREVIEW_LIMIT = 110;
const MAX_DEPTH = 80;

function normalizeText(t) {
  return (t || '').replace(/\s+/g, ' ').trim();
}

function truncate(t, max = PREVIEW_LIMIT) {
  const s = normalizeText(t);
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

function highlight(text, query) {
  const s = normalizeText(text);
  if (!query) return s;
  const q = query.toLowerCase();
  const idx = s.toLowerCase().indexOf(q);
  if (idx < 0) return s;
  const before = s.slice(0, idx);
  const mid = s.slice(idx, idx + q.length);
  const after = s.slice(idx + q.length);
  return (
    <>
      {before}
      <mark className="git-mark">{mid}</mark>
      {after}
    </>
  );
}

function buildSearchIndex(qaTree, displayMode) {
  const qItems = [];
  const aItems = [];

  if (!qaTree) return { qItems, aItems };

  // Limit search scope based on display mode so results feel consistent.
  const wantQ = displayMode !== 'a';
  const wantA = displayMode !== 'q';

  if (wantQ) {
    qaTree.qNodeMap?.forEach((qNode) => {
      qItems.push({ id: qNode.userId, text: qNode.content || '' });
    });
  }
  if (wantA) {
    qaTree.aNodeMap?.forEach((aNode) => {
      aItems.push({ id: aNode.assistantId, text: aNode.content || '' });
    });
  }
  return { qItems, aItems };
}

function dedupeById(items, getId) {
  const out = [];
  const seen = new Set();
  for (const it of items || []) {
    const id = getId(it);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(it);
  }
  return out;
}

function getNextQuestionsFromQuestion(qNode) {
  const answers = qNode.answers || [];
  const all = [];
  for (const a of answers) {
    (a.nextQuestions || []).forEach((q) => all.push(q));
  }
  return dedupeById(all, (q) => q.userId);
}

function getNextAnswersFromAnswer(aNode) {
  const nextQuestions = aNode.nextQuestions || [];
  const all = [];
  for (const q of nextQuestions) {
    (q.answers || []).forEach((a) => all.push(a));
  }
  return dedupeById(all, (a) => a.assistantId);
}

function buildKeepSetFromMatches(matchIds, parentMap) {
  const keep = new Set();
  const pm = parentMap || new Map();

  for (const id of matchIds) {
    let cur = id;
    const visited = new Set();
    while (cur && !visited.has(cur)) {
      visited.add(cur);
      keep.add(cur);
      cur = pm.get(cur);
    }
  }
  return keep;
}

function getQChildren(qNode) {
  const answers = qNode.answers || [];
  if (answers.length === 0) {
    return { mode: 'none', items: [] };
  }
  if (answers.length === 1) {
    return {
      mode: 'collapsedAnswer',
      answer: answers[0],
      items: answers[0].nextQuestions || []
    };
  }
  return { mode: 'answers', items: answers };
}

export default function GitTreeView({
  qaTree,
  selectedPath,
  currentNodeId,
  onNodeClick,
  // Sidepanel-only topbar controls (merged bar): view toggle + refresh.
  // In embedded (floating panel) mode, we hide these because the floating
  // window already has its own control bar.
  showPanelControls = true,
  viewMode,
  onViewModeChange,
  onRefresh,
  isLoading
}) {
  const containerRef = useRef(null);
  const searchInputRef = useRef(null);
  // Keep expand/collapse state stable when qaTree updates (e.g. selecting a node updates
  // selectedPath and rebuilds qaTree object). We only want to auto-expand on the first
  // load of a conversation structure, and then preserve user toggles.
  const initializedRef = useRef(false);
  const structureRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [displayMode, setDisplayMode] = useState('all'); // all | q | a
  // Toolbar layout: keep the top row clean (buttons only).
  // Search + filters live in the second row and can be collapsed.
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const [fontScale, setFontScale] = useState(1);
  const [expanded, setExpanded] = useState(() => new Set());
  // Track whether the floating panel's controls are hidden (embedded mode only)
  const [controlsHidden, setControlsHidden] = useState(false);
  // Responsive compact level for toolbar (overflow-driven)
  const [compactLevel, setCompactLevel] = useState(0);
  const toolbarRef = useRef(null);
  const compactUpdateScheduledRef = useRef(false);
  const currentCompactLevelRef = useRef(0);
  const lastTightenWidthRef = useRef(0);

  // Overflow-driven responsive toolbar with hysteresis.
  // IMPORTANT: do NOT brute-force scan all levels each time (too much layout thrash).
  // Instead, tighten/relax step-by-step from the current level, with overlap detection.
  const OVERFLOW_TOL = 1;
  const MIN_GAP = 2;
  // Only relax (show more controls) when we have a little extra room.
  // We use width-based hysteresis because flex gaps are often fixed in CSS.
  const RELAX_WIDTH_DELTA = 10;

  const getRow2Metrics = useCallback(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return null;
    const row2 = toolbar.querySelector('.git-toolbar-row2');
    if (!row2) return null;
    const search = row2.querySelector('.git-search');
    const right = row2.querySelector('.git-toolbar-row2-right');
    const font = right?.querySelector('.git-font-control');
    const collapse = right?.querySelector('.git-collapse-btn');
    return { toolbar, row2, search, right, font, collapse };
  }, []);

  const isTooTight = useCallback((m) => {
    if (!m) return false;
    const { row2, search, right, font, collapse } = m;
    const overflow = row2.scrollWidth - row2.clientWidth;
    if (overflow > OVERFLOW_TOL) return true;

    // Detect near-overlap between the big left search area and right controls.
    if (search && right) {
      const sr = search.getBoundingClientRect();
      const rr = right.getBoundingClientRect();
      const gap = rr.left - sr.right;
      if (gap < MIN_GAP) return true;
    }

    // Detect near-overlap inside right controls (e.g. font slider vs collapse button in embedded mode).
    if (font && collapse && font.getClientRects().length && collapse.getClientRects().length) {
      const fr = font.getBoundingClientRect();
      const cr = collapse.getBoundingClientRect();
      const gap = cr.left - fr.right;
      if (gap < MIN_GAP) return true;
    }

    return false;
  }, []);

  const canRelax = useCallback(
    (m, containerWidth) => {
      if (!m) return false;
      // Must fit at the candidate level.
      if (isTooTight(m)) return false;
      // Width-based hysteresis: only relax when we've grown enough since the last tighten.
      return containerWidth >= (lastTightenWidthRef.current || 0) + RELAX_WIDTH_DELTA;
    },
    [isTooTight]
  );

  const updateToolbarCompact = useCallback(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const containerWidth = containerRef.current?.getBoundingClientRect?.().width || 0;

    // If row2 is collapsed/hidden, keep level 0 (avoid jitter).
    const m0 = getRow2Metrics();
    if (!m0) {
      if (currentCompactLevelRef.current !== 0) {
        currentCompactLevelRef.current = 0;
        setCompactLevel(0);
      }
      toolbar.dataset.compact = '0';
      return;
    }

    let lv = currentCompactLevelRef.current || 0;
    toolbar.dataset.compact = String(lv);
    void m0.row2.offsetWidth;

    // Tighten step-by-step until it fits or we hit max.
    while (lv < 3) {
      const m = getRow2Metrics();
      if (!isTooTight(m)) break;
      lv += 1;
      toolbar.dataset.compact = String(lv);
      void m.row2.offsetWidth;
      lastTightenWidthRef.current = containerWidth;
    }

    // Relax step-by-step with hysteresis slack.
    while (lv > 0) {
      const test = lv - 1;
      toolbar.dataset.compact = String(test);
      const m = getRow2Metrics();
      if (!m) {
        toolbar.dataset.compact = String(lv);
        break;
      }
      void m.row2.offsetWidth;
      if (canRelax(m, containerWidth)) {
        lv = test;
        continue;
      }
      toolbar.dataset.compact = String(lv);
      break;
    }

    if (lv !== currentCompactLevelRef.current) {
      currentCompactLevelRef.current = lv;
      setCompactLevel(lv);
    }
    toolbar.dataset.compact = String(lv);
  }, [canRelax, getRow2Metrics, isTooTight]);

  const scheduleCompactUpdate = useCallback(() => {
    if (compactUpdateScheduledRef.current) return;
    compactUpdateScheduledRef.current = true;
    requestAnimationFrame(() => {
      compactUpdateScheduledRef.current = false;
      updateToolbarCompact();
    });
  }, [updateToolbarCompact]);

  // ResizeObserver for responsive toolbar.
  // IMPORTANT: in embedded mode we sometimes unmount the toolbar container when the search row
  // is collapsed (to avoid the empty strip). If we only observe `toolbarRef`, the observer
  // might never be attached on the first open, and resize won't trigger compaction.
  // Observing the always-present container fixes this.
  useEffect(() => {
    const target = containerRef.current;
    if (!target) return;

    const observer = new ResizeObserver(() => {
      scheduleCompactUpdate();
    });

    observer.observe(target);
    return () => observer.disconnect();
  }, [scheduleCompactUpdate]);

  // Re-evaluate compaction when toolbar content changes but size may not (e.g. collapse button moves,
  // embedded controls appear/disappear, loading state toggles).
  useEffect(() => {
    scheduleCompactUpdate();
  }, [scheduleCompactUpdate, toolbarCollapsed, controlsHidden, showPanelControls, viewMode, isLoading]);

  // Embedded mode (floating window): allow parent to open/focus the search row.
  useEffect(() => {
    if (!IS_EMBEDDED) return;

    const handler = (event) => {
      const data = event?.data;
      if (!data || typeof data !== 'object') return;
      const { type, payload } = data;

      if (type === 'CG_TREE_OPEN_SEARCH' || type === 'CG_TREE_FOCUS_SEARCH') {
        setToolbarCollapsed(false);
        // Focus after the row becomes visible.
        setTimeout(() => searchInputRef.current?.focus?.(), 60);
      }

      if (type === 'CG_TREE_SET_TOOLBAR_COLLAPSED') {
        const collapsed = !!payload?.collapsed;
        setToolbarCollapsed(collapsed);
        if (!collapsed) setTimeout(() => searchInputRef.current?.focus?.(), 60);
      }

      // Track whether the floating panel's controls are hidden
      if (type === 'CG_CONTROLS_STATE') {
        setControlsHidden(!!payload?.hidden);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Tell the parent whether the search row is collapsed (so it can show a search icon in the floating header).
  useEffect(() => {
    if (!IS_EMBEDDED) return;
    try {
      window.parent?.postMessage(
        { type: 'CG_TREE_TOOLBAR_STATE', payload: { collapsed: !!toolbarCollapsed } },
        '*'
      );
    } catch {
      // ignore
    }
  }, [toolbarCollapsed]);

  // Persist display mode for convenience
  useEffect(() => {
    (async () => {
      try {
        const res = await chrome.storage.local.get(['gitTreeDisplayMode']);
        const m = res?.gitTreeDisplayMode;
        if (m === 'all' || m === 'q' || m === 'a') setDisplayMode(m);
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    try {
      chrome.storage.local.set({ gitTreeDisplayMode: displayMode });
    } catch {
      // ignore
    }
  }, [displayMode]);

  // Persist toolbar collapsed state
  useEffect(() => {
    (async () => {
      try {
        const res = await chrome.storage.local.get(['gitTreeToolbarCollapsed']);
        if (typeof res?.gitTreeToolbarCollapsed === 'boolean') {
          setToolbarCollapsed(res.gitTreeToolbarCollapsed);
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    try {
      chrome.storage.local.set({ gitTreeToolbarCollapsed: toolbarCollapsed });
    } catch {
      // ignore
    }
  }, [toolbarCollapsed]);

  // Persist font scale for Git Tree
  useEffect(() => {
    (async () => {
      try {
        const res = await chrome.storage.local.get(['gitTreeFontScale']);
        const v = Number(res?.gitTreeFontScale);
        if (!Number.isFinite(v)) return;
        setFontScale(Math.min(1.35, Math.max(0.85, v)));
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    try {
      chrome.storage.local.set({ gitTreeFontScale: fontScale });
    } catch {
      // ignore
    }
  }, [fontScale]);

  const { qItems, aItems } = useMemo(
    () => buildSearchIndex(qaTree, displayMode),
    [qaTree, displayMode]
  );

  const query = useMemo(() => normalizeText(searchQuery).toLowerCase(), [searchQuery]);

  const { matchIds, keepSet } = useMemo(() => {
    if (!qaTree || !query) {
      return { matchIds: [], keepSet: null };
    }
    const matches = [];
    for (const it of qItems) {
      if (normalizeText(it.text).toLowerCase().includes(query)) matches.push(it.id);
    }
    for (const it of aItems) {
      if (normalizeText(it.text).toLowerCase().includes(query)) matches.push(it.id);
    }
    const keep = buildKeepSetFromMatches(matches, qaTree.parentMap);
    return { matchIds: matches, keepSet: keep };
  }, [qaTree, query, qItems, aItems]);

  const matchSet = useMemo(() => new Set(matchIds), [matchIds]);

  // Initialize expansion when tree changes.
  // NOTE: selecting a node updates selectedPath and returns a new qaTree object, so we MUST
  // not reset `expanded` on every qaTree update, otherwise clicking a node will collapse the tree.
  useEffect(() => {
    if (!qaTree) {
      initializedRef.current = false;
      structureRef.current = null;
      setExpanded(new Set());
      return;
    }

    // Detect structural changes (new conversation / nodes changed)
    const structuralChanged = structureRef.current !== qaTree.parentMap;
    if (structuralChanged) {
      structureRef.current = qaTree.parentMap;
      initializedRef.current = false;
    }

    setExpanded((prev) => {
      const next = initializedRef.current ? new Set(prev) : new Set();

      // Only apply "nice defaults" once per conversation structure
      if (!initializedRef.current) {
        // Default: expand ALL branches (and linear links that lead to more nodes)
        // so the tree is fully visible out of the box.
        qaTree.root?.questions?.forEach((q) => next.add(q.userId));

        qaTree.qNodeMap?.forEach((qNode) => {
          const childInfo = getQChildren(qNode);
          const hasChildren =
            childInfo.mode === 'answers' ||
            (childInfo.mode === 'collapsedAnswer' && (childInfo.items?.length || 0) > 0);
          if (hasChildren) next.add(qNode.userId);
        });

        qaTree.aNodeMap?.forEach((aNode) => {
          if ((aNode.nextQuestions || []).length > 0) next.add(aNode.assistantId);
        });
      }

      // Always ensure the selected path is visible (but never collapse others)
      selectedPath?.forEach((id) => next.add(id));

      // Prune ids that no longer exist in current tree
      const isValid = (id) => qaTree.qNodeMap?.has(id) || qaTree.aNodeMap?.has(id);
      for (const id of Array.from(next)) {
        if (!isValid(id)) next.delete(id);
      }

      return next;
    });

    initializedRef.current = true;
  }, [qaTree, selectedPath]);

  // When searching, make sure all ancestors are expanded
  useEffect(() => {
    if (!query || !keepSet) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      keepSet.forEach((id) => next.add(id));
      return next;
    });
  }, [query, keepSet]);

  // Scroll active node into view inside panel
  useEffect(() => {
    if (!currentNodeId || !containerRef.current) return;
    let cancelled = false;

    // IMPORTANT:
    // `Element.scrollIntoView()` may scroll ALL ancestor scroll containers, including
    // the outer `.git-tree` (overflow:hidden). That can make the top toolbar "slide"
    // horizontally when we auto-focus a deeply indented node.
    //
    // We only want to scroll the real list container (`.git-root`) vertically.
    const scrollToActive = (attempt = 0) => {
      if (cancelled) return;

      const root = containerRef.current?.querySelector?.('.git-root');
      if (!root) return;

      const el = root.querySelector?.(`[data-node-id="${currentNodeId}"]`);
      if (!el) {
        if (attempt < 5) requestAnimationFrame(() => scrollToActive(attempt + 1));
        return;
      }

      const rootRect = root.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();

      const deltaTop = (elRect.top - rootRect.top) - (rootRect.height / 2 - elRect.height / 2);
      const targetTop = root.scrollTop + deltaTop;
      const maxTop = Math.max(0, root.scrollHeight - root.clientHeight);
      const clampedTop = Math.max(0, Math.min(targetTop, maxTop));

      // Horizontal: ONLY adjust if the node is actually out of view.
      // This avoids the annoying "sideways sliding" effect when clicking items
      // that are already visible.
      let targetLeft = root.scrollLeft;
      const leftOverflow = rootRect.left - elRect.left;
      const rightOverflow = elRect.right - rootRect.right;
      if (leftOverflow > 0) targetLeft = root.scrollLeft - leftOverflow;
      else if (rightOverflow > 0) targetLeft = root.scrollLeft + rightOverflow;

      const maxLeft = Math.max(0, root.scrollWidth - root.clientWidth);
      const clampedLeft = Math.max(0, Math.min(targetLeft, maxLeft));

      root.scrollTo({ top: clampedTop, left: clampedLeft, behavior: 'smooth' });
    };

    requestAnimationFrame(() => scrollToActive(0));

    return () => {
      cancelled = true;
    };
  }, [currentNodeId]);

  const toggleExpand = useCallback((id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const shouldShow = useCallback((id) => {
    if (!query || !keepSet) return true;
    return keepSet.has(id);
  }, [query, keepSet]);

  const handleJump = useCallback((id, nodeType) => {
    console.log('GitTreeView: handleJump', id, nodeType);
    onNodeClick?.(id, { messageId: id, nodeType });
  }, [onNodeClick]);

  const onSearchKeyDown = useCallback((e) => {
    if (e.key !== 'Enter') return;
    if (matchIds.length === 0) return;
    handleJump(matchIds[0], qaTree?.qNodeMap?.has(matchIds[0]) ? 'question' : 'answer');
  }, [matchIds, handleJump, qaTree]);

  function renderAnswerNodeAll(aNode, depth, forceShow) {
    if (depth > MAX_DEPTH) return null;
    const aId = aNode.assistantId;
    if (!forceShow && !shouldShow(aId)) return null;

    const nextQuestions = aNode.nextQuestions || [];
    const hasChildren = nextQuestions.length > 0;
    const isExpanded = expanded.has(aId);
    const isSelected = selectedPath?.has(aId);
    const isCurrent = currentNodeId === aId;
    const isMatched = matchSet.has(aId);

    return (
      <li key={aId} className="git-li">
        <div
          className={
            'git-row git-a' +
            (isSelected ? ' git-selected' : '') +
            (isCurrent ? ' git-current' : '') +
            (isMatched ? ' git-matched' : '')
          }
          data-node-id={aId}
          onClick={() => handleJump(aId, 'answer')}
          title={truncate(aNode.content, 260)}
        >
          <button
            className={
              'git-expander' + (hasChildren ? '' : ' git-expander-empty')
            }
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) toggleExpand(aId);
            }}
            aria-label={hasChildren ? (isExpanded ? 'Collapse' : 'Expand') : 'No children'}
          >
            {hasChildren ? (isExpanded ? '▾' : '▸') : '•'}
          </button>

          <span className="git-badge git-badge-a">A</span>
          <span className="git-text">{highlight(truncate(aNode.preview || aNode.content), query)}</span>
        </div>

        {hasChildren && isExpanded && (
          <ul className={'git-ul ' + (nextQuestions.length > 1 ? 'git-ul-branch' : 'git-ul-flat')}>
            {nextQuestions.map((q) => renderQuestionNodeAll(q, depth + 1))}
          </ul>
        )}
      </li>
    );
  }

  function renderQuestionNodeAll(qNode, depth) {
    if (depth > MAX_DEPTH) return null;
    const qId = qNode.userId;
    if (!shouldShow(qId)) return null;

    const childInfo = getQChildren(qNode);
    const hasChildren = childInfo.items?.length > 0 || childInfo.mode === 'answers';
    const isExpanded = expanded.has(qId);
    const isSelected = selectedPath?.has(qId);
    const isCurrent = currentNodeId === qId;
    const isMatched = matchSet.has(qId);

    // When a question itself matches (or is on selected path), show all its answers for quick jumping.
    const forceShowAnswers = !!query && (isMatched || isSelected);

    return (
      <li key={qId} className="git-li">
        <div
          className={
            'git-row git-q' +
            (isSelected ? ' git-selected' : '') +
            (isCurrent ? ' git-current' : '') +
            (isMatched ? ' git-matched' : '')
          }
          data-node-id={qId}
          onClick={() => handleJump(qId, 'question')}
          title={truncate(qNode.content, 260)}
        >
          <button
            className={
              'git-expander' + (hasChildren ? '' : ' git-expander-empty')
            }
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) toggleExpand(qId);
            }}
            aria-label={hasChildren ? (isExpanded ? 'Collapse' : 'Expand') : 'No children'}
          >
            {hasChildren ? (isExpanded ? '▾' : '▸') : '•'}
          </button>

          <span className="git-badge">Q</span>
          <span className="git-text">{highlight(truncate(qNode.preview || qNode.content), query)}</span>

          {(qNode.answers || []).length > 1 && (
            <span className="git-meta">{qNode.answers.length} answers</span>
          )}
        </div>

        {/* Single-answer: show inline answer preview (NOT a node) */}
        {childInfo.mode === 'collapsedAnswer' && childInfo.answer?.assistantId && (
          <div
            className={
              'git-inline-answer' +
              (selectedPath?.has(childInfo.answer.assistantId) ? ' git-inline-selected' : '') +
              (matchSet.has(childInfo.answer.assistantId) ? ' git-inline-matched' : '')
            }
            onClick={(e) => {
              e.stopPropagation();
              handleJump(childInfo.answer.assistantId, 'answer');
            }}
            title={truncate(childInfo.answer.content, 260)}
          >
            <span className="git-inline-badge">A</span>
            <span className="git-inline-text">
              {highlight(truncate(childInfo.answer.preview || childInfo.answer.content, 96), query)}
            </span>
          </div>
        )}

        {hasChildren && isExpanded && (
          <ul
            className={
              'git-ul ' +
              (childInfo.mode === 'answers' || (childInfo.items?.length || 0) > 1
                ? 'git-ul-branch'
                : 'git-ul-flat')
            }
          >
            {childInfo.mode === 'answers'
              ? childInfo.items.map((a) => renderAnswerNodeAll(a, depth + 1, forceShowAnswers))
              : childInfo.items.map((q) => renderQuestionNodeAll(q, depth + 1))}
          </ul>
        )}
      </li>
    );
  }

  function renderQuestionNodeQOnly(qNode, depth) {
    if (depth > MAX_DEPTH) return null;
    const qId = qNode.userId;
    if (!shouldShow(qId)) return null;

    const nextQs = getNextQuestionsFromQuestion(qNode);
    const hasChildren = nextQs.length > 0;
    const isExpanded = expanded.has(qId);
    const isSelected = selectedPath?.has(qId);
    const isCurrent = currentNodeId === qId;
    const isMatched = matchSet.has(qId);

    return (
      <li key={qId} className="git-li">
        <div
          className={
            'git-row git-q' +
            (isSelected ? ' git-selected' : '') +
            (isCurrent ? ' git-current' : '') +
            (isMatched ? ' git-matched' : '')
          }
          data-node-id={qId}
          onClick={() => handleJump(qId, 'question')}
          title={truncate(qNode.content, 260)}
        >
          <button
            className={'git-expander' + (hasChildren ? '' : ' git-expander-empty')}
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) toggleExpand(qId);
            }}
            aria-label={hasChildren ? (isExpanded ? 'Collapse' : 'Expand') : 'No children'}
          >
            {hasChildren ? (isExpanded ? '▾' : '▸') : '•'}
          </button>

          <span className="git-badge">Q</span>
          <span className="git-text">{highlight(truncate(qNode.preview || qNode.content), query)}</span>

          {(qNode.answers || []).length > 0 && (
            <span className="git-meta">
              {(qNode.answers || []).length} answer{(qNode.answers || []).length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {hasChildren && isExpanded && (
          <ul className={'git-ul ' + (nextQs.length > 1 ? 'git-ul-branch' : 'git-ul-flat')}>
            {nextQs.map((q) => renderQuestionNodeQOnly(q, depth + 1))}
          </ul>
        )}
      </li>
    );
  }

  function renderAnswerNodeAOnly(aNode, depth) {
    if (depth > MAX_DEPTH) return null;
    const aId = aNode.assistantId;
    if (!aId) return null;
    if (!shouldShow(aId)) return null;

    const nextAs = getNextAnswersFromAnswer(aNode);
    const hasChildren = nextAs.length > 0;
    const isExpanded = expanded.has(aId);
    const isSelected = selectedPath?.has(aId);
    const isCurrent = currentNodeId === aId;
    const isMatched = matchSet.has(aId);

    return (
      <li key={aId} className="git-li">
        <div
          className={
            'git-row git-a' +
            (isSelected ? ' git-selected' : '') +
            (isCurrent ? ' git-current' : '') +
            (isMatched ? ' git-matched' : '')
          }
          data-node-id={aId}
          onClick={() => handleJump(aId, 'answer')}
          title={truncate(aNode.content, 260)}
        >
          <button
            className={'git-expander' + (hasChildren ? '' : ' git-expander-empty')}
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) toggleExpand(aId);
            }}
            aria-label={hasChildren ? (isExpanded ? 'Collapse' : 'Expand') : 'No children'}
          >
            {hasChildren ? (isExpanded ? '▾' : '▸') : '•'}
          </button>

          <span className="git-badge git-badge-a">A</span>
          <span className="git-text">{highlight(truncate(aNode.preview || aNode.content), query)}</span>
        </div>

        {hasChildren && isExpanded && (
          <ul className={'git-ul ' + (nextAs.length > 1 ? 'git-ul-branch' : 'git-ul-flat')}>
            {nextAs.map((a) => renderAnswerNodeAOnly(a, depth + 1))}
          </ul>
        )}
      </li>
    );
  }

  if (!qaTree || !qaTree.root) {
    return (
      <div className="git-tree-empty">
        <div className="git-tree-empty-icon">
          <img src={iconUrl('tree.svg')} alt="Tree" style={{ width: '48px', height: '48px', opacity: 0.5 }} />
        </div>
        <div className="git-tree-empty-title">No data</div>
        <div className="git-tree-empty-sub">Open a conversation to see the QA tree.</div>
      </div>
    );
  }

  const rootQuestions = qaTree.root.questions || [];
  const visibleRootQuestions = query && keepSet
    ? rootQuestions.filter((q) => keepSet.has(q.userId))
    : rootQuestions;

  const rootAnswers = dedupeById(
    rootQuestions.flatMap((q) => q.answers || []),
    (a) => a.assistantId
  );
  const visibleRootAnswers = query && keepSet
    ? rootAnswers.filter((a) => keepSet.has(a.assistantId))
    : rootAnswers;

  const placeholder =
    displayMode === 'q'
      ? 'Search Q...'
      : displayMode === 'a'
        ? 'Search A...'
        : 'Search Q / A...';

  const renderRoot = () => {
    if (displayMode === 'a') {
      if (visibleRootAnswers.length === 0) return null;
      return (
        <ul className="git-ul git-root">
          {visibleRootAnswers.map((a) => renderAnswerNodeAOnly(a, 0))}
        </ul>
      );
    }

    if (displayMode === 'q') {
      if (visibleRootQuestions.length === 0) return null;
      return (
        <ul className="git-ul git-root">
          {visibleRootQuestions.map((q) => renderQuestionNodeQOnly(q, 0))}
        </ul>
      );
    }

    if (visibleRootQuestions.length === 0) return null;
    return (
      <ul className="git-ul git-root">
        {visibleRootQuestions.map((q) => renderQuestionNodeAll(q, 0))}
      </ul>
    );
  };

  const rootEl = renderRoot();

  // Embedded (floating window): Row 1 is not rendered (the floating window already
  // has its own header). If the search row is collapsed too, the toolbar container
  // would otherwise become an empty white strip under the floating header.
  const shouldRenderToolbar = showPanelControls || !toolbarCollapsed;

  return (
    <div
      className="git-tree"
      ref={containerRef}
      style={{ '--gitScale': String(fontScale) }}
    >
      {shouldRenderToolbar && (
        <div className="git-toolbar" ref={toolbarRef} data-compact={compactLevel}>
        {/* Row 1: sidepanel-only (merged header) */}
        {showPanelControls && (
          <div className="git-toolbar-row git-toolbar-row1">
            <div className="git-toolbar-left">
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

            <div className="git-toolbar-row1-right">
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
              <button
                type="button"
                className={'git-collapse-btn' + (toolbarCollapsed ? ' collapsed' : '')}
                onClick={() => setToolbarCollapsed((v) => !v)}
                title={toolbarCollapsed ? 'Show search & filters' : 'Hide search & filters'}
                aria-label={toolbarCollapsed ? 'Show search & filters' : 'Hide search & filters'}
              >
                <img className="toolbar-icon" src={iconUrl(toolbarCollapsed ? 'up.svg' : 'down.svg')} alt={toolbarCollapsed ? 'Expand' : 'Collapse'} />
              </button>
            </div>
          </div>
        )}

        {/* Row 2: search + filter + font size (collapsible) */}
        {!toolbarCollapsed && (
          <div className="git-toolbar-row git-toolbar-row2">
            <div className="git-search">
              <span className="git-search-icon">
                <img src={iconUrl('search.svg')} alt="Search" style={{ width: '14px', height: '14px', opacity: 0.6 }} />
              </span>
              <input
                className="git-search-input"
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder={placeholder}
              />
              {searchQuery && (
                <button
                  className="git-search-clear"
                  onClick={() => setSearchQuery('')}
                  title="Clear"
                  aria-label="Clear"
                  type="button"
                >
                  ✕
                </button>
              )}

              {/*
                Compact mode: when width is tight, show filter + font size only
                when the user hovers/focuses the search box.
              */}
              {!IS_EMBEDDED && (
                <div className="git-secondary-pop" aria-label="Controls">
                <div className="git-secondary-section" aria-label="Show nodes">
                  <div className="git-filter-toggle" role="tablist" aria-label="Show nodes">
                    <button
                      type="button"
                      className={'git-filter-btn' + (displayMode === 'all' ? ' active' : '')}
                      onClick={() => setDisplayMode('all')}
                      title="Show Q + A"
                    >
                      QA
                    </button>
                    <button
                      type="button"
                      className={'git-filter-btn' + (displayMode === 'q' ? ' active' : '')}
                      onClick={() => setDisplayMode('q')}
                      title="Only Q"
                    >
                      Q
                    </button>
                    <button
                      type="button"
                      className={'git-filter-btn' + (displayMode === 'a' ? ' active' : '')}
                      onClick={() => setDisplayMode('a')}
                      title="Only A"
                    >
                      A
                    </button>
                  </div>
                </div>

                <div className="git-secondary-section" aria-label="Font size">
                  <div className="git-font-control" title="Font size">
                    <span className="git-font-label">Aa</span>
                    <input
                      className="git-font-range"
                      type="range"
                      min="0.85"
                      max="1.35"
                      step="0.05"
                      value={fontScale}
                      onChange={(e) => setFontScale(Number(e.target.value))}
                      aria-label="Font size"
                    />
                  </div>
                </div>
                </div>
              )}
            </div>

            <div className="git-toolbar-row2-right" aria-label="Controls">
              <div className="git-toolbar-right" aria-label="Controls">
                <div className="git-filter-toggle" role="tablist" aria-label="Show nodes">
                  <button
                    type="button"
                    className={'git-filter-btn' + (displayMode === 'all' ? ' active' : '')}
                    onClick={() => setDisplayMode('all')}
                    title="Show Q + A"
                  >
                    QA
                  </button>
                  <button
                    type="button"
                    className={'git-filter-btn' + (displayMode === 'q' ? ' active' : '')}
                    onClick={() => setDisplayMode('q')}
                    title="Only Q"
                  >
                    Q
                  </button>
                  <button
                    type="button"
                    className={'git-filter-btn' + (displayMode === 'a' ? ' active' : '')}
                    onClick={() => setDisplayMode('a')}
                    title="Only A"
                  >
                    A
                  </button>
                </div>

                <div className="git-font-control" title="Font size">
                  <span className="git-font-label">Aa</span>
                  <input
                    className="git-font-range"
                    type="range"
                    min="0.85"
                    max="1.35"
                    step="0.05"
                    value={fontScale}
                    onChange={(e) => setFontScale(Number(e.target.value))}
                    aria-label="Font size"
                  />
                </div>
              </div>

              {/* Embedded (floating window): collapse button belongs to the END of the search row (after font size). */}
              {IS_EMBEDDED && (
                <button
                  type="button"
                  className={'git-collapse-btn' + (toolbarCollapsed ? ' collapsed' : '')}
                  onClick={() => setToolbarCollapsed(true)}
                  title="Hide search & filters"
                  aria-label="Hide search & filters"
                >
                  <img 
                    className="toolbar-icon" 
                    src={iconUrl('up.svg')} 
                    alt="Collapse" 
                  />
                </button>
              )}

              {/* Embedded (floating window): show toolbar button when controls are hidden */}
              {IS_EMBEDDED && controlsHidden && (
                <>
                  <button
                    type="button"
                    className="git-show-toolbar-btn visible"
                    onClick={() => {
                      // Tell parent to show the main toolbar
                      try {
                        window.parent?.postMessage({ type: 'CG_SHOW_TOOLBAR' }, '*');
                      } catch {
                        // ignore
                      }
                    }}
                    title="Show toolbar"
                    aria-label="Show toolbar"
                  >
                    <img className="toolbar-icon" src={iconUrl('control.svg')} alt="Show" />
                  </button>
                  <button
                    type="button"
                    className="git-close-btn visible"
                    onClick={() => {
                      // Tell parent to close the floating panel
                      try {
                        window.parent?.postMessage({ type: 'CG_CLOSE_PANEL' }, '*');
                      } catch {
                        // ignore
                      }
                    }}
                    title="Close"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        </div>
      )}

      {rootEl ? (
        rootEl
      ) : (
        <div className="git-no-results">
          <div className="git-no-results-title">No results</div>
          <div className="git-no-results-sub">Try a different keyword.</div>
        </div>
      )}
    </div>
  );
}
