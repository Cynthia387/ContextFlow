/**
 * IndexedDB access layer.
 *
 * Each `nodes` record is a full object on put(); ContextFlow adds optional top-level fields
 * (see schema.js): category, summary (string[]), status ('active' | 'archived'). ChatGPT API
 * message.status remains under metadata.status — do not conflate the two.
 */

import { DB_NAME, DB_VERSION, upgradeDatabase } from './schema.js';

/**
 * 数据库管理类
 */
export class Database {
  constructor() {
    this.db = null;
  }

  /**
   * 打开数据库
   * @returns {Promise<IDBDatabase>}
   */
  async open() {
    if (this.db) {
      return this.db;
    }

    return new Promise((resolve, reject) => {
      console.log(`[DB] Opening database: ${DB_NAME} v${DB_VERSION}`);
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[DB] Failed to open database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('[DB] Database opened successfully');
        console.log('[DB] Object stores:', Array.from(this.db.objectStoreNames));

        // 验证对象存储是否存在
        const requiredStores = ['conversations', 'nodes', 'edges', 'rounds', 'branches'];
        const missingStores = requiredStores.filter(store => !this.db.objectStoreNames.contains(store));

        if (missingStores.length > 0) {
          console.error('[DB] Missing object stores:', missingStores);
          console.error('[DB] Database structure is invalid. Please delete and recreate.');
          // 关闭数据库
          this.db.close();
          this.db = null;
          reject(new Error(`Missing object stores: ${missingStores.join(', ')}`));
          return;
        }

        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        console.log('[DB] onupgradeneeded triggered');
        const db = event.target.result;
        try {
          upgradeDatabase(db, event);
        } catch (error) {
          console.error('[DB] Error during upgrade:', error);
          reject(error);
        }
      };

      request.onblocked = () => {
        console.warn('[DB] Database upgrade blocked. Close all tabs using this database.');
      };
    });
  }

  /**
   * 保存对话
   * @param {Object} conversation - 对话数据
   * @returns {Promise<void>}
   */
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

  /**
   * 更新对话
   * @param {string} id - 对话 ID
   * @param {Object} updates - 更新的字段
   * @returns {Promise<void>}
   */
  async updateConversation(id, updates) {
    const db = await this.open();

    // 获取现有对话
    const existing = await this.getConversation(id);
    if (!existing) {
      throw new Error(`Conversation not found: ${id}`);
    }

    // 合并更新
    const updated = { ...existing, ...updates };

    // 保存更新后的对话
    await this.saveConversation(updated);

    // 如果包含 nodes/rounds/branches/edges 更新，也保存它们
    if (updates.nodes) {
      await this.saveNodes(updates.nodes);
    }
    if (updates.edges) {
      await this.saveEdges(updates.edges);
    }
    if (updates.rounds) {
      await this.saveRounds(updates.rounds);
    }
    if (updates.branches) {
      await this.saveBranches(updates.branches);
    }

    console.log(`[DB] ✓ Conversation updated: ${id}`);
  }

  /**
   * 获取对话
   * @param {string} id - 对话 ID
   * @returns {Promise<Object|null>}
   */
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

  /**
   * 批量保存节点
   * @param {Array} nodes - 节点数组
   * @returns {Promise<void>}
   */
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

  /**
   * 获取对话的所有节点
   * @param {string} conversationId - 对话 ID
   * @returns {Promise<Array>}
   */
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

  /**
   * 批量保存边
   * @param {Array} edges - 边数组
   * @returns {Promise<void>}
   */
  async saveEdges(edges) {
    const db = await this.open();
    const tx = db.transaction('edges', 'readwrite');
    const store = tx.objectStore('edges');

    const promises = edges.map(edge => {
      return new Promise((resolve, reject) => {
        const request = store.put(edge);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });

    await Promise.all(promises);
    console.log(`[DB] Saved ${edges.length} edges`);
  }

  /**
   * 获取对话的所有边
   * @param {string} conversationId - 对话 ID
   * @returns {Promise<Array>}
   */
  async getEdges(conversationId) {
    const db = await this.open();
    const tx = db.transaction('edges', 'readonly');
    const store = tx.objectStore('edges');
    const index = store.index('conversationId');

    return new Promise((resolve, reject) => {
      const request = index.getAll(conversationId);

      request.onsuccess = () => {
        // 按 orderKey 排序
        const edges = request.result || [];
        edges.sort((a, b) => (a.orderKey || 0) - (b.orderKey || 0));
        resolve(edges);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * 获取对话的所有轮次
   * @param {string} conversationId - 对话 ID
   * @returns {Promise<Array>}
   */
  async getRounds(conversationId) {
    const db = await this.open();
    const tx = db.transaction('rounds', 'readonly');
    const store = tx.objectStore('rounds');
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

  /**
   * 批量保存轮次
   * @param {Array} rounds - 轮次数组
   * @returns {Promise<void>}
   */
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

  /**
   * 批量保存分支
   * @param {Array} branches - 分支数组
   * @returns {Promise<void>}
   */
  async saveBranches(branches) {
    const db = await this.open();
    const tx = db.transaction('branches', 'readwrite');
    const store = tx.objectStore('branches');

    // 为每个分支添加 conversationId（从 path 中获取）
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

  /**
   * 保存完整对话数据
   * @param {Object} conversationData - 完整对话数据
   * @returns {Promise<void>}
   */
  async saveFullConversation(conversationData) {
    console.log(`[DB] Saving full conversation: ${conversationData.id}`);

    // 保存对话基本信息
    await this.saveConversation({
      id: conversationData.id,
      title: conversationData.title,
      createTime: conversationData.createTime,
      updateTime: conversationData.updateTime,
      nodeCount: conversationData.nodes?.length || 0,
      edgeCount: conversationData.edges?.length || 0,
      roundCount: conversationData.rounds?.length || 0,
      branchCount: conversationData.branches?.length || 0
    });

    // 保存节点
    if (conversationData.nodes && conversationData.nodes.length > 0) {
      await this.saveNodes(conversationData.nodes);
    }

    // 保存边
    if (conversationData.edges && conversationData.edges.length > 0) {
      await this.saveEdges(conversationData.edges);
    }

    // 保存轮次
    if (conversationData.rounds && conversationData.rounds.length > 0) {
      await this.saveRounds(conversationData.rounds);
    }

    // 保存分支
    if (conversationData.branches && conversationData.branches.length > 0) {
      await this.saveBranches(conversationData.branches);
    }

    console.log(`[DB] ✓ Full conversation saved: ${conversationData.id}`);
  }

  /**
   * 获取所有对话列表
   * @returns {Promise<Array>}
   */
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

  /**
   * 删除对话及其相关数据
   * @param {string} conversationId - 对话 ID
   * @returns {Promise<void>}
   */
  async deleteConversation(conversationId) {
    const db = await this.open();

    // 删除对话
    const tx1 = db.transaction('conversations', 'readwrite');
    await new Promise((resolve, reject) => {
      const request = tx1.objectStore('conversations').delete(conversationId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    // 删除相关节点
    const nodes = await this.getNodes(conversationId);
    if (nodes.length > 0) {
      const tx2 = db.transaction('nodes', 'readwrite');
      const store = tx2.objectStore('nodes');
      for (const node of nodes) {
        store.delete(node.id);
      }
    }

    console.log(`[DB] Conversation deleted: ${conversationId}`);
  }

  /**
   * MergeUp: push the node's summary into its parent, then mark the node archived.
   *
   * This is the ContextFlow "logical delete" — the node stays in the DB so the
   * original ChatGPT tree is intact, but Side Panel can filter out archived nodes.
   *
   * @param {string} nodeId - ID of the child node to merge upward
   * @returns {Promise<{ node: Object, parent: Object }>} the updated pair
   */
  async mergeUpNode(nodeId) {
    const node = await this.getNodeById(nodeId);
    if (!node) throw new Error(`mergeUpNode: node not found: ${nodeId}`);

    const parentId = node.parent;
    if (!parentId) throw new Error(`mergeUpNode: node "${nodeId}" has no parent`);

    const parent = await this.getNodeById(parentId);
    if (!parent) throw new Error(`mergeUpNode: parent not found: ${parentId}`);

    const childSummary = Array.isArray(node.summary) ? node.summary : [];
    const parentSummary = Array.isArray(parent.summary) ? parent.summary : [];

    const updatedParent = {
      ...parent,
      summary: [...parentSummary, ...childSummary],
    };
    const updatedNode = {
      ...node,
      status: 'archived',
    };

    await this.saveNodes([updatedNode, updatedParent]);

    console.log(`[DB] mergeUpNode: merged "${nodeId}" → "${parentId}"`);
    return { node: updatedNode, parent: updatedParent };
  }

  /**
   * Get a single node by its ID.
   * @param {string} nodeId
   * @returns {Promise<Object|null>}
   */
  async getNodeById(nodeId) {
    const db = await this.open();
    const tx = db.transaction('nodes', 'readonly');
    const store = tx.objectStore('nodes');

    return new Promise((resolve, reject) => {
      const request = store.get(nodeId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Close the database connection.
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('[DB] Database closed');
    }
  }
}

// 导出单例实例
export const db = new Database();
