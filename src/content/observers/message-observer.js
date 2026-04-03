/**
 * 消息 DOM 观察器
 * 使用 MutationObserver 监听新消息的添加
 */

import { log } from '../../shared/utils.js';
import { extractMessageFromDOM } from '../extractors/message-extractor.js';
import { getUniqueMessageId } from '../utils/message-id-helper.js';

/**
 * 消息观察器
 * 负责监听 DOM 变化，识别新消息，并通知上层
 */
export class MessageObserver {
  constructor() {
    this.observer = null;
    this.callback = null;
    this.isRunning = false;
    this.processedMessages = new Set(); // 存储 message-id (UUID)，防止重复处理
    this.pendingMessages = new Map();   // 存储 message-id -> timer

    // 等待 message-id 的 article 追踪
    // WeakMap<HTMLElement, { observer: MutationObserver, timeoutId: number }>
    this.pendingIdObservers = new WeakMap();
    // 用于 stop/reset 时批量清理的引用集合
    this.pendingIdArticles = new Set();

    // 定期扫描定时器（兜底机制）
    this.periodicScanInterval = null;
  }

  /**
   * 启动观察器
   * @param {Function} callback - 检测到新消息时的回调 (article, messageId) => void
   */
  start(callback) {
    if (this.isRunning) {
      log('warn', 'MessageObserver', 'Observer already running');
      return;
    }

    this.callback = callback;
    this.isRunning = true;

    // 1. [核心修复] 初始化当前状态
    // 不能只找 data-turn-id，必须扫描所有 article 并提取 message-id
    const existingArticles = document.querySelectorAll('article');

    let initCount = 0;
    existingArticles.forEach(article => {
      // 使用和 _handleMutations 一致的提取逻辑
      const uniqueId = getUniqueMessageId(article);
      if (uniqueId) {
        this.processedMessages.add(uniqueId);
        initCount++;
      }
    });

    log('info', 'MessageObserver', `Starting message observer`, {
      existingMessages: initCount
    });

    // 2. 查找监听目标
    // 优先监听 main，如果没有 main (不应该啊，可恶) 则回退到 body
    const targetNode = document.querySelector('main') || document.body;

    if (!targetNode) {
      log('error', 'MessageObserver', 'Target node (main/body) not found');
      return;
    }

    // 3. 创建 MutationObserver
    this.observer = new MutationObserver((mutations) => {
      this._handleMutations(mutations);
    });

    // 4. 观察配置
    const config = {
      childList: true,       // 监听节点增删 (新消息出现)
      subtree: true,         // 监听深层变化 (消息容器内部变化)
      attributes: false,     // 通常不需要监听属性，除非 ID 是原地变化的
      characterData: false
    };

    this.observer.observe(targetNode, config);

    // 5. 启动定期扫描（兜底机制）
    this._startPeriodicScan();

    log('info', 'MessageObserver', 'Message observer started');
  }

  /**
   * 停止观察器
   */
  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    // 停止定期扫描
    this._stopPeriodicScan();

    this.processedMessages.clear();
    this.pendingMessages.forEach(timer => clearTimeout(timer));
    this.pendingMessages.clear();

    // 清理等待 ID 的 observers
    this._cleanupAllPendingIdObservers();

