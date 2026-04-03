/**
 * Token 管理模块
 * 支持自动捕获和手动配置两种方式获取 token
 */

import { log } from '../../shared/utils.js';

// Token 缓存
let capturedToken = null;
let cachedAuthInfo = null;
let tokenSource = null; // 'auto' 或 'manual'

/**
 * 获取 Cookie 值
 * @param {string} name - Cookie 名称
 * @returns {string|null}
 */
function getCookie(name) {
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [cookieName, cookieValue] = cookie.trim().split('=');
    if (cookieName === name) {
      return decodeURIComponent(cookieValue);
    }
  }
  return null;
}

/**
 * 从 chrome.storage 加载 token
 * 支持自动捕获和手动配置的 token
 * @returns {Promise<boolean>} 是否成功加载有效 token
 */
export async function loadToken() {
  try {
    const result = await chrome.storage.local.get([
      'accessToken',
      'tokenTimestamp',
      'tokenSource'
    ]);

    if (result.accessToken) {
      // 检查 token 是否过期（24小时）
      const age = Date.now() - (result.tokenTimestamp || 0);
      const maxAge = 24 * 60 * 60 * 1000; // 24小时

      if (age < maxAge) {
        capturedToken = result.accessToken;
        tokenSource = result.tokenSource || 'unknown';
        cachedAuthInfo = null; // 清除缓存，强制使用新 token

        log('info', 'Token', 'Loaded token from storage', {
          source: tokenSource,
          length: capturedToken.length,
          age: Math.floor(age / 1000 / 60) + ' minutes'
        });
        return true;
      } else {
        log('warn', 'Token', 'Stored token expired (>24h), waiting for auto-capture');
        capturedToken = null;
        tokenSource = null;
        return false;
      }
    }

    log('warn', 'Token', 'No token found in storage, waiting for auto-capture');
    return false;
  } catch (error) {
    log('error', 'Token', 'Failed to load token:', error);
    return false;
  }
}

/**
 * 初始化 token 监听器
 * 监听 storage 变化，自动更新 token
 */
export function initTokenListener() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.accessToken) {
      const newToken = changes.accessToken.newValue;
      const newSource = changes.tokenSource?.newValue || 'auto';

      if (newToken && newToken !== capturedToken) {
        capturedToken = newToken;
        tokenSource = newSource;
        cachedAuthInfo = null; // 清除缓存

        log('info', 'Token', 'Token auto-updated from storage', {
          source: tokenSource,
          length: capturedToken.length
        });
      } else if (!newToken) {
        // Token 被清除
        capturedToken = null;
        tokenSource = null;
        cachedAuthInfo = null;
        log('info', 'Token', 'Token cleared from storage');
      }
    }
  });

  log('info', 'Token', 'Token listener initialized');
}

/**
 * 获取当前 token
 * @returns {string|null}
 */
export function getToken() {
  return capturedToken;
}

/**
 * 检查是否有 token
 * @returns {boolean}
 */
export function hasToken() {
  return !!capturedToken;
}

/**
 * 获取 token 来源
 * @returns {string|null} 'auto' 或 'manual'
 */
export function getTokenSource() {
  return tokenSource;
}

/**
 * 获取认证信息，包括 token、accountId、deviceId
 * @returns {Object}
 */
function getAuthInfo() {
  if (cachedAuthInfo && Date.now() - cachedAuthInfo.timestamp < 60000) {
    return cachedAuthInfo.data;
  }

  const authInfo = {
    accessToken: capturedToken,
    accountId: getCookie('_account'),
    deviceId: getCookie('oai-did')
  };

  cachedAuthInfo = {
    data: authInfo,
    timestamp: Date.now()
  };

  log('info', 'API', 'Auth info retrieved:', {
    hasToken: !!authInfo.accessToken,
    hasAccountId: !!authInfo.accountId,
    hasDeviceId: !!authInfo.deviceId,
    tokenSource: tokenSource || 'none'
  });

  return authInfo;
}

/**
 * 清除认证缓存
 */
export function clearAuthCache() {
  cachedAuthInfo = null;
  log('info', 'API', 'Auth cache cleared');
}

/**
 * 构建包含 token 的请求头
 * @returns {Object}
 */
export function buildAuthHeaders() {
  const authInfo = getAuthInfo();

  const headers = {
    'accept': '*/*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'oai-language': 'zh-CN',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin'
  };

  if (authInfo.accessToken) {
    headers['authorization'] = `Bearer ${authInfo.accessToken}`;
  } else {
    log('warn', 'API', 'No access token available, request may fail');
  }

  if (authInfo.accountId) {
    headers['chatgpt-account-id'] = authInfo.accountId;
  }

  if (authInfo.deviceId) {
    headers['oai-device-id'] = authInfo.deviceId;
  }

  return headers;
}

/**
 * 获取 token 状态信息（用于 UI 显示）
 * @returns {Promise<Object>}
 */
export async function getTokenStatus() {
  try {
    const result = await chrome.storage.local.get([
      'accessToken',
      'tokenTimestamp',
      'tokenSource',
      'tokenInfo'
    ]);

    if (!result.accessToken) {
      return {
        hasToken: false,
        source: null,
        isExpired: true,
        message: 'No token found'
      };
    }

    const age = Date.now() - (result.tokenTimestamp || 0);
    const maxAge = 24 * 60 * 60 * 1000;
    const isExpired = age >= maxAge;

    return {
      hasToken: true,
      source: result.tokenSource || 'unknown',
      age: age,
      ageMinutes: Math.floor(age / 1000 / 60),
      isExpired: isExpired,
      tokenLength: result.accessToken.length,
      message: isExpired ? 'Token expired' : 'Token valid'
    };
  } catch (error) {
    log('error', 'Token', 'Error getting token status:', error);
    return {
      hasToken: false,
      source: null,
      isExpired: true,
      error: error.message
    };
  }
}
