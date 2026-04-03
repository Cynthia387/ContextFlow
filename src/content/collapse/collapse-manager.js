/**
 * 内容折叠管理器
 * 负责在 ChatGPT 页面上注入折叠功能
 */

import { STORAGE_KEYS, DEFAULT_COLLAPSE_SETTINGS } from '../../shared/constants.js';
import { log } from '../../shared/utils.js';
import { COLLAPSE_STYLES, COLLAPSE_ICON_SVG, EXPAND_ICON_SVG } from './collapse-styles.js';

// 模块状态
let settings = { ...DEFAULT_COLLAPSE_SETTINGS };
let observer = null;
let styleElement = null;
let isInitialized = false;

// 存储每个消息的折叠状态和相关元素
// Map<article, { messageType, contentContainer, btn, isCollapsed, textLength }>
const messageStates = new WeakMap();

/**
 * 获取折叠设置
 * @returns {Promise<Object>}
 */
export async function getCollapseSettings() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.COLLAPSE_SETTINGS);
    const stored = result[STORAGE_KEYS.COLLAPSE_SETTINGS];
    if (stored) {
      return { ...DEFAULT_COLLAPSE_SETTINGS, ...stored };
    }
  } catch (e) {
    log('warn', 'Collapse', 'Failed to load settings:', e);
  }
  return { ...DEFAULT_COLLAPSE_SETTINGS };
}

/**
 * 保存折叠设置
 * @param {Object} newSettings
 */
export async function saveCollapseSettings(newSettings) {
  try {
    settings = { ...DEFAULT_COLLAPSE_SETTINGS, ...newSettings };
    await chrome.storage.local.set({ [STORAGE_KEYS.COLLAPSE_SETTINGS]: settings });
    log('info', 'Collapse', 'Settings saved:', settings);
  } catch (e) {
    log('error', 'Collapse', 'Failed to save settings:', e);
  }
}

/**
 * 注入样式到页面
 */
function injectStyles() {
  if (styleElement) return;

  styleElement = document.createElement('style');
  styleElement.id = 'chatgpt-graph-collapse-styles';
  styleElement.textContent = COLLAPSE_STYLES;
  document.head.appendChild(styleElement);

  log('info', 'Collapse', 'Styles injected');
}

/**
 * 获取消息内容的文本长度
 * @param {HTMLElement} article - 消息 article 元素
 * @returns {number}
 */
function getMessageTextLength(article) {
  const contentEl = article.querySelector('.markdown, [data-message-content], .whitespace-pre-wrap');
  if (!contentEl) return 0;
  return (contentEl.textContent || '').trim().length;
}

/**
 * 判断消息类型
 * @param {HTMLElement} article - 消息 article 元素
 * @returns {'user' | 'assistant' | null}
 */
function getMessageType(article) {
  // 通过 heading 判断
  const h5 = article.querySelector('h5');
  const h6 = article.querySelector('h6');

  if (h5) return 'user';
  if (h6) return 'assistant';

  // 通过 data 属性判断
  const role = article.getAttribute('data-message-author-role');
  if (role === 'user') return 'user';
  if (role === 'assistant') return 'assistant';

  // 通过类名判断
  if (article.querySelector('[data-message-author-role="user"]')) return 'user';
  if (article.querySelector('[data-message-author-role="assistant"]')) return 'assistant';

  return null;
}

/**
 * 查找消息内容容器
 * @param {HTMLElement} article
 * @returns {HTMLElement|null}
 */
function findContentContainer(article) {
  // 优先查找 markdown 容器
  let container = article.querySelector('.markdown');
  if (container) return container;

  // 查找 whitespace-pre-wrap（用户消息）
  container = article.querySelector('.whitespace-pre-wrap');
  if (container) return container;

  // 查找通用内容容器
  container = article.querySelector('[data-message-content]');
  if (container) return container;

  return null;
}

/**
 * 查找按钮容器
 * @param {HTMLElement} article
 * @param {'user' | 'assistant'} messageType
 * @returns {HTMLElement|null}
 */
