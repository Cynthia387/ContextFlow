/**
 * ContextFlow Extension - Content Script Bundle
 * 此文件整合了所有 Content Script 模块，避免 ES6 模块导入问题
 */

// ==================== 常量定义 ====================

const EXTENSION_NAME = 'ContextFlow';
const LOG_PREFIX = `[${EXTENSION_NAME}]`;

const API_ENDPOINTS = {
  CONVERSATION: '/backend-api/conversation',
  CONVERSATIONS: '/backend-api/conversations',
  ME: '/backend-api/me'
};

const MESSAGE_TYPES = {
  CONVERSATION_LOADED: 'CONVERSATION_LOADED',
  CONVERSATION_UPDATED: 'CONVERSATION_UPDATED',
  NEW_MESSAGE: 'NEW_MESSAGE',
  ERROR: 'ERROR',
  GET_CONVERSATION: 'GET_CONVERSATION',
  GET_ALL_CONVERSATIONS: 'GET_ALL_CONVERSATIONS',
  REFRESH_DATA: 'REFRESH_DATA',
  DATA_READY: 'DATA_READY',
  UPDATE_NOTIFICATION: 'UPDATE_NOTIFICATION'
};

const NODE_ROLES = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system'
};

const CONFIG = {
  API_DELAY: 1000,
  MAX_RETRIES: 3,
  CACHE_TTL: 5 * 60 * 1000,
  MAX_CACHE_SIZE: 10,
  OBSERVER_DELAY: 500
};

const DOM_SELECTORS = {
  ARTICLE: 'article',
  MAIN: 'main',
  USER_HEADING: 'h5',
  ASSISTANT_HEADING: 'h6',
  BRANCH_SWITCHER: '[aria-label*="回复"]'
};

// ==================== 工具函数 ====================

function log(level, module, ...args) {
  const prefix = `${LOG_PREFIX}[${module}]`;
  console[level](prefix, ...args);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retry(fn, maxRetries = 3, delayMs = 1000) {
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // 如果是404错误（资源不存在），不要重试
      if (error.message && error.message.includes('404')) {
        log('error', 'Utils', 'Resource not found (404), skipping retries');
        throw error;
      }

      // 如果是认证失败（fetchConversation 已经重试过），不要再重试
      if (error.message && error.message.includes('Authentication failed')) {
        log('error', 'Utils', 'Authentication failed, skipping retries');
        throw error;
      }

      log('warn', 'Utils', `Retry ${i + 1}/${maxRetries} failed:`, error.message);

      if (i < maxRetries - 1) {
        await delay(delayMs);
      }
    }
  }

  throw lastError;
}

function extractConversationId(url = window.location.pathname) {
  const match = url.match(/\/c\/([a-f0-9-]+)/);
  return match ? match[1] : null;
}

// ==================== API 调用 ====================

/**
 * 从 cookie 获取指定名称的值
 */
