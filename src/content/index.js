/**
 * Content Script 入口
 * 负责：
 * 1. 加载用户配置的 token
 * 2. 调用 API 获取对话数据
 * 3. 解析 mapping 树
 * 4. 提取分支结构
 * 5. 发送数据到 Service Worker
 * 6. 监听 URL 变化（对话切换）
 * 7. 监听 DOM 变化（新消息）
 * 8. 增量更新 graph tree
 */

import { MESSAGE_TYPES, CONFIG } from '../shared/constants.js';
import { log, extractConversationId, delay, initDebugLogSetting, getDebugLogEnabled } from '../shared/utils.js';
import { loadToken, hasToken, initTokenListener } from './auth/token-manager.js';
import { fetchConversationWithRetry } from './api/conversation.js';
import { parseMapping, getNodeStatistics } from './parser/mapping-parser.js';
import { extractBranches, buildRounds, analyzeBranchStructure } from './parser/branch-extractor.js';
import { isConversationPage, waitForElement } from './utils/dom-helper.js';
import { createURLObserver } from './observers/url-observer.js';
import { createMessageObserver } from './observers/message-observer.js';
import { conversationState } from './state/conversation-state.js';
import { navigateToMessage, getCurrentDisplayedPath } from './utils/branch-navigator.js';
import { initCollapseManager, setupSettingsListener } from './collapse/collapse-manager.js';
import { toggleFloatingPanel, toggleClickThrough, toggleLock } from './ui/floating-panel.js';

// 全局观察器实例
let urlObserver = null;
let messageObserver = null;

/**
 * 设置来自 sidepanel 的消息监听
 */
function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    log('debug', 'Content', 'Received message:', message.type);

    if (message.type === MESSAGE_TYPES.SCROLL_TO_MESSAGE) {
      const { messageId } = message.payload || {};
      if (messageId) {
        // 异步处理滚动（可能需要分支导航）
        scrollToMessage(messageId)
          .then(success => {
            sendResponse({ success });
          })
          .catch(error => {
            log('error', 'Content', 'scrollToMessage error:', error);
            sendResponse({ success: false, error: error.message });
          });
      } else {
        sendResponse({ success: false, error: 'No messageId provided' });
      }
      return true; // 保持消息通道打开
    }

    // Popup: toggle floating panel
    if (message.type === MESSAGE_TYPES.TOGGLE_FLOATING_PANEL) {
      toggleFloatingPanel()
        .then(opened => sendResponse({ success: true, opened }))
        .catch(err => sendResponse({ success: false, error: err?.message || 'Toggle failed' }));
      return true;
    }

    // Sidepanel 手动刷新：触发重新抓取 API + 重新解析 mapping
    if (message.type === MESSAGE_TYPES.REFRESH_DATA) {
      (async () => {
        try {
          // 优先使用 payload 里的 conversationId（sidepanel 从 tab.url 提取）
          const conversationId = message.payload?.conversationId || extractConversationId();
          if (!conversationId) {
            sendResponse({ success: false, error: 'No conversationId' });
            return;
          }

          log('info', 'Content', `Manual refresh requested for conversation: ${conversationId}`);

          // token 可能尚未加载（sidepanel 很快点刷新时）
          const tokenLoaded = await loadToken();
          if (!tokenLoaded || !hasToken()) {
            sendResponse({ success: false, error: 'No valid token configured' });
            return;
          }

          await fetchAndProcessConversation(conversationId);
          sendResponse({ success: true });
        } catch (err) {
          log('error', 'Content', 'Manual refresh failed:', err);
          sendResponse({ success: false, error: err.message || 'Refresh failed' });
        }
      })();

      return true;
    }

    if (message.type === MESSAGE_TYPES.UPDATE_FLOATING_PANEL_STATE) {
      const action = message.payload?.action;
      if (action === 'toggleClickThrough') {
        toggleClickThrough().then(() => sendResponse({ success: true })).catch(err => sendResponse({ success: false, error: err?.message || String(err) }));
        return true;
      }
      if (action === 'toggleLock') {
        toggleLock().then(() => sendResponse({ success: true })).catch(err => sendResponse({ success: false, error: err?.message || String(err) }));
        return true;
      }
    }

    return false;
  });

  log('info', 'Content', 'Message listener set up for sidepanel commands');
}

