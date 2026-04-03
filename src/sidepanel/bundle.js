/**
 * ContextFlow Extension - Side Panel Bundle
 * 此文件整合了所有 Side Panel 模块
 */

// ==================== 常量定义 ====================

const MESSAGE_TYPES = {
  CONVERSATION_LOADED: 'CONVERSATION_LOADED',
  GET_CONVERSATION: 'GET_CONVERSATION',
  GET_ALL_CONVERSATIONS: 'GET_ALL_CONVERSATIONS',
  DATA_READY: 'DATA_READY',
  UPDATE_NOTIFICATION: 'UPDATE_NOTIFICATION'
};

// ==================== DOM 元素 ====================

const elements = {
  dbStatus: document.getElementById('db-status'),
  currentConv: document.getElementById('current-conv'),
  refreshBtn: document.getElementById('refresh-btn'),
  clearLogsBtn: document.getElementById('clear-logs-btn'),
  conversationsList: document.getElementById('conversations-list'),
  dataDetails: document.getElementById('data-details'),
  logs: document.getElementById('logs')
};

let selectedConversation = null;

// ==================== 初始化 ====================

async function initialize() {
  addLog('System', 'Initializing debug panel...');

  elements.refreshBtn.addEventListener('click', loadConversations);
  elements.clearLogsBtn.addEventListener('click', clearLogs);

  setupMessageListener();

  await checkDatabaseStatus();

  await loadConversations();

  addLog('System', 'Debug panel initialized', 'success');
}

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

async function checkDatabaseStatus() {
  try {
    const response = await sendToBackground(MESSAGE_TYPES.GET_ALL_CONVERSATIONS, {});

    if (response.success) {
      elements.dbStatus.textContent = 'Connected';
      elements.dbStatus.style.color = '#4caf50';
      addLog('Database', 'Status: Connected', 'success');
    }
  } catch (error) {
    elements.dbStatus.textContent = 'Error';
    elements.dbStatus.style.color = '#f44336';
    addLog('Database', `Error: ${error.message}`, 'error');
  }
}

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
    elements.conversationsList.innerHTML = '<p class="placeholder">Failed to load conversations</p>';
  }
}

function renderConversations(conversations) {
  if (conversations.length === 0) {
    elements.conversationsList.innerHTML = '<p class="placeholder">No conversations yet</p>';
    return;
  }

  const html = conversations.map(conv => `
    <div class="list-item" data-id="${conv.id}">
      <div class="list-item-title">${conv.title || 'Untitled'}</div>
      <div class="list-item-info">
        Nodes: ${conv.nodeCount || 0} |
        Rounds: ${conv.roundCount || 0} |
        Branches: ${conv.branchCount || 0}
      </div>
    </div>
  `).join('');

  elements.conversationsList.innerHTML = html;

  elements.conversationsList.querySelectorAll('.list-item').forEach(item => {
    item.addEventListener('click', () => {
      const convId = item.getAttribute('data-id');
      loadConversationDetails(convId);
    });
  });
}

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
    elements.dataDetails.innerHTML = '<p class="placeholder">Failed to load details</p>';
  }
}

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

function handleDataReady(payload) {
  addLog('Data', `Conversation ready: ${payload.conversationId}`, 'success');
  addLog('Stats', JSON.stringify(payload.stats, null, 2), 'info');

  loadConversations();
}

function handleUpdateNotification(payload) {
  addLog('Update', `Type: ${payload.updateType}`, 'info');
}

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

function addLog(category, message, level = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = document.createElement('p');
  logEntry.className = `log-entry ${level}`;
  logEntry.textContent = `[${timestamp}] [${category}] ${message}`;

  elements.logs.appendChild(logEntry);

  elements.logs.scrollTop = elements.logs.scrollHeight;

  const maxLogs = 100;
  while (elements.logs.children.length > maxLogs) {
    elements.logs.removeChild(elements.logs.firstChild);
  }
}

function clearLogs() {
  elements.logs.innerHTML = '<p class="log-entry">[System] Logs cleared</p>';
}

// 启动
initialize().catch(error => {
  console.error('Failed to initialize:', error);
  addLog('Error', `Initialization failed: ${error.message}`, 'error');
});