export function getCookie(name) {
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
 * 缓存的认证信息
 */
let cachedAuthInfo = null;
let capturedToken = null;

/**
 * 拦截 fetch 请求以捕获 authorization token
 */
function interceptFetch() {
  const originalFetch = window.fetch.bind(window);

  const interceptedFetch = function(...args) {
    const promise = originalFetch(...args);

    // 尝试从请求中提取 authorization header
    try {
      const [url, options] = args;
      if (options && options.headers) {
        const headers = options.headers;

        // 检查是否是 backend-api 请求且有 authorization header
        if (url && url.includes('/backend-api/')) {
          let authHeader = null;

          if (headers instanceof Headers) {
            authHeader = headers.get('authorization');
          } else if (typeof headers === 'object') {
            authHeader = headers['authorization'] || headers['Authorization'];
          }

          if (authHeader && authHeader.startsWith('Bearer ')) {
            capturedToken = authHeader.replace('Bearer ', '');
            log('info', 'API', 'Captured auth token from fetch request');
          }
        }
      }
    } catch (e) {
      // 忽略错误
    }

    return promise;
  };

  // 使用 Object.defineProperty 使其不可被覆盖
  try {
    Object.defineProperty(window, 'fetch', {
      value: interceptedFetch,
      writable: false,
      configurable: false
    });
    log('info', 'API', 'Fetch interceptor installed (non-writable)');
  } catch (e) {
    // 如果 defineProperty 失败（可能已经被定义为 non-configurable），尝试普通赋值
    log('warn', 'API', 'Failed to use defineProperty, falling back to assignment');
    window.fetch = interceptedFetch;
  }
}

/**
 * 从页面获取认证token和相关信息
 */
function getAuthInfo() {
  // 如果有缓存且未过期（缓存1分钟），直接返回
  if (cachedAuthInfo && Date.now() - cachedAuthInfo.timestamp < 60000) {
    return cachedAuthInfo.data;
  }

  try {
    const authInfo = {
      accessToken: null,
      accountId: null,
      deviceId: null
    };

    // 方法1: 使用已捕获的 token
    if (capturedToken) {
      authInfo.accessToken = capturedToken;
    }

    // 方法2: 尝试从 __NEXT_DATA__ 获取 accessToken
    if (!authInfo.accessToken) {
      const nextData = document.getElementById('__NEXT_DATA__');
      if (nextData) {
        try {
          const data = JSON.parse(nextData.textContent);
          authInfo.accessToken = data?.props?.pageProps?.accessToken;
        } catch (e) {
          log('warn', 'API', 'Failed to parse __NEXT_DATA__:', e);
        }
      }
    }

    // 方法3: 从 cookies 获取必要信息
    authInfo.accountId = getCookie('_account');
    authInfo.deviceId = getCookie('oai-did');

    // 缓存结果
    cachedAuthInfo = {
      data: authInfo,
      timestamp: Date.now()
    };

    log('info', 'API', 'Auth info retrieved:', {
      hasToken: !!authInfo.accessToken,
      hasAccountId: !!authInfo.accountId,
      hasDeviceId: !!authInfo.deviceId,
      tokenSource: authInfo.accessToken ? (capturedToken ? 'intercepted' : '__NEXT_DATA__') : 'none'
    });

    return authInfo;
  } catch (error) {
    log('error', 'API', 'Failed to get auth info:', error);
    return { accessToken: null, accountId: null, deviceId: null };
  }
}

/**
 * 清除缓存的认证信息（在401错误时调用）
 */
function clearAuthCache() {
  cachedAuthInfo = null;
  log('info', 'API', 'Auth cache cleared');
}

/**
 * 构建请求headers
 */
function buildHeaders() {
  const authInfo = getAuthInfo();

  const headers = {
    'accept': '*/*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'oai-language': 'zh-CN',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin'
  };

  // 添加 authorization token
  if (authInfo.accessToken) {
    headers['authorization'] = `Bearer ${authInfo.accessToken}`;
  } else {
    log('warn', 'API', 'No access token available, request may fail');
  }

  // 添加 account ID
  if (authInfo.accountId) {
    headers['chatgpt-account-id'] = authInfo.accountId;
  }

  // 添加 device ID
  if (authInfo.deviceId) {
    headers['oai-device-id'] = authInfo.deviceId;
  }

  return headers;
}

async function fetchConversation(conversationId, isRetry = false) {
  log('info', 'API', `Fetching conversation: ${conversationId}${isRetry ? ' (retry)' : ''}`);

  try {
    const response = await fetch(
      `${API_ENDPOINTS.CONVERSATION}/${conversationId}`,
      {
        method: 'GET',
        credentials: 'include',
        headers: buildHeaders()
      }
    );

    if (!response.ok) {
      let errorDetail = '';
      let errorData = null;

      try {
        errorData = await response.json();
        errorDetail = JSON.stringify(errorData);
      } catch (e) {
        // 如果无法解析JSON，使用原始文本
        errorDetail = await response.text();
      }

      // 如果是401（未授权），清除认证缓存
      if (response.status === 401) {
        log('warn', 'API', 'Authentication failed (401), clearing auth cache');
        clearAuthCache();

        // 如果不是重试，则自动重试一次
        if (!isRetry) {
          log('info', 'API', 'Retrying with fresh auth info...');
          await delay(500); // 等待500ms
          return await fetchConversation(conversationId, true);
        } else {
          throw new Error(`Authentication failed (401). Please ensure you are logged into ChatGPT and refresh the page.`);
        }
      }

      // 如果是404且明确说明对话不存在
      if (response.status === 404 && errorData?.detail?.code === 'conversation_not_found') {
        log('warn', 'API', `Conversation not found: ${conversationId}`);
        log('warn', 'API', 'This conversation may have been deleted or the URL is incorrect');
        throw new Error(`Conversation not found (404). Please visit a valid ChatGPT conversation page.`);
      }

      log('error', 'API', `HTTP ${response.status}:`, errorDetail);
      throw new Error(`API Error: ${response.status} - ${errorDetail}`);
    }

    const data = await response.json();

    log('info', 'API', 'Conversation loaded successfully', {
      id: data.id || conversationId,
      title: data.title,
      mappingSize: Object.keys(data.mapping || {}).length
    });

    return data;
  } catch (error) {
    log('error', 'API', 'Failed to fetch conversation:', error);
    throw error;
  }
}

async function fetchConversationWithRetry(conversationId, maxRetries = 3) {
  return retry(
    () => fetchConversation(conversationId),
    maxRetries,
    1000
  );
}

// ==================== Mapping 解析 ====================

function parseMapping(mapping, conversationId) {
  log('info', 'Parser', 'Parsing mapping...');

  const nodes = [];

  for (const nodeId in mapping) {
    const node = mapping[nodeId];

    if (!node.message || node.message.author.role === NODE_ROLES.SYSTEM) {
      continue;
    }

    const parsedNode = {
      id: nodeId,
      conversationId,
      role: node.message.author.role,
      content: node.message.content.parts?.join('') || '',
      createTime: node.message.create_time || Date.now() / 1000,
      parent: node.parent || null,
      children: node.children || [],
      metadata: {
        status: node.message.status,
        weight: node.message.weight,
        endTurn: node.message.end_turn,
        ...node.message.metadata
      }
    };

    nodes.push(parsedNode);
  }

  log('info', 'Parser', `Parsed ${nodes.length} nodes`);

  return nodes;
}

function buildNodeMap(nodes) {
  const nodeMap = new Map();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }
  return nodeMap;
}