function findButtonContainer(article, messageType) {
  // 用户消息：查找包含复制、编辑按钮的容器
  if (messageType === 'user') {
    // 查找包含 "复制" 或 "Copy" 按钮的容器
    const copyBtn = article.querySelector('button[aria-label*="复制"], button[aria-label*="Copy"]');
    if (copyBtn && copyBtn.parentElement) {
      return copyBtn.parentElement;
    }
  }

  // 助手消息：查找包含更多操作按钮的容器
  if (messageType === 'assistant') {
    // 查找 "更多操作" 或 "More" 按钮
    const moreBtn = article.querySelector('button[aria-label*="更多"], button[aria-label*="More"]');
    if (moreBtn && moreBtn.parentElement) {
      return moreBtn.parentElement;
    }

    // 备选：查找包含复制按钮的容器
    const copyBtn = article.querySelector('button[aria-label*="复制"], button[aria-label*="Copy"]');
    if (copyBtn && copyBtn.parentElement) {
      return copyBtn.parentElement;
    }
  }

  return null;
}

/**
 * 检查元素是否在视口内
 * @param {HTMLElement} element
 * @returns {boolean}
 */
function isElementInViewport(element) {
  const rect = element.getBoundingClientRect();
  const windowHeight = window.innerHeight || document.documentElement.clientHeight;

  // 检查元素顶部是否在视口内（至少能看到元素的开头）
  return rect.top >= 0 && rect.top < windowHeight;
}

/**
 * 滚动到元素位置
 * @param {HTMLElement} element
 */
function scrollToElement(element) {
  element.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}

/**
 * 更新按钮的显示状态
 * @param {HTMLButtonElement} btn
 * @param {boolean} isCollapsed
 */
function updateButtonState(btn, isCollapsed) {
  btn.innerHTML = isCollapsed ? EXPAND_ICON_SVG : COLLAPSE_ICON_SVG;
  btn.className = `chatgpt-graph-collapse-btn ${isCollapsed ? 'collapsed' : ''}`;
  btn.setAttribute('aria-label', isCollapsed ? 'Expand' : 'Collapse');
  btn.title = isCollapsed ? 'Expand' : 'Collapse';
}

/**
 * 设置内容的折叠状态
 * @param {HTMLElement} contentContainer
 * @param {boolean} isCollapsed
 */
function setCollapseState(contentContainer, isCollapsed) {
  if (isCollapsed) {
    contentContainer.classList.add('chatgpt-graph-collapsed');
  } else {
    contentContainer.classList.remove('chatgpt-graph-collapsed');
  }
}

/**
 * 判断消息是否应该自动折叠
 * @param {'user' | 'assistant'} messageType
 * @returns {boolean}
 */
function shouldAutoCollapse(messageType) {
  if (!settings.enabled) return false;
  if (messageType === 'user' && !settings.autoCollapseQuestion) return false;
  if (messageType === 'assistant' && !settings.autoCollapseAnswer) return false;
  return true;
}

/**
 * 处理单个消息元素
 * @param {HTMLElement} article
 * @param {boolean} isSettingsUpdate - 是否是设置更新触发的
 */
function processMessage(article, isSettingsUpdate = false) {
  // 检查是否已处理
  const existingState = messageStates.get(article);

  if (existingState) {
    // 已处理过，如果是设置更新，则更新折叠状态
    if (isSettingsUpdate) {
      const shouldCollapse = shouldAutoCollapse(existingState.messageType);

      // 只在自动折叠设置变更时更新状态
      if (shouldCollapse && !existingState.isCollapsed) {
        // 需要折叠
        existingState.isCollapsed = true;
        setCollapseState(existingState.contentContainer, true);
        updateButtonState(existingState.btn, true);
      } else if (!shouldCollapse && existingState.isCollapsed) {
        // 需要展开
        existingState.isCollapsed = false;
        setCollapseState(existingState.contentContainer, false);
        updateButtonState(existingState.btn, false);
      }
    }
    return;
  }

  // 获取消息类型
  const messageType = getMessageType(article);
  if (!messageType) return;

  // 检查内容长度
  const textLength = getMessageTextLength(article);
  if (textLength < settings.threshold) return;

  // 查找内容容器
  const contentContainer = findContentContainer(article);
  if (!contentContainer) return;

  // 查找按钮容器
  const buttonContainer = findButtonContainer(article, messageType);
  if (!buttonContainer) return;

  // 添加可折叠类
  contentContainer.classList.add('chatgpt-graph-collapsible');

  // 根据设置决定初始状态
  let isCollapsed = shouldAutoCollapse(messageType);
  setCollapseState(contentContainer, isCollapsed);

  // 创建按钮
  const btn = document.createElement('button');
  btn.className = `chatgpt-graph-collapse-btn ${isCollapsed ? 'collapsed' : ''}`;
  btn.innerHTML = isCollapsed ? EXPAND_ICON_SVG : COLLAPSE_ICON_SVG;
  btn.setAttribute('aria-label', isCollapsed ? 'Expand' : 'Collapse');
  btn.title = isCollapsed ? 'Expand' : 'Collapse';

  // 存储状态
  const state = {
    messageType,
    contentContainer,
    btn,
    isCollapsed,
    textLength
  };
  messageStates.set(article, state);

  // 点击事件
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    state.isCollapsed = !state.isCollapsed;
    setCollapseState(contentContainer, state.isCollapsed);
    updateButtonState(btn, state.isCollapsed);

    // 如果是折叠操作，检查是否需要滚动
    if (state.isCollapsed) {
      // 延迟检查，等待折叠动画完成
      setTimeout(() => {
        if (!isElementInViewport(article)) {
          scrollToElement(article);
        }
      }, 50);
    }
  });

  // 插入按钮
  if (messageType === 'user') {
    // 用户消息：添加到按钮容器末尾
    buttonContainer.appendChild(btn);
  } else {
    // 助手消息：插入到 "更多操作" 按钮之前
    const moreBtn = buttonContainer.querySelector('button[aria-label*="更多"], button[aria-label*="More"]');
    if (moreBtn) {
      buttonContainer.insertBefore(btn, moreBtn);
    } else {
      buttonContainer.appendChild(btn);
    }
  }

  log('debug', 'Collapse', `Processed ${messageType} message (${textLength} chars, collapsed: ${isCollapsed})`);
}

