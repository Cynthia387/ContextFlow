/**
 * 通用工具函数
 */

import { LOG_PREFIX, STORAGE_KEYS } from './constants.js';

// Debug log enabled state (cached in memory, default: false)
let debugLogEnabled = false;

// Debug log levels (which levels to show when debug is enabled)
// Default: all enabled
let debugLogLevels = {
  verbose: true,  // log, debug, info
  warn: true,
  error: true
};

/**
 * Initialize debug log setting from storage
 */
export async function initDebugLogSetting() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const result = await chrome.storage.local.get([
        STORAGE_KEYS.DEBUG_LOG_ENABLED,
        STORAGE_KEYS.DEBUG_LOG_LEVELS
      ]);
      debugLogEnabled = result[STORAGE_KEYS.DEBUG_LOG_ENABLED] === true;
      if (result[STORAGE_KEYS.DEBUG_LOG_LEVELS]) {
        debugLogLevels = { ...debugLogLevels, ...result[STORAGE_KEYS.DEBUG_LOG_LEVELS] };
      }
    }
  } catch (e) {
    // Ignore errors (e.g., in non-extension context)
  }
}

/**
 * Set debug log enabled state
 * @param {boolean} enabled
 */
export async function setDebugLogEnabled(enabled) {
  debugLogEnabled = enabled;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      await chrome.storage.local.set({ [STORAGE_KEYS.DEBUG_LOG_ENABLED]: enabled });
    }
  } catch (e) {
    // Ignore errors
  }
}

/**
 * Get debug log enabled state
 * @returns {boolean}
 */
export function getDebugLogEnabled() {
  return debugLogEnabled;
}

/**
 * Set debug log levels
 * @param {Object} levels - { verbose: boolean, warn: boolean, error: boolean }
 */
export async function setDebugLogLevels(levels) {
  debugLogLevels = { ...debugLogLevels, ...levels };
  try {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      await chrome.storage.local.set({ [STORAGE_KEYS.DEBUG_LOG_LEVELS]: debugLogLevels });
    }
  } catch (e) {
    // Ignore errors
  }
}

/**
 * Get debug log levels
 * @returns {Object}
 */
export function getDebugLogLevels() {
  return { ...debugLogLevels };
}

/**
 * 格式化日志
 * @param {string} level - 日志级别
 * @param {string} module - 模块名
 * @param {...any} args - 参数
 */
export function log(level, module, ...args) {
  // If debug logging is disabled, don't log anything
  if (!debugLogEnabled) {
    return;
  }

  // Check if this level is enabled
  if (level === 'error') {
    if (!debugLogLevels.error) return;
  } else if (level === 'warn') {
    if (!debugLogLevels.warn) return;
  } else {
    // log, debug, info are all "verbose"
    if (!debugLogLevels.verbose) return;
  }

  const prefix = `${LOG_PREFIX}[${module}]`;
  console[level](prefix, ...args);
}

/**
 * 延迟执行
 * @param {number} ms - 毫秒数
 * @returns {Promise<void>}
 */
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 重试函数
 * @param {Function} fn - 要执行的函数
 * @param {number} maxRetries - 最大重试次数
 * @param {number} delayMs - 重试间隔（毫秒）
 * @returns {Promise<any>}
 */
export async function retry(fn, maxRetries = 3, delayMs = 1000) {
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      log('warn', 'Utils', `Retry ${i + 1}/${maxRetries} failed:`, error.message);

      if (i < maxRetries - 1) {
        await delay(delayMs);
      }
    }
  }

  throw lastError;
}

/**
 * 安全的 JSON 解析
 * @param {string} jsonString - JSON 字符串
 * @param {any} defaultValue - 默认值
 * @returns {any}
 */
export function safeJSONParse(jsonString, defaultValue = null) {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    log('error', 'Utils', 'JSON parse error:', error);
    return defaultValue;
  }
}

/**
 * 生成唯一 ID
 * @returns {string}
 */
export function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 深拷贝对象
 * @param {any} obj - 对象
 * @returns {any}
 */
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime());
  }

  if (obj instanceof Array) {
    return obj.map(item => deepClone(item));
  }

  if (obj instanceof Object) {
    const clonedObj = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = deepClone(obj[key]);
      }
    }
    return clonedObj;
  }
}

/**
 * 节流函数
 * @param {Function} fn - 要节流的函数
 * @param {number} wait - 等待时间（毫秒）
 * @returns {Function}
 */
export function throttle(fn, wait) {
  let lastTime = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastTime >= wait) {
      lastTime = now;
      return fn.apply(this, args);
    }
  };
}

/**
 * 防抖函数
 * @param {Function} fn - 要防抖的函数
 * @param {number} wait - 等待时间（毫秒）
 * @returns {Function}
 */
export function debounce(fn, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      fn.apply(this, args);
    }, wait);
  };
}

/**
 * 从 URL 提取对话 ID
 * @param {string} [url] - URL，默认为当前页面 URL
 * @returns {string|null}
 */
export function extractConversationId(url = window.location.pathname) {
  const match = url.match(/\/c\/([a-f0-9-]+)/);
  return match ? match[1] : null;
}

/**
 * 检查是否在 ChatGPT 页面
 * @returns {boolean}
 */
export function isChatGPTPage() {
  return /^https:\/\/(chatgpt\.com|chat\.openai\.com)/.test(window.location.href);
}

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * 截断字符串
 * @param {string} str - 字符串
 * @param {number} maxLength - 最大长度
 * @returns {string}
 */
export function truncate(str, maxLength = 100) {
  if (!str || str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength) + '...';
}