function getPathToRoot(nodeId, nodeMap) {
  const path = [];
  let currentId = nodeId;

  while (currentId && nodeMap.has(currentId)) {
    const node = nodeMap.get(currentId);
    path.unshift(node);
    currentId = node.parent;
  }

  return path;
}

function getNodeStatistics(nodes) {
  const stats = {
    total: nodes.length,
    user: 0,
    assistant: 0,
    maxDepth: 0,
    branchPoints: 0
  };

  for (const node of nodes) {
    if (node.role === NODE_ROLES.USER) {
      stats.user++;
    } else if (node.role === NODE_ROLES.ASSISTANT) {
      stats.assistant++;
    }

    if (node.children.length > 1) {
      stats.branchPoints++;
    }
  }

  return stats;
}

// ==================== 分支提取 ====================

function findBranchPoints(nodes) {
  log('info', 'BranchExtractor', 'Finding branch points...');

  const branchPoints = [];

  for (const node of nodes) {
    if (node.children && node.children.length > 1) {
      branchPoints.push({
        nodeId: node.id,
        role: node.role,
        content: node.content.substring(0, 60) + '...',
        childrenCount: node.children.length,
        childrenIds: node.children
      });
    }
  }

  log('info', 'BranchExtractor', `Found ${branchPoints.length} branch points`);

  return branchPoints;
}

function findLeafNodes(nodes) {
  return nodes.filter(node => {
    return !node.children || node.children.length === 0;
  });
}

function extractBranches(nodes) {
  log('info', 'BranchExtractor', 'Extracting branches...');

  const nodeMap = buildNodeMap(nodes);
  const leafNodes = findLeafNodes(nodes);
  const branches = [];

  for (const leafNode of leafNodes) {
    const path = getPathToRoot(leafNode.id, nodeMap);

    branches.push({
      id: leafNode.id,
      path: path,
      messageCount: path.length,
      depth: path.length
    });
  }

  log('info', 'BranchExtractor', `Extracted ${branches.length} branches`);

  return branches;
}

function buildRounds(nodes) {
  log('info', 'BranchExtractor', 'Building rounds...');

  const rounds = [];
  const nodeMap = buildNodeMap(nodes);
  const userNodes = nodes.filter(node => node.role === 'user');

  for (const userNode of userNodes) {
    const assistantNode = userNode.children
      .map(childId => nodeMap.get(childId))
      .filter(child => child && child.role === 'assistant')[0];

    const parentRoundId = findParentRound(userNode, nodeMap, rounds);

    const round = {
      id: `round_${userNode.id}`,
      conversationId: userNode.conversationId,
      userMessageId: userNode.id,
      assistantMessageId: assistantNode ? assistantNode.id : null,
      parentRoundId: parentRoundId,
      createTime: userNode.createTime
    };

    rounds.push(round);
  }

  log('info', 'BranchExtractor', `Built ${rounds.length} rounds`);

  return rounds;
}

