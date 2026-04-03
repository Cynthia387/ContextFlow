/**
 * URL 监听器模块
 * 监听对话 URL 变化，用于检测用户切换对话
 *
 * ChatGPT 是 SPA 应用，使用 History API 进行路由切换
 * 需要同时监听 popstate 事件和定时轮询来捕获所有变化
 */

import { log, extractConversationId } from '../../shared/utils.js';
import { isConversationPage } from '../utils/dom-helper.js';

/**
 * URL 观察器类
 */
export class URLObserver {
  constructor() {
    this.currentUrl = window.location.href;
    this.currentConversationId = null;
    this.callback = null;
    this.pollingInterval = null;
    this.isRunning = false;
  }

  /**
   * 启动 URL 监听
   * @param {Function} callback - URL 变化时的回调函数 (newConversationId, oldConversationId) => void
   * @param {number} pollingIntervalMs - 轮询间隔（毫秒），默认 1000ms
   */
  start(callback, pollingIntervalMs = 1000) {
    if (this.isRunning) {
      log('warn', 'URLObserver', 'Observer already running');
      return;
    }

    this.callback = callback;
    this.currentConversationId = extractConversationId();
    this.isRunning = true;

    log('info', 'URLObserver', 'Starting URL observer', {
      initialUrl: this.currentUrl,
      initialConversationId: this.currentConversationId,
      pollingInterval: pollingIntervalMs
    });

    // 监听浏览器前进/后退
    window.addEventListener('popstate', this._handleUrlChange.bind(this));

    // 监听 pushState 和 replaceState（拦截 History API）
    this._interceptHistoryAPI();

    // 定时轮询作为兜底方案（防止某些情况下事件未触发）
    this.pollingInterval = setInterval(() => {
      this._checkUrlChange();
    }, pollingIntervalMs);

    log('info', 'URLObserver', 'URL observer started');
  }

  /**
   * 停止 URL 监听
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    log('info', 'URLObserver', 'Stopping URL observer');

    window.removeEventListener('popstate', this._handleUrlChange.bind(this));

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    // 恢复原始 History API
    this._restoreHistoryAPI();

    this.isRunning = false;
    log('info', 'URLObserver', 'URL observer stopped');
  }

  /**
   * 检查 URL 是否变化
   * @private
   */
  _checkUrlChange() {
    const newUrl = window.location.href;

    if (newUrl !== this.currentUrl) {
      this.currentUrl = newUrl;
      this._handleUrlChange();
    }
  }

  /**
   * 处理 URL 变化
   * @private
   */
  _handleUrlChange() {
    // 检查扩展上下文是否仍然有效
    if (!chrome.runtime?.id) {
      log('warn', 'URLObserver', 'Extension context invalidated, stopping observer');
      this.stop();
      return;
    }

    // 检查是否仍在对话页面
    if (!isConversationPage()) {
      log('info', 'URLObserver', 'Navigated away from conversation page');
      return;
    }

    const newConversationId = extractConversationId();

    // 检查对话 ID 是否变化
    if (newConversationId && newConversationId !== this.currentConversationId) {
      const oldConversationId = this.currentConversationId;
      this.currentConversationId = newConversationId;

      log('info', 'URLObserver', 'Conversation switched', {
        from: oldConversationId || '(none)',
        to: newConversationId
      });

      // 触发回调
      if (this.callback) {
        try {
          // 使用 Promise 包装以支持异步回调
          Promise.resolve(this.callback(newConversationId, oldConversationId)).catch(error => {
            log('error', 'URLObserver', 'Callback error:', error);
          });
        } catch (error) {
          log('error', 'URLObserver', 'Callback error:', error);
        }
      }
    }
  }

  /**
   * 拦截 History API 以捕获 pushState 和 replaceState
   * @private
   */
  _interceptHistoryAPI() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    // 保存原始方法以便恢复
    this._originalPushState = originalPushState;
    this._originalReplaceState = originalReplaceState;

    // 拦截 pushState
    history.pushState = (...args) => {
      originalPushState.apply(history, args);
      this._handleUrlChange();
    };

    // 拦截 replaceState
    history.replaceState = (...args) => {
      originalReplaceState.apply(history, args);
      this._handleUrlChange();
    };

    log('debug', 'URLObserver', 'History API intercepted');
  }

  /**
   * 恢复原始 History API
   * @private
   */
  _restoreHistoryAPI() {
    if (this._originalPushState) {
      history.pushState = this._originalPushState;
    }
    if (this._originalReplaceState) {
      history.replaceState = this._originalReplaceState;
    }

    log('debug', 'URLObserver', 'History API restored');
  }

  /**
   * 获取当前对话 ID
   * @returns {string|null}
   */
  getCurrentConversationId() {
    return this.currentConversationId;
  }

  /**
   * 检查观察器是否正在运行
   * @returns {boolean}
   */
  isObserving() {
    return this.isRunning;
  }
}

/**
 * 创建并启动 URL 观察器
 * @param {Function} callback - URL 变化时的回调函数
 * @param {number} pollingIntervalMs - 轮询间隔（毫秒）
 * @returns {URLObserver}
 */
export function createURLObserver(callback, pollingIntervalMs = 1000) {
  const observer = new URLObserver();
  observer.start(callback, pollingIntervalMs);
  return observer;
}