/**
 * Keyboard shortcuts
 * - Alt+Shift+G: toggle floating graph window
 * - Alt+Shift+T: toggle click-through (when floating window exists)
 * - Alt+Shift+L: lock/unlock floating window (when floating window exists)
 */
function setupFloatingHotkeys() {
  const isTypingTarget = (el) => {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || el.isContentEditable;
  };

  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(e.target)) return;
    if (!e.altKey || !e.shiftKey) return;

    if (e.code === 'KeyG') {
      e.preventDefault();
      toggleFloatingPanel();
    } else if (e.code === 'KeyT') {
      e.preventDefault();
      toggleClickThrough();
    } else if (e.code === 'KeyL') {
      e.preventDefault();
      toggleLock();
    }
  }, { capture: true });
}

/**
 * 滚动到指定消息
 * 如果消息不在当前显示的分支上，会先导航到正确的分支
 * @param {string} messageId - 消息 ID (data-message-id)
 * @returns {Promise<boolean>} 是否成功
 */
async function scrollToMessage(messageId) {
  log('info', 'Content', `Scrolling to message: ${messageId.substring(0, 16)}...`);

  // 尝试多种方式查找消息元素
  let targetElement = findMessageElement(messageId);

  if (targetElement) {
    // 消息在当前 DOM 中，执行持续滚动
    const success = await scrollUntilVisible(targetElement);
    if (success) {
      log('info', 'Content', '✓ Scrolled to message');
    } else {
      log('warn', 'Content', 'Scroll may not have reached exact position');
    }
    return success;
  }

  // 消息不在当前分支上，尝试分支导航
  log('info', 'Content', 'Message not in current branch, attempting branch navigation...');

  // 检查状态是否已初始化
  if (!conversationState.isReady()) {
    log('warn', 'Content', 'Conversation state not initialized, cannot navigate');
    return false;
  }

  // 获取所有节点数据
  const nodes = conversationState.getNodes();
  if (!nodes || nodes.length === 0) {
    log('warn', 'Content', 'No nodes available for navigation');
    return false;
  }

  // 执行分支导航
  try {
    const result = await navigateToMessage(messageId, nodes);

    if (result.success) {
      // 导航成功，再次查找并滚动
      await delay(300); // 等待 DOM 完全更新
      targetElement = findMessageElement(messageId);

      if (targetElement) {
        const success = await scrollUntilVisible(targetElement);
        log('info', 'Content', success
          ? '✓ Scrolled to message after branch navigation'
          : 'Scroll may not have reached exact position after branch navigation');
        return success;
      } else {
        log('warn', 'Content', 'Message element still not found after navigation');
        return false;
      }
    } else {
      log('warn', 'Content', `Branch navigation failed: ${result.message}`);
      return false;
    }
  } catch (error) {
    log('error', 'Content', 'Branch navigation error:', error);
    return false;
  }
}

// ==================== 滚动辅助函数 ====================

/**
 * 查找元素的可滚动祖先容器
 * 从目标元素向上查找，找到第一个可滚动的祖先
 * @param {HTMLElement} element - 目标元素
 * @returns {HTMLElement}
 */
function findScrollContainer(element) {
  let el = element.parentElement;
  while (el) {
    const style = window.getComputedStyle(el);
    const overflowY = style.overflowY;
    const isScrollable = (overflowY === 'auto' || overflowY === 'scroll')
                         && el.scrollHeight > el.clientHeight;
    if (isScrollable) {
      return el;
    }
    el = el.parentElement;
  }
  return document.documentElement;
}

/**
 * 检查元素是否接近视口中心
 * @param {HTMLElement} element - 目标元素
 * @returns {boolean}
 */
function isElementNearViewportCenter(element) {
  const rect = element.getBoundingClientRect();
  const viewportHeight = window.innerHeight;

  // 元素中心点
  const elementCenter = rect.top + rect.height / 2;

  // 视口中心区域（上下各 1/4 视口高度）
  const centerZoneTop = viewportHeight * 0.25;
  const centerZoneBottom = viewportHeight * 0.75;

  return elementCenter >= centerZoneTop && elementCenter <= centerZoneBottom;
}

