import { log } from '../../shared/utils.js';

/**
 * 从 id 属性中提取 UUID（支持 image-{uuid} 等格式）
 * @param {Element} node - DOM 节点
 * @returns {string|null}
 */
function extractUuidFromIdAttribute(node) {
  const id = node.getAttribute('id');
  if (!id) return null;

  // 匹配 image-{uuid} 格式（图片生成消息）
  const imageMatch = id.match(/^image-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (imageMatch) {
    return imageMatch[1];
  }

  return null;
}

/**
 * 从节点中提取 ID
  * @param {Element} node - DOM 节点
  * @returns {string|null}
 */
export function getUniqueMessageId(node) {
  // 1. 如果节点本身就是 article，尝试查找内部的 message-id
  if (node.tagName === 'ARTICLE') {
    // 1.1 优先查找 data-message-id 属性
    const innerMessage = node.querySelector('[data-message-id]');
    if (innerMessage) return innerMessage.getAttribute('data-message-id');
    if (node.hasAttribute('data-message-id')) return node.getAttribute('data-message-id');

    // 1.2 查找 id="image-{uuid}" 格式（图片生成消息）
    const imageElement = node.querySelector('[id^="image-"]');
    if (imageElement) {
      const uuid = extractUuidFromIdAttribute(imageElement);
      if (uuid) return uuid;
    }

    log('warn', 'MessageIdHelper', 'Article element missing data-message-id attribute');
    return null;
  }

  // 2. 如果节点是 article 内部的某个元素（比如 message div）
  if (node.hasAttribute('data-message-id')) {
    return node.getAttribute('data-message-id');
  }

  // 3. 检查节点自身的 id 属性是否为 image-{uuid} 格式
  const uuid = extractUuidFromIdAttribute(node);
  if (uuid) return uuid;

  return null;
}

/**
 * 从 DOM 节点提取最准确的 UUID
 * 优先级：内部 Message ID > 自身 Message ID > image-{uuid} > null
 * @param {Element} article - 消息元素
 * @returns {string|null} 消息唯一 ID
 */
export function resolveMessageId(article) {
  // 1. 查找内部包含 data-message-id 的元素 (最准确，对应 User/Assistant 内容块)
  const innerMsg = article.querySelector('[data-message-id]');
  if (innerMsg) {
    return innerMsg.getAttribute('data-message-id');
  }

  // 2. 查找 article 自身的 data-message-id (兼容旧版)
  if (article.hasAttribute('data-message-id')) {
    return article.getAttribute('data-message-id');
  }

  // 3. 查找 id="image-{uuid}" 格式（图片生成消息）
  const imageElement = article.querySelector('[id^="image-"]');
  if (imageElement) {
    const uuid = extractUuidFromIdAttribute(imageElement);
    if (uuid) return uuid;
  }

  // 4. 返回空
  return null;
}

/**
 * 根据消息 ID 查找对应的 article 元素
 * 支持 data-message-id、data-turn-id 和 image-{uuid} 格式
 * @param {string} messageId - 消息 ID
 * @returns {Element|null} article 元素
 */
export function findArticleByMessageId(messageId) {
  if (!messageId) return null;

  // 1. 尝试查找内部包含 data-message-id 的 article（最常见）
  let article = document.querySelector(`article:has([data-message-id="${messageId}"])`);
  if (article) return article;

  // 2. 尝试查找 article 自身带有 data-message-id（兼容旧版）
  article = document.querySelector(`article[data-message-id="${messageId}"]`);
  if (article) return article;

  // 3. 尝试查找 data-turn-id（兜底）
  article = document.querySelector(`article[data-turn-id="${messageId}"]`);
  if (article) return article;

  // 4. 尝试查找 id="image-{uuid}" 格式（图片生成消息）
  article = document.querySelector(`article:has([id="image-${messageId}"])`);
  if (article) return article;

  return null;
}

/**
 * 检查消息 ID 是否存在于 DOM 中
 * @param {string} messageId - 消息 ID
 * @returns {boolean} 是否存在
 */
export function messageIdExistsInDOM(messageId) {
  if (!messageId) return false;

  // 检查 data-message-id
  if (document.querySelector(`[data-message-id="${messageId}"]`)) {
    return true;
  }

  // 检查 data-turn-id
  if (document.querySelector(`[data-turn-id="${messageId}"]`)) {
    return true;
  }

  // 检查 id="image-{uuid}" 格式
  if (document.querySelector(`[id="image-${messageId}"]`)) {
    return true;
  }

  return false;
}