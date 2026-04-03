/**
 * 消息提取器
 * 从 ChatGPT 页面的 DOM 中提取消息信息
 */

import { log } from '../../shared/utils.js';
import { resolveMessageId, findArticleByMessageId } from '../utils/message-id-helper.js';

/**
 * 从 DOM article 元素提取消息信息
 * [修正] 全面迁移到 UUID，优化内容提取选择器
 * @param {HTMLElement} article - article 元素
 * @returns {Object|null} 提取的消息数据
 */
export function extractMessageFromDOM(article) {
  if (!article || article.tagName !== 'ARTICLE') {
    return null;
  }

  try {
    // 1. 提取 UUID
    const id = resolveMessageId(article);
    
    // 2. 提取角色 (优先查内部，其次查 article)
    let role = article.getAttribute('data-turn');
    const roleDiv = article.querySelector('[data-message-author-role]');
    if (roleDiv) {
      role = roleDiv.getAttribute('data-message-author-role');
    }

    // Turn Number 仅作参考
    const turnNumber = article.getAttribute('data-testid')?.match(/\d+/)?.[0];

    if (!id || !role) {
      // 只有在连 Turn ID 都没有的情况下才报错
      // log('debug', 'MessageExtractor', 'Missing required attributes', { id, role });
      return null;
    }

    // 3. 提取内容 - 针对不同角色优化选择器
    let content = '';
    let contentEl = null;

    if (role === 'user') {
      // User 消息通常在 .whitespace-pre-wrap 中
      contentEl = article.querySelector('.whitespace-pre-wrap');
    } else {
      // Assistant 消息通常在 .markdown 中
      contentEl = article.querySelector('.markdown');
    }

    // 兜底：如果特定选择器没找到，找包含 text-message 类的元素
    if (!contentEl) {
       contentEl = article.querySelector('[data-message-author-role] > div'); 
    }

    if (contentEl) {
      content = contentEl.innerText.trim(); // 使用 innerText 保留换行格式
    } else {
      // 最后的兜底：遍历查找长文本
      // (保持原有逻辑，但作为最后手段)
      const allDivs = article.querySelectorAll('div');
      let maxLength = 0;
      allDivs.forEach(div => {
        // 排除 script, style 和隐藏元素
        if (div.tagName === 'SCRIPT' || div.style.display === 'none') return;
        const text = div.innerText?.trim() || '';
        if (text.length > maxLength && text.length > 5) { // 稍微降低阈值
          content = text;
          maxLength = text.length;
        }
      });
    }

    // 4. [关键修正] 推断父节点 (使用 UUID)
    let parent = null;
    let prevElement = article.previousElementSibling;

    while (prevElement) {
      if (prevElement.tagName === 'ARTICLE') {
        // 获取前一个 article 的 UUID
        const prevId = resolveMessageId(prevElement);
        if (prevId) {
          parent = prevId;
          break;
        }
      }
      prevElement = prevElement.previousElementSibling;
    }

    const messageData = {
      id: id,            // 现在是 UUID
      role: role,
      content: content,
      parent: parent,    // 指向前一个 UUID
      turnNumber: turnNumber ? parseInt(turnNumber) : null,
      timestamp: Date.now(),
      source: 'dom'
    };

    return messageData;

  } catch (error) {
    log('error', 'MessageExtractor', 'Failed to extract message:', error);
    return null;
  }
}

/**
 * 获取当前页面所有消息
 * [修正] 扫描所有 Article，依赖内部提取逻辑过滤有效消息
 * @returns {Array<Object>} 消息数组
 */
export function getAllMessagesFromDOM() {
  const main = document.querySelector('main');
  if (!main) {
    log('warn', 'MessageExtractor', 'Main element not found');
    return [];
  }

  // [修正] 获取所有 article，不设属性限制，防止漏掉只有 message-id 的节点
  const articles = main.querySelectorAll('article');
  
  const messages = Array.from(articles)
    .map(extractMessageFromDOM)
    .filter(Boolean); // 过滤掉提取失败的 (null)

  log('info', 'MessageExtractor', `Found ${messages.length} valid messages in DOM`);
  return messages;
}

/**
 * 查找最后一条消息
 * @returns {Object|null}
 */
export function getLastMessageFromDOM() {
  const messages = getAllMessagesFromDOM();
  return messages[messages.length - 1] || null;
}

/**
 * 根据 ID 查找消息
 * @param {string} messageId - 消息 ID (UUID 或 TurnID)
 * @returns {Object|null}
 */
export function getMessageByIdFromDOM(messageId) {
  const article = findArticleByMessageId(messageId);
  
  if (!article) {
    return null;
  }

  return extractMessageFromDOM(article);
}