function findParentRound(userNode, nodeMap, rounds) {
  if (!userNode.parent) {
    return null;
  }

  const parentNode = nodeMap.get(userNode.parent);
  if (!parentNode) {
    return null;
  }

  if (parentNode.role === 'assistant') {
    const parentRound = rounds.find(r => r.assistantMessageId === parentNode.id);
    return parentRound ? parentRound.id : null;
  } else if (parentNode.role === 'user') {
    const parentRound = rounds.find(r => r.userMessageId === parentNode.id);
    return parentRound ? parentRound.id : null;
  }

  return null;
}

function analyzeBranchStructure(nodes) {
  const branchPoints = findBranchPoints(nodes);
  const branches = extractBranches(nodes);
  const leafNodes = findLeafNodes(nodes);

  return {
    totalNodes: nodes.length,
    branchPointsCount: branchPoints.length,
    branchesCount: branches.length,
    leafNodesCount: leafNodes.length,
    branchPoints,
    branches,
    leafNodes
  };
}

// ==================== DOM 辅助 ====================

function waitForElement(selector, timeout = 5000) {
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

    // 使用 documentElement 而不是 body，因为在 document_start 阶段 body 可能不存在
    const observeTarget = document.body || document.documentElement;
    observer.observe(observeTarget, {
      childList: true,
      subtree: true
    });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

function isConversationPage() {
  return /\/c\/[a-f0-9-]+/.test(window.location.pathname);
}

// ==================== 主逻辑 ====================

async function main() {
  log('info', 'Content', 'Content script loaded');

  // 立即拦截 fetch 请求以捕获 token
  interceptFetch();

  if (!isConversationPage()) {
    log('warn', 'Content', 'Not a conversation page, skipping');
    return;
  }

  const conversationId = extractConversationId();
  if (!conversationId) {
    log('error', 'Content', 'Failed to extract conversation ID from URL');
    return;
  }

  log('info', 'Content', `Conversation ID: ${conversationId}`);
  log('info', 'Content', `Please ensure this is a valid conversation that has not been deleted`);

  await waitForPageReady();

  // 等待一段时间让页面的请求完成，以便我们可以捕获 token
  log('info', 'Content', 'Waiting for page requests to capture auth token...');
  await delay(CONFIG.API_DELAY);

  await fetchAndProcessConversation(conversationId);
}

async function waitForPageReady() {
  log('info', 'Content', 'Waiting for page ready...');

  const mainElement = await waitForElement('main', 10000);
  if (!mainElement) {
    throw new Error('Page load timeout');
  }

  log('info', 'Content', 'Page ready');
}

/**
 * 获取并处理对话数据
 * @param {string} conversationId - 对话 ID
 * @returns {Promise<void>}
 */
async function fetchAndProcessConversation(conversationId) {
  try {
    log('info', 'Content', 'Fetching conversation data...');

    const data = await fetchConversationWithRetry(conversationId);

    if (!data || !data.mapping) {
      throw new Error('Invalid conversation data');
    }

    log('info', 'Content', 'Conversation data received', {
      title: data.title,
      mappingSize: Object.keys(data.mapping).length
    });

    const nodes = parseMapping(data.mapping, conversationId);
    const stats = getNodeStatistics(nodes);

    log('info', 'Content', 'Nodes parsed', stats);

    const branches = extractBranches(nodes);
    const rounds = buildRounds(nodes);
    const analysis = analyzeBranchStructure(nodes);

    log('info', 'Content', 'Branch analysis complete', {
      branches: branches.length,
      rounds: rounds.length,
      branchPoints: analysis.branchPointsCount
    });

    const conversationData = {
      id: conversationId,
      title: data.title,
      createTime: data.create_time,
      updateTime: data.update_time,
      mapping: data.mapping,
      nodes,
      rounds,
      branches,
      analysis
    };

    // 尝试发送到 background，但不阻塞成功流程
    try {
      await sendToBackground(MESSAGE_TYPES.CONVERSATION_LOADED, conversationData);
      log('info', 'Content', '✓ Conversation data sent to background');
    } catch (bgError) {
      log('warn', 'Content', 'Failed to send to background, but processing succeeded:', bgError.message);
    }

    logDebugInfo(conversationData);

  } catch (error) {
    log('error', 'Content', 'Failed to process conversation:', error);

    // 给用户提供更有帮助的错误信息
    if (error.message && error.message.includes('404')) {
      console.group('🌲 ContextFlow - Error');
      console.error('❌ Conversation Not Found');
      console.log('');
      console.log('This conversation does not exist or has been deleted.');
      console.log('');
      console.log('To test the extension:');
      console.log('1. Create a new conversation on ChatGPT');
      console.log('2. Send at least one message');
      console.log('3. Reload this page');
      console.log('');
      console.log('The extension will then fetch and analyze the conversation data.');
      console.groupEnd();
    } else if (error.message && error.message.includes('Authentication failed')) {
      console.group('🌲 ContextFlow - Error');
      console.error('❌ Authentication Failed');
      console.log('');
      console.log('Unable to authenticate with ChatGPT API.');
      console.log('');
      console.log('Possible solutions:');
      console.log('1. Make sure you are logged into ChatGPT');
      console.log('2. Refresh the page (Ctrl+R or F5)');
      console.log('3. If the issue persists, try logging out and back in');
      console.log('');
      console.log('Error details:', error.message);
      console.groupEnd();
    } else if (error.message && error.message.includes('401')) {
      console.group('🌲 ContextFlow - Error');
      console.error('❌ Token Invalid or Expired');
      console.log('');
      console.log('Your authentication token is invalid or has expired.');
      console.log('');
      console.log('Solutions:');
      console.log('1. Click the extension icon in your toolbar');
      console.log('2. Click "Update Token" or "Change Token"');
      console.log('3. Follow the instructions to get a new token');
      console.log('4. Refresh this page');
      console.groupEnd();
    }

    // 尝试发送错误到 background，但不阻塞
    try {
      await sendToBackground(MESSAGE_TYPES.ERROR, {
        message: error.message,
        stack: error.stack
      });
    } catch (bgError) {
      log('warn', 'Content', 'Failed to send error to background:', bgError.message);
    }
  }
}

async function sendToBackground(type, payload) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(
        {
          type,
          payload,
          timestamp: Date.now()
        },
        response => {
          if (chrome.runtime.lastError) {
            // 如果是连接错误，只记录警告而不是抛出错误
            if (chrome.runtime.lastError.message.includes('Receiving end does not exist')) {
              log('warn', 'Content', 'Background script not ready, message not sent:', type);
              resolve({ success: false, error: 'Background not ready' });
            } else {
              log('error', 'Content', 'Message send error:', chrome.runtime.lastError.message);
              reject(chrome.runtime.lastError);
            }
          } else if (response && response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response || { success: true });
          }
        }
      );
    } catch (error) {
      log('error', 'Content', 'Failed to send message:', error);
      reject(error);
    }
  });
}

