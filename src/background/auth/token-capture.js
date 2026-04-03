/**
 * Token 自动捕获模块
 * 监听发往 ChatGPT 的请求，自动捕获 Authorization 头中的 token
 */

// Token 信息缓存
let latestTokenInfo = {
  value: '',
  timestamp: 0,
  url: '',
  source: 'auto'
};

// 目标 URL 模式
const TARGET_URLS = [
  'https://chatgpt.com/*',
  'https://chat.openai.com/*'
];

/**
 * 初始化 webRequest 监听器
 */
export function initTokenCapture() {
  try {
    // 检查 webRequest API 是否可用
    if (!chrome.webRequest || !chrome.webRequest.onSendHeaders) {
      console.warn('[TokenCapture] webRequest API not available');
      return false;
    }

    chrome.webRequest.onSendHeaders.addListener(
      onSendHeadersHandler,
      { urls: TARGET_URLS },
      ['requestHeaders', 'extraHeaders']
    );

    console.log('[TokenCapture] ✓ WebRequest listener initialized');
    console.log('[TokenCapture] Monitoring URLs:', TARGET_URLS);
    return true;
  } catch (error) {
    console.error('[TokenCapture] Failed to initialize listener:', error);
    return false;
  }
}

/**
 * 请求头监听处理器
 * @param {Object} details - 请求详情
 */
function onSendHeadersHandler(details) {
  if (!details.requestHeaders) return;

  // 只处理主框架和 XHR/fetch 请求
  if (details.type !== 'main_frame' && details.type !== 'xmlhttprequest') {
    return;
  }

  for (const header of details.requestHeaders) {
    if (header.name.toLowerCase() === 'authorization') {
      const token = header.value;

      // 验证是 Bearer token
      if (!token || !token.startsWith('Bearer ')) continue;

      const accessToken = token.substring(7); // 移除 "Bearer " 前缀

      // 验证 token 格式（JWT 通常以 eyJ 开头）
      if (!accessToken.startsWith('eyJ')) continue;

      // 检查是否是新 token（避免重复存储）
      if (accessToken === latestTokenInfo.value) {
        return;
      }

      // 更新缓存
      latestTokenInfo = {
        value: accessToken,
        timestamp: Date.now(),
        url: details.url,
        source: 'auto'
      };

      // 异步保存到 storage
      saveTokenToStorage(accessToken, details.url);

      return; // 找到 Authorization 头后停止
    }
  }
}

/**
 * 保存 token 到 storage
 * @param {string} accessToken - 访问令牌
 * @param {string} sourceUrl - 来源 URL
 */
async function saveTokenToStorage(accessToken, sourceUrl) {
  try {
    await chrome.storage.local.set({
      accessToken: accessToken,
      tokenTimestamp: Date.now(),
      tokenSource: 'auto',
      tokenInfo: {
        value: accessToken,
        timestamp: Date.now(),
        url: sourceUrl,
        source: 'auto'
      }
    });

    console.log('[TokenCapture] ✓ Token auto-captured and saved', {
      url: sourceUrl.substring(0, 60) + '...',
      tokenLength: accessToken.length,
      tokenPreview: accessToken.substring(0, 20) + '...'
    });

    // 通知其他组件 token 已更新
    try {
      chrome.runtime.sendMessage({
        type: 'TOKEN_UPDATED',
        payload: {
          source: 'auto',
          timestamp: Date.now()
        }
      }).catch(() => {
        // 忽略没有接收者的错误
      });
    } catch (e) {
      // 忽略消息发送错误
    }

  } catch (error) {
    console.error('[TokenCapture] Failed to save token:', error);
  }
}

/**
 * 获取当前捕获的 token 信息
 * @returns {Object} token 信息
 */
export function getLatestTokenInfo() {
  return { ...latestTokenInfo };
}

/**
 * 检查是否已捕获有效 token
 * @returns {Promise<boolean>}
 */
export async function hasValidToken() {
  try {
    const result = await chrome.storage.local.get(['accessToken', 'tokenTimestamp']);
    if (!result.accessToken) return false;

    const age = Date.now() - (result.tokenTimestamp || 0);
    const maxAge = 24 * 60 * 60 * 1000; // 24小时
    return age < maxAge;
  } catch (error) {
    console.error('[TokenCapture] Error checking token validity:', error);
    return false;
  }
}

/**
 * 获取 token 状态信息
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
        age: null,
        isExpired: true
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
      captureUrl: result.tokenInfo?.url || null
    };
  } catch (error) {
    console.error('[TokenCapture] Error getting token status:', error);
    return {
      hasToken: false,
      source: null,
      age: null,
      isExpired: true,
      error: error.message
    };
  }
}

/**
 * 清除已保存的 token
 * @returns {Promise<boolean>}
 */
export async function clearToken() {
  try {
    await chrome.storage.local.remove([
      'accessToken',
      'tokenTimestamp',
      'tokenSource',
      'tokenInfo'
    ]);
    latestTokenInfo = {
      value: '',
      timestamp: 0,
      url: '',
      source: 'auto'
    };
    console.log('[TokenCapture] Token cleared');
    return true;
  } catch (error) {
    console.error('[TokenCapture] Failed to clear token:', error);
    return false;
  }
}
