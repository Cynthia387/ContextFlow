/**
 * Side Panel 调试界面
 */

import { MESSAGE_TYPES } from '../shared/constants.js';
import { initI18n, i18n, SUPPORTED_LOCALES, getUserLocale, setUserLocale } from '../shared/i18n.js';

// DOM 元素
const elements = {
  dbStatus: document.getElementById('db-status'),
  currentConv: document.getElementById('current-conv'),
  refreshBtn: document.getElementById('refresh-btn'),
  clearLogsBtn: document.getElementById('clear-logs-btn'),
  conversationsList: document.getElementById('conversations-list'),
  dataDetails: document.getElementById('data-details'),
  logs: document.getElementById('logs')
};

// 当前选中的对话
let selectedConversation = null;

/**
 * 创建语言切换器
 */
function createLanguageSwitcher() {
  const container = document.getElementById('language-switcher-container');
  if (!container) return;

  // 如果已经存在，先清空
  container.innerHTML = '';

  const switcher = document.createElement('div');
  switcher.className = 'language-switcher';

  const label = document.createElement('label');
  label.textContent = i18n('languageLabel');
  label.htmlFor = 'language-select-sidepanel';

  const select = document.createElement('select');
  select.id = 'language-select-sidepanel';
  select.className = 'language-select';

  // 添加语言选项
  Object.entries(SUPPORTED_LOCALES).forEach(([code, name]) => {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = name;
    select.appendChild(option);
  });

  // 设置当前语言
  getUserLocale().then(locale => {
    select.value = locale;
  });

  // 监听变化
  select.addEventListener('change', async (e) => {
    const newLocale = e.target.value;
    await setUserLocale(newLocale);
    await initI18n(newLocale);

    // 更新语言切换器的标签文本
    label.textContent = i18n('languageLabel');

    // 重新渲染当前数据
    if (selectedConversation) {
      renderConversationDetails(selectedConversation);
    }
  });

  switcher.appendChild(label);
  switcher.appendChild(select);
  container.appendChild(switcher);
}

/**
 * 初始化
 */
async function initialize() {
  // 初始化国际化
  await initI18n();

  // 创建语言切换器
  createLanguageSwitcher();

  addLog('System', i18n('systemLogLoaded'));

  // 设置事件监听器
  elements.refreshBtn.addEventListener('click', loadConversations);
  elements.clearLogsBtn.addEventListener('click', clearLogs);

  // 监听来自 Background 的消息
  setupMessageListener();

  // 检查数据库状态
  await checkDatabaseStatus();

  // 加载对话列表
  await loadConversations();

  addLog('System', 'Debug panel initialized', 'success');
}

/**
 * 设置消息监听器
 */
function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    addLog('Message', `Received: ${message.type}`, 'info');

    if (message.type === MESSAGE_TYPES.DATA_READY) {
      handleDataReady(message.payload);
    } else if (message.type === MESSAGE_TYPES.UPDATE_NOTIFICATION) {
      handleUpdateNotification(message.payload);
    }
  });
}

/**
 * 检查数据库状态
 */
async function checkDatabaseStatus() {
  try {
    const response = await sendToBackground(MESSAGE_TYPES.GET_ALL_CONVERSATIONS, {});

    if (response.success) {
      elements.dbStatus.textContent = i18n('statusConnected');
      elements.dbStatus.style.color = '#4caf50';
      addLog('Database', 'Status: Connected', 'success');
    }
  } catch (error) {
    elements.dbStatus.textContent = i18n('statusError');
    elements.dbStatus.style.color = '#f44336';
    addLog('Database', `Error: ${error.message}`, 'error');
  }
}

/**
 * 加载对话列表
 */
async function loadConversations() {
  addLog('System', 'Loading conversations...');

  try {
    const response = await sendToBackground(MESSAGE_TYPES.GET_ALL_CONVERSATIONS, {});

    if (response.success && response.data) {
      const conversations = response.data;
      renderConversations(conversations);
      addLog('System', `Loaded ${conversations.length} conversations`, 'success');
    }
  } catch (error) {
    addLog('Error', error.message, 'error');
    elements.conversationsList.innerHTML = `<p class="placeholder">${i18n('failedToLoad')}</p>`;
  }
}