function logDebugInfo(conversationData) {
  console.group('🌲 ContextFlow - Conversation Data');

  console.log('📊 Statistics:', {
    'Total Nodes': conversationData.nodes.length,
    'User Messages': conversationData.nodes.filter(n => n.role === 'user').length,
    'Assistant Replies': conversationData.nodes.filter(n => n.role === 'assistant').length,
    'Rounds': conversationData.rounds.length,
    'Branches': conversationData.branches.length,
    'Branch Points': conversationData.analysis.branchPointsCount
  });

  if (conversationData.analysis.branchPoints.length > 0) {
    console.log('🌿 Branch Points:');
    conversationData.analysis.branchPoints.forEach((bp, index) => {
      console.log(`  ${index + 1}. [${bp.role}] "${bp.content}" → ${bp.childrenCount} children`);
    });
  }

  if (conversationData.branches.length > 0) {
    console.log(`📝 Branches (${conversationData.branches.length} total):`);
    conversationData.branches.slice(0, 3).forEach((branch, index) => {
      console.log(`  Branch ${index + 1}: ${branch.messageCount} messages, depth ${branch.depth}`);
    });
    if (conversationData.branches.length > 3) {
      console.log(`  ... and ${conversationData.branches.length - 3} more`);
    }
  }

  console.log('💾 Full Data:', conversationData);

  console.groupEnd();
}

// 启动
main().catch(error => {
  log('error', 'Content', 'Fatal error:', error);
});
