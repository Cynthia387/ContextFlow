/**
 * DOM 辅助工具
 */

import { DOM_SELECTORS } from '../../shared/constants.js';
import { log } from '../../shared/utils.js';


/**
 * 等待元素出现
 * @param {string} selector - CSS 选择器
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<Element|null>}
 */
export function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }

    const observer = new MutationObserver((mutations, obs) => {
      const element = document.querySelector(selector);
      if (element) {
        obs.disconnect();
        resolve(element);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

/**
 * 检查是否为对话页面
 * @returns {boolean}
 */
export function isConversationPage() {
  return /\/c\/[a-f0-9-]+/.test(window.location.pathname);
}

/**
 * 获取页面上的所有消息元素
 * @returns {Element[]}
 */
export function getAllMessageElements() {
  return Array.from(document.querySelectorAll(DOM_SELECTORS.ARTICLE));
}

/**
 * 解析消息元素
 * @param {Element} article - 消息元素
 * @returns {Object|null} 解析结果
 */
export function parseMessageElement(article) {
  try {
    const heading = article.querySelector('h5, h6');
    if (!heading) {
      return null;
    }

    const role = heading.textContent.includes('你说') ? 'user' : 'assistant';

    // 提取内容（排除按钮和分支切换器）
    const contentElements = article.querySelectorAll('p, [class*="markdown"]');
    const content = Array.from(contentElements)
      .filter(el => !el.closest('button') && !el.closest('[aria-label*="回复"]'))
      .map(el => el.textContent)
      .join('\n')
      .trim();

    // 检查分支切换器
    const branchInfo = parseBranchSwitcher(article);

    return {
      role,
      content,
      branchInfo,
      element: article
    };
  } catch (error) {
    log('error', 'DOMHelper', 'Failed to parse message element:', error);
    return null;
  }
}

/**
 * 解析分支切换器
 * @param {Element} article - 消息元素
 * @returns {Object|null} 分支信息
 */
function parseBranchSwitcher(article) {
  try {
    const buttons = Array.from(article.querySelectorAll('button[aria-label*="回复"]'));
    if (buttons.length === 0) {
      return null;
    }

    // 找到包含 "N/M" 文本的容器
    const container = buttons[0].closest('div');
    if (!container) {
      return null;
    }

    const match = container.textContent.match(/(\d+)\/(\d+)/);
    if (!match) {
      return null;
    }

    return {
      current: parseInt(match[1]),
      total: parseInt(match[2])
    };
  } catch (error) {
    return null;
  }
}

/**
 * 标记元素（添加自定义属性）
 * @param {Element} element - 元素
 * @param {string} id - 标识
 */
export function markElement(element, id) {
  element.setAttribute('data-graph-id', id);
}

/**
 * 获取元素标记
 * @param {Element} element - 元素
 * @returns {string|null}
 */
export function getElementMark(element) {
  return element.getAttribute('data-graph-id');
}

/**
 * 高亮元素
 * @param {Element} element - 元素
 * @param {number} duration - 持续时间（毫秒）
 */
export function highlightElement(element, duration = 2000) {
  const originalBg = element.style.backgroundColor;
  const originalTransition = element.style.transition;

  element.style.transition = 'background-color 0.3s';
  element.style.backgroundColor = '#ffeb3b33';

  setTimeout(() => {
    element.style.backgroundColor = originalBg;
    setTimeout(() => {
      element.style.transition = originalTransition;
    }, 300);
  }, duration);
}

/**
 * 滚动到元素
 * @param {Element} element - 元素
 * @param {boolean} smooth - 是否平滑滚动
 */
export function scrollToElement(element, smooth = true) {
  element.scrollIntoView({
    behavior: smooth ? 'smooth' : 'auto',
    block: 'center'
  });
}
