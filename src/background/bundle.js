/**
 * ContextFlow Extension - Service Worker Bundle
 * 此文件整合了所有 Service Worker 模块
 */

// ==================== 常量定义 ====================

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

const CONFIG = {
  API_DELAY: 1000,
  MAX_RETRIES: 3,
  CACHE_TTL: 5 * 60 * 1000,
  MAX_CACHE_SIZE: 10,
  OBSERVER_DELAY: 500
};

const STORAGE_KEYS = {
  CURRENT_CONVERSATION: 'current_conversation',
  CACHE_PREFIX: 'cache_',
  SETTINGS: 'settings'
};

// ==================== IndexedDB Schema ====================

const DB_NAME = 'ChatGPTGraphDB';
const DB_VERSION = 1;

const OBJECT_STORES = {
  conversations: {
    keyPath: 'id',
    indexes: [
      { name: 'updateTime', keyPath: 'updateTime', unique: false },
      { name: 'createTime', keyPath: 'createTime', unique: false }
    ]
  },
  nodes: {
    keyPath: 'id',
    indexes: [
      { name: 'conversationId', keyPath: 'conversationId', unique: false },
      { name: 'role', keyPath: 'role', unique: false },
      { name: 'createTime', keyPath: 'createTime', unique: false }
    ]
  },
  rounds: {
    keyPath: 'id',
    indexes: [
      { name: 'conversationId', keyPath: 'conversationId', unique: false },
      { name: 'createTime', keyPath: 'createTime', unique: false }
    ]
  },
  branches: {
    keyPath: 'id',
    indexes: [
      { name: 'conversationId', keyPath: 'conversationId', unique: false }
    ]
  }
};

function upgradeDatabase(db, event) {
  const oldVersion = event.oldVersion;
  const newVersion = event.newVersion;

  console.log(`[DB] Upgrading database from v${oldVersion} to v${newVersion}`);

  for (const [storeName, config] of Object.entries(OBJECT_STORES)) {
    if (!db.objectStoreNames.contains(storeName)) {
      const store = db.createObjectStore(storeName, { keyPath: config.keyPath });

      if (config.indexes) {
        for (const index of config.indexes) {
          store.createIndex(index.name, index.keyPath, { unique: index.unique });
        }
      }

      console.log(`[DB] Created object store: ${storeName}`);
    }
  }
}

// ==================== Database 类 ====================

class Database {
  constructor() {
    this.db = null;
  }