/**
 * 等待滚动停止
 * 通过轮询检测 scrollTop 是否稳定来判断滚动动画是否结束
 * @param {HTMLElement} container - 滚动容器
 * @param {number} timeout - 超时时间 (ms)
 * @returns {Promise<void>}
 */
function waitForScrollToStop(container, timeout = 1500) {
  return new Promise((resolve) => {
    let lastScrollTop = container.scrollTop;
    let stableCount = 0;
    const STABLE_THRESHOLD = 3;  // 连续 3 次位置相同视为停止
    const startTime = Date.now();

    const check = () => {
      const currentScrollTop = container.scrollTop;

      if (Math.abs(currentScrollTop - lastScrollTop) < 1) {
        stableCount++;
        if (stableCount >= STABLE_THRESHOLD) {
          resolve();
          return;
        }
      } else {
        stableCount = 0;
        lastScrollTop = currentScrollTop;
      }

      if (Date.now() - startTime > timeout) {
        resolve();
        return;
      }

      requestAnimationFrame(check);
    };

    requestAnimationFrame(check);
  });
}

/**
 * 等待 DOM 变化或超时
 * 使用 MutationObserver 监听，比死等更高效
 * @param {HTMLElement} container - 监听的容器
 * @param {number} maxWait - 最大等待时间 (ms)
 * @returns {Promise<void>}
 */
function waitForDOMChangeOrTimeout(container, maxWait) {
  return new Promise((resolve) => {
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        observer.disconnect();
        resolve();
      }
    };

    const observer = new MutationObserver(cleanup);

    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: false
    });

    setTimeout(cleanup, maxWait);
  });
}

/**
 * 持续滚动直到目标元素进入视口中心区域
 * 处理 ChatGPT 长对话的懒加载：每次滚动后等待动画结束和 DOM 更新，
 * 如果目标仍未到位则重试，检测停滞时逐步增加等待时间。
 * @param {HTMLElement} element - 目标元素
 * @returns {Promise<boolean>} 是否成功滚动到位
 */
async function scrollUntilVisible(element) {
  const MAX_ATTEMPTS = 10;
  const DOM_WAIT_INITIAL = 100;     // DOM 变化初始等待 (ms)
  const DOM_WAIT_MAX = 1500;        // DOM 变化最大等待 (ms)
  const STUCK_THRESHOLD = 3;        // 连续停滞阈值
  const SCROLL_TOLERANCE = 5;       // 滚动变化容差 (px)

  const scrollContainer = findScrollContainer(element);
  log('debug', 'Content', `[Scroll] Container: ${scrollContainer.tagName}.${scrollContainer.className.split(' ')[0]}, scrollHeight=${scrollContainer.scrollHeight}, clientHeight=${scrollContainer.clientHeight}`);

  let lastScrollTop = scrollContainer.scrollTop;
  let domWaitTime = DOM_WAIT_INITIAL;
  let stuckCount = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const elementCenter = rect.top + rect.height / 2;

    log('debug', 'Content', `[Scroll] Attempt ${attempt + 1}: elementCenter=${Math.round(elementCenter)}, viewport=${viewportHeight}, scrollTop=${Math.round(scrollContainer.scrollTop)}`);

    // 1. 检查目标是否已在视口中心区域
    if (isElementNearViewportCenter(element)) {
      log('debug', 'Content', `[Scroll] Element in center zone, done!`);
      highlightElement(element);
      return true;
    }

    // 2. 执行滚动
    log('debug', 'Content', `[Scroll] Calling scrollIntoView...`);
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // 3. 等待滚动动画停止
    await waitForScrollToStop(scrollContainer);
    log('debug', 'Content', `[Scroll] Scroll stopped at ${Math.round(scrollContainer.scrollTop)}`);

    // 4. 等待可能的 DOM 变化（懒加载触发）
    await waitForDOMChangeOrTimeout(scrollContainer, domWaitTime);

    // 5. 检测滚动是否停滞
    const currentScrollTop = scrollContainer.scrollTop;
    const scrollDelta = Math.abs(currentScrollTop - lastScrollTop);

    log('debug', 'Content', `[Scroll] Delta: ${Math.round(scrollDelta)}px (last=${Math.round(lastScrollTop)}, current=${Math.round(currentScrollTop)})`);

    if (scrollDelta < SCROLL_TOLERANCE) {
      stuckCount++;
      domWaitTime = Math.min(Math.round(domWaitTime * 1.5), DOM_WAIT_MAX);

      log('debug', 'Content', `[Scroll] Stuck (${stuckCount}/${STUCK_THRESHOLD}), next wait: ${domWaitTime}ms`);

      if (stuckCount >= STUCK_THRESHOLD) {
        log('warn', 'Content', '[Scroll] Stuck limit reached');
        highlightElement(element);
        return false;
      }
    } else {
      stuckCount = 0;
      domWaitTime = DOM_WAIT_INITIAL;
    }

    lastScrollTop = currentScrollTop;
  }

  log('warn', 'Content', '[Scroll] Max attempts reached');
  return false;
}

