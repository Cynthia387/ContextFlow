/**
 * ContextFlow Extension - Main World Script
 * 此脚本运行在页面的 main world 中，可以拦截页面的 fetch 请求
 */

(function() {
  'use strict';

  console.log('[ContextFlow][MainWorld] Script loaded in MAIN world');

  let capturedToken = null;
  const originalFetch = window.fetch.bind(window);

  // 创建拦截函数
  const interceptedFetch = function(...args) {
    const [url, options] = args;

    // 尝试从请求中提取 authorization header
    try {
      if (options && options.headers && url && url.includes('/backend-api/')) {
        const headers = options.headers;
        let authHeader = null;

        if (headers instanceof Headers) {
          authHeader = headers.get('authorization');
        } else if (typeof headers === 'object') {
          authHeader = headers['authorization'] || headers['Authorization'];
        }

        if (authHeader && authHeader.startsWith('Bearer ')) {
          const token = authHeader.replace('Bearer ', '');
          if (token !== capturedToken) {
            capturedToken = token;
            console.log('[ContextFlow][MainWorld] ✓ Token captured!', {
              length: token.length,
              preview: token.substring(0, 20) + '...',
              url: url.split('?')[0]
            });

            // 通过 window.postMessage 发送到 isolated world
            window.postMessage({
              type: 'CHATGPT_GRAPH_TOKEN',
              token: token,
              timestamp: Date.now()
            }, '*');
          }
        }
      }
    } catch (e) {
      console.error('[ContextFlow][MainWorld] Error intercepting fetch:', e);
    }

    return originalFetch(...args);
  };

  // 使用 Object.defineProperty 使 fetch 不可被覆盖
  try {
    Object.defineProperty(window, 'fetch', {
      value: interceptedFetch,
      writable: false,
      configurable: false
    });
    console.log('[ContextFlow][MainWorld] ✓ Fetch interceptor installed (non-writable)');
  } catch (e) {
    // 如果 defineProperty 失败（已经被定义为 non-configurable），尝试直接赋值
    console.warn('[ContextFlow][MainWorld] Failed to use defineProperty, using assignment:', e.message);
    window.fetch = interceptedFetch;
    console.log('[ContextFlow][MainWorld] ✓ Fetch interceptor installed (writable)');
  }

  // 测试拦截器是否工作
  console.log('[ContextFlow][MainWorld] Interceptor test:', {
    fetchType: typeof window.fetch,
    fetchString: window.fetch.toString().substring(0, 100),
    isOriginal: window.fetch === originalFetch
  });
})();