  async open() {
    if (this.db) {
      return this.db;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[DB] Failed to open database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('[DB] Database opened successfully');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        upgradeDatabase(db, event);
      };
    });
  }

  async saveConversation(conversation) {
    const db = await this.open();
    const tx = db.transaction('conversations', 'readwrite');
    const store = tx.objectStore('conversations');

    return new Promise((resolve, reject) => {
      const request = store.put(conversation);

      request.onsuccess = () => {
        console.log(`[DB] Conversation saved: ${conversation.id}`);
        resolve();
      };

      request.onerror = () => {
        console.error('[DB] Failed to save conversation:', request.error);
        reject(request.error);
      };
    });
  }

  async getConversation(id) {
    const db = await this.open();
    const tx = db.transaction('conversations', 'readonly');
    const store = tx.objectStore('conversations');

    return new Promise((resolve, reject) => {
      const request = store.get(id);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  async saveNodes(nodes) {
    const db = await this.open();
    const tx = db.transaction('nodes', 'readwrite');
    const store = tx.objectStore('nodes');

    const promises = nodes.map(node => {
      return new Promise((resolve, reject) => {
        const request = store.put(node);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });

    await Promise.all(promises);
    console.log(`[DB] Saved ${nodes.length} nodes`);
  }

  async getNodes(conversationId) {
    const db = await this.open();
    const tx = db.transaction('nodes', 'readonly');
    const store = tx.objectStore('nodes');
    const index = store.index('conversationId');

    return new Promise((resolve, reject) => {
      const request = index.getAll(conversationId);

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  async saveRounds(rounds) {
    const db = await this.open();
    const tx = db.transaction('rounds', 'readwrite');
    const store = tx.objectStore('rounds');

    const promises = rounds.map(round => {
      return new Promise((resolve, reject) => {
        const request = store.put(round);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });

    await Promise.all(promises);
    console.log(`[DB] Saved ${rounds.length} rounds`);
  }

  async saveBranches(branches) {
    const db = await this.open();
    const tx = db.transaction('branches', 'readwrite');
    const store = tx.objectStore('branches');

    const branchesWithConvId = branches.map(branch => ({
      ...branch,
      conversationId: branch.path[0]?.conversationId || 'unknown'
    }));

    const promises = branchesWithConvId.map(branch => {
      return new Promise((resolve, reject) => {
        const request = store.put(branch);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });

    await Promise.all(promises);
    console.log(`[DB] Saved ${branches.length} branches`);
  }

  async saveFullConversation(conversationData) {
    console.log(`[DB] Saving full conversation: ${conversationData.id}`);

    await this.saveConversation({
      id: conversationData.id,
      title: conversationData.title,
      createTime: conversationData.createTime,
      updateTime: conversationData.updateTime,
      nodeCount: conversationData.nodes.length,
      roundCount: conversationData.rounds.length,
      branchCount: conversationData.branches.length
    });

    if (conversationData.nodes && conversationData.nodes.length > 0) {
      await this.saveNodes(conversationData.nodes);
    }

    if (conversationData.rounds && conversationData.rounds.length > 0) {
      await this.saveRounds(conversationData.rounds);
    }

    if (conversationData.branches && conversationData.branches.length > 0) {
      await this.saveBranches(conversationData.branches);
    }

    console.log(`[DB] ✓ Full conversation saved: ${conversationData.id}`);
  }

  async getAllConversations() {
    const db = await this.open();
    const tx = db.transaction('conversations', 'readonly');
    const store = tx.objectStore('conversations');

    return new Promise((resolve, reject) => {
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('[DB] Database closed');
    }
  }
}

const db = new Database();

// ==================== CacheManager 类 ====================

class CacheManager {
  constructor() {
    this.cache = new Map();
    this.maxSize = CONFIG.MAX_CACHE_SIZE;
    this.ttl = CONFIG.CACHE_TTL;
  }

  set(key, value, ttl = this.ttl) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl
    });

    console.log(`[Cache] Set: ${key}`);
  }

  get(key) {
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    const age = Date.now() - cached.timestamp;
    if (age > cached.ttl) {
      this.cache.delete(key);
      console.log(`[Cache] Expired: ${key}`);
      return null;
    }

    console.log(`[Cache] Hit: ${key}`);
    return cached.value;
  }

  delete(key) {
    this.cache.delete(key);
    console.log(`[Cache] Deleted: ${key}`);
  }

  clear() {
    this.cache.clear();
    console.log('[Cache] Cleared all');
  }

  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      keys: Array.from(this.cache.keys())
    };
  }
}

const cache = new CacheManager();

// ==================== 消息处理 ====================

function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Background] Received message:', message.type);

    handleMessage(message, sender)
      .then(result => {
        sendResponse({ success: true, data: result });
      })
      .catch(error => {
        console.error('[Background] Message handler error:', error);
        sendResponse({ success: false, error: error.message });
      });

    return true;
  });

  console.log('[Background] Message listener setup complete');
}

async function handleMessage(message, sender) {
  const { type, payload } = message;

  switch (type) {
    case MESSAGE_TYPES.CONVERSATION_LOADED:
      return await handleConversationLoaded(payload);

    case MESSAGE_TYPES.GET_CONVERSATION:
      return await handleGetConversation(payload);

    case MESSAGE_TYPES.GET_ALL_CONVERSATIONS:
      return await handleGetAllConversations();

    case MESSAGE_TYPES.ERROR:
      return await handleError(payload, sender);

    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}

async function handleConversationLoaded(conversationData) {
  console.log('[Background] Handling CONVERSATION_LOADED:', conversationData.id);

  try {
    await db.saveFullConversation(conversationData);

    await notifySidePanel(MESSAGE_TYPES.DATA_READY, {
      conversationId: conversationData.id,
      stats: {
        nodes: conversationData.nodes.length,
        rounds: conversationData.rounds.length,
        branches: conversationData.branches.length
      }
    });

    return {
      message: 'Conversation saved successfully',
      conversationId: conversationData.id
    };
  } catch (error) {
    console.error('[Background] Failed to save conversation:', error);
    throw error;
  }
}

async function handleGetConversation(payload) {
  const { conversationId } = payload;

  console.log('[Background] Getting conversation:', conversationId);

  const conversation = await db.getConversation(conversationId);

  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const nodes = await db.getNodes(conversationId);

  return {
    conversation,
    nodes
  };
}

async function handleGetAllConversations() {
  console.log('[Background] Getting all conversations');

  const conversations = await db.getAllConversations();

  return conversations;
}

async function handleError(errorData, sender) {
  console.error('[Background] Error from content script:', errorData);

  return { acknowledged: true };
}

async function notifySidePanel(type, payload) {
  try {
    await chrome.runtime.sendMessage({
      type,
      payload,
      timestamp: Date.now()
    });
  } catch (error) {
    console.warn('[Background] Failed to notify side panel:', error.message);
  }
}

// ==================== 初始化 ====================

async function initialize() {
  console.log('[Background] Service Worker initializing...');

  try {
    await db.open();
    console.log('[Background] ✓ Database opened');

    setupMessageListener();
    console.log('[Background] ✓ Message listener registered');

    console.log('[Background] ✓ Service Worker initialized successfully');
    console.log('[Background] Cache stats:', cache.getStats());

  } catch (error) {
    console.error('[Background] Initialization failed:', error);
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Background] Extension installed:', details.reason);

  if (details.reason === 'install') {
    console.log('[Background] First time installation - opening setup page');

    // 首次安装时打开设置页面
    await chrome.tabs.create({
      url: chrome.runtime.getURL('src/setup/index.html')
    });

  } else if (details.reason === 'update') {
    console.log('[Background] Extension updated');

    // 检查是否有已保存的 token
    const result = await chrome.storage.local.get(['accessToken']);
    if (!result.accessToken) {
      console.log('[Background] No token found after update - opening setup page');
      await chrome.tabs.create({
        url: chrome.runtime.getURL('src/setup/index.html')
      });
    }
  }
});

self.addEventListener('activate', (event) => {
  console.log('[Background] Service Worker activated');
  event.waitUntil(initialize());
});

initialize();