/**
 * 查找消息元素
 * @param {string} messageId - 消息 ID
 * @returns {HTMLElement|null}
 */
function findMessageElement(messageId) {
  //TODO: 排除bug的风险
  // 1. 通过 data-message-id 属性查找
  let targetElement = document.querySelector(`[data-message-id="${messageId}"]`);

  // 2. 通过 data-turn-id 属性查找（ChatGPT 新版本可能使用这个）
  if (!targetElement) { 
    targetElement = document.querySelector(`[data-turn-id="${messageId}"]`);
  }

  // 3. 遍历所有 article 查找
  if (!targetElement) {
    const articles = document.querySelectorAll('article[data-turn-id]');
    for (const article of articles) {
      const turnId = article.getAttribute('data-turn-id');
      if (turnId === messageId) {
        targetElement = article;
        break;
      }
    }
  }

  // 4. 尝试模糊匹配
  const MIN_SAFE_LENGTH = 5;
  
  // 只有当 ID 长度足够时才进行模糊搜索，避免匹配到 "1", "user" 等短字符
  if (messageId.length < MIN_SAFE_LENGTH) return null;

  // 扩大搜索范围：获取所有包含任意一种 ID 属性的 article
  const candidates = document.querySelectorAll('article[data-message-id], article[data-turn-id]');

  for (const article of candidates) {
    // 获取两个属性值
    const domMessageId = article.getAttribute('data-message-id');
    const domTurnId = article.getAttribute('data-turn-id');

    // 定义匹配帮助函数：检查 DOM 属性是否“包含”目标 ID，或者目标 ID 是否“包含”DOM 属性
    const isMatch = (domAttr) => {
      if (!domAttr || domAttr.length < MIN_SAFE_LENGTH) return false;
      return domAttr.includes(messageId) || messageId.includes(domAttr);
    };

    // 优先检查 data-message-id
    if (isMatch(domMessageId)) {
      targetElement = article;
      break;
    }

    // 其次检查 data-turn-id
    if (isMatch(domTurnId)) {
      targetElement = article;
      break;
    }
  }

  return targetElement;
}

/**
 * 高亮元素（短暂闪烁效果）
 * @param {HTMLElement} element - 要高亮的元素
 */
function highlightElement(element) {
  // 添加高亮样式
  element.style.transition = 'outline 0.3s ease, outline-offset 0.3s ease';
  element.style.outline = '3px solid #3b82f6';
  element.style.outlineOffset = '2px';

  // 短暂延迟后移除高亮
  setTimeout(() => {
    element.style.outline = '3px solid transparent';

    setTimeout(() => {
      // 完全移除内联样式，恢复原状
      element.style.removeProperty('outline');
      element.style.removeProperty('outline-offset');
      element.style.removeProperty('transition');
    }, 300);
  }, 1500);
}

/**
 * 主函数
 */