/**
 * 渲染对话列表
 * @param {Array} conversations - 对话数组
 */
function renderConversations(conversations) {
  if (conversations.length === 0) {
    elements.conversationsList.innerHTML = `<p class="placeholder">${i18n('noConversationsYet')}</p>`;
    return;
  }

  const html = conversations.map(conv => `
    <div class="list-item" data-id="${conv.id}">
      <div class="list-item-title">${conv.title || i18n('untitled')}</div>
      <div class="list-item-info">
        Nodes: ${conv.nodeCount || 0} |
        Rounds: ${conv.roundCount || 0} |
        Branches: ${conv.branchCount || 0}
      </div>
    </div>
  `).join('');

  elements.conversationsList.innerHTML = html;

  // 添加点击事件
  elements.conversationsList.querySelectorAll('.list-item').forEach(item => {
    item.addEventListener('click', () => {
      const convId = item.getAttribute('data-id');
      loadConversationDetails(convId);
    });
  });
}

/**
 * 加载对话详情
 * @param {string} conversationId - 对话 ID
 */
async function loadConversationDetails(conversationId) {
  addLog('System', `Loading details for: ${conversationId}`);

  try {
    const response = await sendToBackground(MESSAGE_TYPES.GET_CONVERSATION, { conversationId });

    if (response.success && response.data) {
      selectedConversation = response.data;
      renderConversationDetails(response.data);
      elements.currentConv.textContent = response.data.conversation.title || conversationId;
      addLog('System', 'Details loaded', 'success');
    }
  } catch (error) {
    addLog('Error', error.message, 'error');
    elements.dataDetails.innerHTML = `<p class="placeholder">${i18n('failedToLoadDetails')}</p>`;
  }
}

/**
 * 渲染对话详情
 * @param {Object} data - 对话数据
 */
function renderConversationDetails(data) {
  const { conversation, nodes } = data;

  const details = {
    'Conversation ID': conversation.id,
    'Title': conversation.title,
    'Node Count': conversation.nodeCount,
    'Round Count': conversation.roundCount,
    'Branch Count': conversation.branchCount,
    'Create Time': new Date(conversation.createTime * 1000).toLocaleString(),
    'Update Time': new Date(conversation.updateTime * 1000).toLocaleString(),
    'Nodes Loaded': nodes.length
  };

  const html = Object.entries(details)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

  elements.dataDetails.textContent = html;
}

/**
 * 处理数据就绪消息
 * @param {Object} payload - 消息负载
 */
function handleDataReady(payload) {
  addLog('Data', `Conversation ready: ${payload.conversationId}`, 'success');
  addLog('Stats', JSON.stringify(payload.stats, null, 2), 'info');

  // 自动刷新列表
  loadConversations();
}

/**
 * 处理更新通知
 * @param {Object} payload - 消息负载
 */
function handleUpdateNotification(payload) {
  addLog('Update', `Type: ${payload.updateType}`, 'info');
}

/**
 * 发送消息到 Background
 * @param {string} type - 消息类型
 * @param {Object} payload - 消息负载
 * @returns {Promise<Object>}
 */
function sendToBackground(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type, payload, timestamp: Date.now() },
      response => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      }
    );
  });
}

/**
 * 添加日志
 * @param {string} category - 分类
 * @param {string} message - 消息
 * @param {string} level - 级别
 */
function addLog(category, message, level = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = document.createElement('p');
  logEntry.className = `log-entry ${level}`;
  logEntry.textContent = `[${timestamp}] [${category}] ${message}`;

  elements.logs.appendChild(logEntry);

  // 自动滚动到底部
  elements.logs.scrollTop = elements.logs.scrollHeight;

  // 限制日志数量
  const maxLogs = 100;
  while (elements.logs.children.length > maxLogs) {
    elements.logs.removeChild(elements.logs.firstChild);
  }
}

/**
 * 清空日志
 */
function clearLogs() {
  elements.logs.innerHTML = `<p class="log-entry">${i18n('systemLogCleared')}</p>`;
}

// 启动
initialize().catch(error => {
  console.error('Failed to initialize:', error);
  addLog('Error', `Initialization failed: ${error.message}`, 'error');
});