    this.isRunning = false;
    log('info', 'MessageObserver', 'Message observer stopped');
  }

  /**
   * 处理 DOM 变化
   * @private
   */
  _handleMutations(mutations) {
    for (const mutation of mutations) {
      // 检查新增的节点
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          this._checkForNewMessage(node);
        }
      });
    }
  }

  /**
   * 检查是否是新消息
   * @private
   */
  _checkForNewMessage(node) {
    // 场景 A: 插入的节点本身就是 Article (通常发生在页面加载或大块更新)
    if (node.tagName === 'ARTICLE') {
      this._processNewArticle(node);
      return;
    }

    // 场景 B: 插入的是一个容器，里面包含了 Article (常见于 React 渲染)
    if (node.querySelectorAll) {
      // [修正] 不再只找 article[data-turn-id]，而是找所有可能包含消息的容器
      const articles = node.querySelectorAll('article');
      articles.forEach(article => this._processNewArticle(article));
    }
  }

  /**
   * 处理新的 article 元素
   * @private
   */
  _processNewArticle(article) {
    // [修正 1] 获取真正的唯一 ID (Message UUID)
    const uniqueId = getUniqueMessageId(article);

    // 过滤掉 placeholder ID（临时占位符，不是真正的消息）
    // placeholder-request-* 是 ChatGPT 流式输出开始前的临时 ID
    if (!uniqueId || uniqueId.startsWith('placeholder-')) {
      // message-id 还没生成，启动监听等待
      // 防重：如果已经在监听这个 article，直接跳过
      if (this.pendingIdObservers.has(article)) {
        return;
      }

      // 启动监听
      this._watchForMessageId(article);
      return;
    }

    // 清理：如果之前在等待这个 article 的 ID，现在拿到了，清理监听器
    this._cleanupPendingIdObserver(article);

    // [修正 2] 查重逻辑基于 UUID，而不是轮次 ID
    // 这样，即使是同一轮次(Turn)的新生成版本，ID 也不同，不会被拦截
    if (this.processedMessages.has(uniqueId)) {
      return;
    }

    // 获取角色 (兼容不同结构)
    let role = article.getAttribute('data-turn');
    if (!role) {
        // 尝试从内部寻找角色定义
        const messageDiv = article.querySelector('[data-message-author-role]');
        if (messageDiv) role = messageDiv.getAttribute('data-message-author-role');
    }

    log('info', 'MessageObserver', `New message detected`, {
      id: uniqueId.substring(0, 8) + '...',
      role: role || 'unknown'
    });

    // 将 UUID 加入已处理集合，防止重复处理
    this.processedMessages.add(uniqueId);

    // User 消息立即处理，Assistant 消息需要等待完成
    if (role === 'user') {
      this._extractAndNotify(article, uniqueId); // 传入 ID
    } else if (role === 'assistant') {
      this._waitForAssistantMessage(article, uniqueId); // 传入 ID
    }
  }

  /**
   * 监听 article 等待 message-id 出现
   * @private
   * @param {HTMLElement} article - 消息 DOM 节点
   */
  _watchForMessageId(article) {
    // 等待 message-id 属性出现的超时时间
    // 注意：这是等待 ID 出现，不是等待消息生成完成
    // 正常情况下 ID 应该在 1 秒内出现，10 秒是安全兜底
    const TIMEOUT_MS = 10000;

    const observer = new MutationObserver(() => {
      const uniqueId = getUniqueMessageId(article);
      if (uniqueId && !uniqueId.startsWith('placeholder-')) {
        // 找到了真正的 ID（非 placeholder），清理资源并重新处理
        this._cleanupPendingIdObserver(article);
        this._processNewArticle(article);
      }
    });

    // 超时保护
    const timeoutId = setTimeout(() => {
      this._cleanupPendingIdObserver(article);
      log('warn', 'MessageObserver', 'Timeout waiting for message-id', {
        turnId: article.getAttribute('data-turn-id')
      });
    }, TIMEOUT_MS);

    // 记录到追踪结构
    this.pendingIdObservers.set(article, { observer, timeoutId });
    this.pendingIdArticles.add(article);

    // 开始观察
    observer.observe(article, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-message-id']
    });

    log('debug', 'MessageObserver', 'Started watching for message-id', {
      turnId: article.getAttribute('data-turn-id')
    });
  }

  /**
   * 清理单个 article 的 pending ID observer
   * @private
   * @param {HTMLElement} article
   */
  _cleanupPendingIdObserver(article) {
    const pending = this.pendingIdObservers.get(article);
    if (pending) {
      pending.observer.disconnect();
      clearTimeout(pending.timeoutId);
      this.pendingIdObservers.delete(article);
      this.pendingIdArticles.delete(article);
    }
  }

  /**
   * 清理所有 pending ID observers
   * @private
   */
  _cleanupAllPendingIdObservers() {
    for (const article of this.pendingIdArticles) {
      const pending = this.pendingIdObservers.get(article);
      if (pending) {
        pending.observer.disconnect();
        clearTimeout(pending.timeoutId);
      }
    }
    // WeakMap 会自动清理，Set 需要手动清空
    this.pendingIdArticles.clear();
  }

  /**
   * 等待 Assistant 消息完成
   * @private
   */
  _waitForAssistantMessage(article, uniqueId) {
    // [修正 1] 使用 uniqueId 作为 Pending Map 的 Key
    if (this.pendingMessages.has(uniqueId)) {
      clearTimeout(this.pendingMessages.get(uniqueId));
    }

    const checkComplete = () => {
      // [修正 2] 检查流式输出状态
      // 注意：这里的 _isMessageStreaming 最好也能传入 article 范围，避免判断成了别的消息
      const isStreaming = this._isMessageStreaming(article);

      if (isStreaming) {
        // 还在输出，继续等待
        // log('debug', 'MessageObserver', 'Message still streaming...', uniqueId.substring(0,8));
        const timer = setTimeout(checkComplete, 1000);
        this.pendingMessages.set(uniqueId, timer);
      } else {
        // 输出完成
        log('info', 'MessageObserver', 'Message streaming complete', uniqueId);

        // 清理定时器记录
        this.pendingMessages.delete(uniqueId);

        // [修正 3] 再次确认 article 是否还存在于 DOM 中 (防止用户生成中途切走了分支)
        if (document.body.contains(article)) {
             this._extractAndNotify(article, uniqueId);
        } else {
             log('warn', 'MessageObserver', 'Message removed from DOM before completion', uniqueId);
        }
      }
    };

    // 首次检查延迟 500ms
    const timer = setTimeout(checkComplete, 500);
    this.pendingMessages.set(uniqueId, timer);
  }

  /**
   * 检查是否正在流式输出
   * @private
   * @param {HTMLElement} [article] - 可选，当前消息节点，用于辅助检查
   * @returns {boolean}
   */
  _isMessageStreaming(article) {
    // [首选策略] 全局检查：查找输入框的"停止生成"按钮
    // 根据你提供的 HTML: <button ... data-testid="stop-button" ...>
    const stopButton = document.querySelector('[data-testid="stop-button"]');

    // 只要这个按钮存在，就说明 AI 正在生成中
    if (stopButton) {
      return true;
    }

    // [备选策略 1] 语言兜底 (防止 data-testid 在某些 A/B 测试中消失)
    // 你提供的 aria-label 是 "停止流式传输"，包含 "停止" 二字
    const stopButtonByLabel = document.querySelector('button[aria-label*="停止"]') ||
                              document.querySelector('button[aria-label*="Stop"]');
    if (stopButtonByLabel) {
      return true;
    }

    return false;
  }

  /**
   * 提取消息并通知
   * [修复] 接收 uniqueId 参数，不再依赖 turn-id，确保数据一致性
   * @private
   * @param {HTMLElement} article - 消息 DOM 节点
   * @param {string} uniqueId - 消息的唯一 ID (UUID)
   */
  _extractAndNotify(article, uniqueId) {
    // 1. 容错处理：如果调用方没传 ID (虽然不应该发生)，尝试重新提取
    const id = uniqueId || getUniqueMessageId(article);

    if (!id) {
      log('warn', 'MessageObserver', 'Cannot extract unique ID for notification');
      return;
    }

    // 2. 标记为已处理 (双重保险)
    // 虽然 _processNewArticle 已经加过一次，但在这里确认一下没有坏处
    this.processedMessages.add(id);

    // 3. 提取消息内容
    // 注意：你需要确保 extractMessageFromDOM 函数内部也优先提取 message-id
    const messageData = extractMessageFromDOM(article);

    if (!messageData) {
      log('warn', 'MessageObserver', 'Failed to extract message data from DOM');
      return;
    }

    // DOM 解析有时候可能会拿到旧的 ID 或 Turn ID，这里我们强制覆盖为我们确定的 UUID
    messageData.id = id;

    log('info', 'MessageObserver', 'Message extracted successfully', {
      id: messageData.id.substring(0, 8) + '...',
      role: messageData.role,
      contentLength: messageData.content ? messageData.content.length : 0
    });

    // 4. 触发回调
    if (this.callback) {
      try {
        // 使用 Promise.resolve 确保异步回调不会阻塞当前流程
        Promise.resolve(this.callback(messageData)).catch(error => {
          log('error', 'MessageObserver', 'Callback execution error:', error);
        });
      } catch (error) {
        log('error', 'MessageObserver', 'Callback trigger error:', error);
      }
    }
  }

  /**
   * 获取已处理的消息数量
   * @returns {number}
   */
  getProcessedCount() {
    return this.processedMessages.size;
  }

  /**
   * 检查观察器是否正在运行
   * @returns {boolean}
   */
  isObserving() {
    return this.isRunning;
  }

  /**
   * 启动定期扫描（兜底机制）
   * 每隔 3 秒扫描一次 DOM，检查是否有遗漏的未处理消息
   * 仅在非流式输出期间执行扫描
   * @private
   */
  _startPeriodicScan() {
    this._stopPeriodicScan();

    const SCAN_INTERVAL_MS = 3000;

    this.periodicScanInterval = setInterval(() => {
      // 流式输出期间跳过扫描（避免处理到不完整的消息）
      if (this._isMessageStreaming()) {
        return;
      }

      const articles = document.querySelectorAll('article');
      let newCount = 0;

      articles.forEach(article => {
        const uniqueId = getUniqueMessageId(article);

        // 跳过无 ID、placeholder、已处理的消息
        if (!uniqueId || uniqueId.startsWith('placeholder-') || this.processedMessages.has(uniqueId)) {
          return;
        }

        newCount++;
        this._processNewArticle(article);
      });

      if (newCount > 0) {
        log('info', 'MessageObserver', `Periodic scan found ${newCount} new message(s)`);
      }
    }, SCAN_INTERVAL_MS);

    log('debug', 'MessageObserver', 'Periodic scan started (interval: 3s)');
  }

  /**
   * 停止定期扫描
   * @private
   */
  _stopPeriodicScan() {
    if (this.periodicScanInterval) {
      clearInterval(this.periodicScanInterval);
      this.periodicScanInterval = null;
    }
  }

  /**
   * 清空已处理消息列表（用于对话切换时）
   */
  reset() {
    log('info', 'MessageObserver', 'Resetting observer state');
    this.processedMessages.clear();
    this.pendingMessages.forEach(timer => clearTimeout(timer));
    this.pendingMessages.clear();

    // 清理等待 ID 的 observers
    this._cleanupAllPendingIdObservers();
  }
}

/**
 * 创建并启动消息观察器
 * @param {Function} callback - 新消息回调 (messageData) => void
 * @returns {MessageObserver}
 */
export function createMessageObserver(callback) {
  const observer = new MessageObserver();
  try {
    observer.start(callback);
  } catch (e) {
    log('error', 'MessageObserver', 'Failed to start observer via factory:', e);
  }
  return observer;
}