async function main() {
  // Initialize debug log setting first (before any logging)
  await initDebugLogSetting();

  log('info', 'Content', 'Content script loaded');

  // 检查扩展上下文是否有效
  if (!chrome.runtime?.id) {
    showExtensionReloadWarning();
    return;
  }

  // 初始化 token 监听器（监听自动捕获的 token 更新）
  initTokenListener();

  // 设置消息监听器（在最早期就设置，以便接收来自 sidepanel 的消息）
  setupMessageListener();

  // Floating window hotkeys
  setupFloatingHotkeys();
  setupFloatingHotkeys();
  // 设置折叠设置监听器
  setupSettingsListener();

  // 初始化折叠管理器（不依赖 token，可以立即启动）
  try {
    await initCollapseManager();
  } catch (e) {
    log('warn', 'Content', 'Failed to initialize collapse manager:', e);
  }

  // 检查是否在对话页面
  if (!isConversationPage()) {
    log('debug', 'Content', 'Not a conversation page, skipping');
    return;
  }

  // 提取对话 ID
  const conversationId = extractConversationId();
  if (!conversationId) {
    log('error', 'Content', 'Failed to extract conversation ID');
    return;
  }

  log('info', 'Content', `Conversation ID: ${conversationId}`);

  // 等待页面加载完成
  await waitForPageReady();

  // 加载用户配置的 token
  const tokenLoaded = await loadToken();

  if (!tokenLoaded || !hasToken()) {
    log('error', 'Content', 'No valid token found');
    showTokenSetupPrompt();
    return;
  }

  log('info', 'Content', 'Token loaded successfully');

  // 延迟执行，避免阻塞页面
  await delay(CONFIG.API_DELAY);

  // 获取并处理当前对话数据
  await fetchAndProcessConversation(conversationId);

  // 启动 URL 观察器，监听对话切换
  startURLObserver();

  // 启动消息观察器，监听新消息
  startMessageObserver();
}

/**
 * 启动 URL 观察器
 * 监听用户切换对话，自动重新加载数据
 */
function startURLObserver() {
  log('info', 'Content', 'Starting URL observer for conversation switching');

  // 停止旧的观察器（如果存在）
  if (urlObserver) {
    urlObserver.stop();
  }

  urlObserver = createURLObserver(async (newConversationId, oldConversationId) => {
    log('info', 'Content', `Conversation switched: ${oldConversationId} → ${newConversationId}`);

    // 清空旧的状态
    conversationState.clear();

    // 重置消息观察器
    if (messageObserver) {
      messageObserver.reset();
    }

    // 等待页面更新完成
    await delay(CONFIG.API_DELAY);

    // 重新获取并处理新对话数据
    await fetchAndProcessConversation(newConversationId);
  });

  log('info', 'Content', 'URL observer started');
}

/**
 * 启动消息观察器
 * 监听新消息，进行增量更新
 */
function startMessageObserver() {
  log('info', 'Content', 'Starting message observer for incremental updates');

  // 停止旧的观察器（如果存在）
  if (messageObserver) {
    messageObserver.stop();
  }

  messageObserver = createMessageObserver(async (messageData) => {
    log('info', 'Content', `New message detected`, {
      id: messageData.id.substring(0, 8) + '...',
      role: messageData.role
    });

    // 处理增量消息
    await handleIncrementalMessage(messageData);
  });

  log('info', 'Content', 'Message observer started');
}

/**
 * 处理增量消息
 * @param {Object} messageData - 从 DOM 提取的消息数据
 */
async function handleIncrementalMessage(messageData) {
  try {
    // 检查状态是否已初始化
    if (!conversationState.isReady()) {
      log('warn', 'Content', 'State not initialized, skipping incremental update');
      return;
    }

    // 添加增量节点到状态
    const added = conversationState.addIncrementalNode(messageData);

    if (!added) {
      log('debug', 'Content', 'Node already exists or failed to add');
      return;
    }

    // 获取增量更新数据
    const incrementalUpdate = conversationState.getIncrementalUpdate(messageData.id);

    log('info', 'Content', 'Incremental update prepared', {
      nodeId: messageData.id.substring(0, 8) + '...',
      totalNodes: conversationState.getStats().totalNodes
    });

    // 发送增量更新到 background（失败不影响后续流程）
    try {
      await sendToBackground(MESSAGE_TYPES.CONVERSATION_INCREMENTAL_UPDATE, incrementalUpdate);
      log('info', 'Content', '✓ Incremental update sent to background');
    } catch (bgError) {
      log('error', 'Content', 'Failed to send incremental update:', bgError.message);
    }

    // 输出调试信息
    logIncrementalUpdate(messageData, conversationState.getStats());

  } catch (error) {
    log('error', 'Content', 'Failed to handle incremental message:', error);
  }
}