/**
 * 处理页面上所有消息
 * @param {boolean} isSettingsUpdate - 是否是设置更新触发的
 */
function processAllMessages(isSettingsUpdate = false) {
  const articles = document.querySelectorAll('article');
  articles.forEach(article => {
    try {
      processMessage(article, isSettingsUpdate);
    } catch (e) {
      log('warn', 'Collapse', 'Failed to process message:', e);
    }
  });
}

/**
 * 启动 DOM 观察器
 */
function startObserver() {
  if (observer) return;

  const targetNode = document.querySelector('main') || document.body;

  observer = new MutationObserver((mutations) => {
    let shouldProcess = false;

    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === 'ARTICLE' || node.querySelector?.('article')) {
              shouldProcess = true;
              break;
            }
          }
        }
      }
      if (shouldProcess) break;
    }

    if (shouldProcess) {
      // 延迟处理，等待 DOM 完全渲染
      setTimeout(() => processAllMessages(false), 100);
    }
  });

  observer.observe(targetNode, {
    childList: true,
    subtree: true
  });

  log('info', 'Collapse', 'DOM observer started');
}

/**
 * 停止 DOM 观察器
 */
function stopObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
    log('info', 'Collapse', 'DOM observer stopped');
  }
}

/**
 * 初始化折叠管理器
 */
export async function initCollapseManager() {
  if (isInitialized) return;

  log('info', 'Collapse', 'Initializing collapse manager...');

  // 加载设置
  settings = await getCollapseSettings();
  log('info', 'Collapse', 'Settings loaded:', settings);

  // 注入样式（始终注入，因为按钮始终可用）
  injectStyles();

  // 处理现有消息
  processAllMessages(false);

  // 启动观察器
  startObserver();

  isInitialized = true;
  log('info', 'Collapse', 'Collapse manager initialized');
}

/**
 * 设置变更后更新（不重新初始化，只更新状态）
 */
export async function updateCollapseSettings() {
  log('info', 'Collapse', 'Updating collapse settings...');

  // 重新加载设置
  const oldSettings = { ...settings };
  settings = await getCollapseSettings();

  log('info', 'Collapse', 'Settings updated:', settings);

  // 处理所有消息，应用新设置
  processAllMessages(true);

  log('info', 'Collapse', 'Collapse settings applied');
}

/**
 * 监听来自 popup 的设置变更消息
 */
export function setupSettingsListener() {
  // 监听 chrome.storage 变化
  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[STORAGE_KEYS.COLLAPSE_SETTINGS]) {
      log('info', 'Collapse', 'Settings changed from storage');
      updateCollapseSettings();
    }
  });

  // 监听来自扩展的消息
  chrome.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
    if (message.type === 'COLLAPSE_SETTINGS_CHANGED') {
      log('info', 'Collapse', 'Settings changed from popup');
      updateCollapseSettings().then(() => {
        sendResponse({ success: true });
      });
      return true;
    }
  });
}