/**
 * 显示扩展重新加载警告
 */
function showExtensionReloadWarning() {
  console.group('🌲 ContextFlow - Extension Reloaded');
  console.warn('⚠️ Extension context invalidated');
  console.log('');
  console.log('The extension was reloaded while this page was open.');
  console.log('Please refresh this page to restore functionality.');
  console.log('');
  console.groupEnd();
}

/**
 * 显示 Token 设置提示
 */
function showTokenSetupPrompt() {
  console.group('🌲 ContextFlow - Setup Required');
  console.error('❌ Authentication token not configured');
  console.log('');
  console.log('To use this extension:');
  console.log('1. Click the extension icon in your toolbar');
  console.log('2. Click "Setup Token" button');
  console.log('3. Follow the instructions to get your token');
  console.log('4. Refresh this page');
  console.log('');
  console.log('Your token is stored securely on your device.');
  console.groupEnd();
}

/**
 * 等待页面准备就绪
 */
async function waitForPageReady() {
  log('info', 'Content', 'Waiting for page ready...');

  // 等待 main 元素出现
  const mainElement = await waitForElement('main', 10000);
  if (!mainElement) {
    throw new Error('Page load timeout');
  }

  log('info', 'Content', 'Page ready');
}

/**
 * 获取并处理对话数据
 * @param {string} conversationId - 对话 ID
 */
async function fetchAndProcessConversation(conversationId) {
  try {
    log('info', 'Content', 'Fetching conversation data...');

    // 1. 调用 API
    const data = await fetchConversationWithRetry(conversationId);

    if (!data || !data.mapping) {
      throw new Error('Invalid conversation data');
    }

    log('info', 'Content', 'Conversation data received', {
      title: data.title,
      mappingSize: Object.keys(data.mapping).length
    });

    // 2. 解析 mapping（返回 nodes 和 edges）
    const { nodes, edges } = parseMapping(data.mapping, conversationId);
    const stats = getNodeStatistics(nodes);

    log('info', 'Content', 'Parsed', { nodes: nodes.length, edges: edges.length, ...stats });

    // 3. 提取分支
    const branches = extractBranches(nodes);
    const rounds = buildRounds(nodes);
    const analysis = analyzeBranchStructure(nodes);

    log('info', 'Content', 'Branch analysis complete', {
      branches: branches.length,
      rounds: rounds.length,
      branchPoints: analysis.branchPointsCount
    });

    // 4. 构建完整数据
    const conversationData = {
      id: conversationId,
      title: data.title,
      createTime: data.create_time,
      updateTime: data.update_time,
      mapping: data.mapping,
      nodes,
      edges,
      rounds,
      branches,
      analysis
    };

    // 5. 初始化状态管理器（用于增量更新）
    conversationState.initialize(conversationData);
    log('info', 'Content', '✓ Conversation state initialized');

    // 6. 发送到 Service Worker（失败不影响调试输出）
    try {
      await sendToBackground(MESSAGE_TYPES.CONVERSATION_LOADED, conversationData);
      log('info', 'Content', '✓ Conversation data sent to background');
    } catch (bgError) {
      log('error', 'Content', 'Failed to send to background (extension may be reloading):', bgError.message);
      // 继续执行，至少输出调试信息
    }

    // 7. 输出调试信息到控制台（即使 background 失败也要显示）
    logDebugInfo(conversationData);

  } catch (error) {
    log('error', 'Content', 'Failed to process conversation:', error);

    // 尝试发送错误消息（但不阻塞）
    try {
      await sendToBackground(MESSAGE_TYPES.ERROR, {
        message: error.message,
        stack: error.stack
      });
    } catch (bgError) {
      log('warn', 'Content', 'Could not send error to background:', bgError.message);
    }
  }
}

/**
 * 发送消息到 Service Worker
 * @param {string} type - 消息类型
 * @param {Object} payload - 消息负载
 * @param {number} retries - 重试次数
 * @returns {Promise<Object>}
 */
async function sendToBackground(type, payload, retries = 3) {
  // 检查 extension context 是否有效
  if (!chrome.runtime?.id) {
    log('error', 'Content', 'Extension context invalidated (extension may have been reloaded)');
    throw new Error('Extension context invalidated. Please refresh the page.');
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type,
            payload,
            timestamp: Date.now()
          },
          response => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else if (response && response.error) {
              reject(new Error(response.error));
            } else {
              resolve(response);
            }
          }
        );
      });

      log('debug', 'Content', `Message sent successfully on attempt ${attempt}`);
      return response;

    } catch (error) {
      const isLastAttempt = attempt === retries;
      const isConnectionError = error.message?.includes('Receiving end does not exist');

      if (isConnectionError) {
        log('warn', 'Content', `Background connection failed (attempt ${attempt}/${retries})`);

        if (!isLastAttempt) {
          // 等待后重试（给 background script 初始化的时间）
          await delay(500 * attempt);
          continue;
        } else {
          log('error', 'Content', 'Background script not responding. Extension may need to be reloaded.');
          throw new Error('Background script not responding. Please reload the extension or refresh the page.');
        }
      } else {
        // 其他错误，直接抛出
        throw error;
      }
    }
  }
}

/**
 * 输出调试信息
 * @param {Object} conversationData - 对话数据
 */
function logDebugInfo(conversationData) {
  // Only log debug info if debug logging is enabled
  if (!getDebugLogEnabled()) {
    return;
  }

  console.group('🌲 ContextFlow - Conversation Data');

  console.log('📊 Statistics:', {
    'Total Nodes': conversationData.nodes.length,
    'Total Edges': conversationData.edges.length,
    'User Messages': conversationData.nodes.filter(n => n.role === 'user').length,
    'Assistant Replies': conversationData.nodes.filter(n => n.role === 'assistant').length,
    'Tool Replies': conversationData.nodes.filter(n => n.role === 'tool').length,
    'Rounds': conversationData.rounds.length,
    'Branches': conversationData.branches.length,
    'Branch Points': conversationData.analysis.branchPointsCount
  });

  if (conversationData.analysis.branchPoints.length > 0) {
    console.log('🌿 Branch Points:');
    conversationData.analysis.branchPoints.forEach((bp, index) => {
      console.log(`  ${index + 1}. [${bp.role}] "${bp.content}" → ${bp.childrenCount} children`);
    });
  }

  if (conversationData.branches.length > 0) {
    console.log(`📝 Branches (${conversationData.branches.length} total):`);
    conversationData.branches.slice(0, 3).forEach((branch, index) => {
      console.log(`  Branch ${index + 1}: ${branch.messageCount} messages, depth ${branch.depth}`);
    });
    if (conversationData.branches.length > 3) {
      console.log(`  ... and ${conversationData.branches.length - 3} more`);
    }
  }

  console.log('💾 Full Data:', conversationData);

  console.groupEnd();
}

/**
 * 输出增量更新调试信息
 * @param {Object} messageData - 新消息数据
 * @param {Object} stats - 对话统计信息
 */
function logIncrementalUpdate(messageData, stats) {
  // Only log debug info if debug logging is enabled
  if (!getDebugLogEnabled()) {
    return;
  }

  console.group('🆕 ContextFlow - Incremental Update');

  console.log('📨 New Message:', {
    'ID': messageData.id.substring(0, 16) + '...',
    'Role': messageData.role,
    'Content Length': messageData.content.length,
    'Parent': messageData.parent?.substring(0, 16) + '...' || '(none)'
  });

  console.log('📊 Updated Statistics:', {
    'Total Nodes': stats.totalNodes,
    'Total Rounds': stats.totalRounds,
    'Total Branches': stats.totalBranches,
    'Branch Points': stats.branchPoints,
    'Incremental Nodes': stats.incrementalNodes
  });

  console.log('⚡ Update Method: DOM extraction (no API call)');

  console.groupEnd();
}

// 启动
main().catch(error => {
  log('error', 'Content', 'Fatal error:', error);
});
