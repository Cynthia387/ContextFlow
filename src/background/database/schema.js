/**
 * IndexedDB schema (ContextFlow extends persisted nodes — see CONTEXTFLOW_ARCH_GUIDE.md).
 *
 * ParsedNode documents in `nodes` may include:
 * - category: string — Classifier (e.g. Feature | Debug | Refactor | Other)
 * - summary: string[] — Summarizer / MergeUp bullet strings
 * - status: 'active' | 'archived' — branch visibility (MergeUp); not API message.status (that stays under metadata.status)
 */

export const DB_NAME = 'ChatGPTGraphDB';
export const DB_VERSION = 5; // v5: ContextFlow indexes on nodes (category, status)

/**
 * Object store definitions
 */
export const OBJECT_STORES = {
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
      { name: 'createTime', keyPath: 'createTime', unique: false },
      { name: 'category', keyPath: 'category', unique: false },
      { name: 'status', keyPath: 'status', unique: false }
    ]
  },

  edges: {
    keyPath: 'id',  // 格式: ${conversationId}:${source}->${target}
    indexes: [
      { name: 'conversationId', keyPath: 'conversationId', unique: false },
      { name: 'source', keyPath: 'source', unique: false },
      { name: 'target', keyPath: 'target', unique: false },
      { name: 'orderKey', keyPath: 'orderKey', unique: false }
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

/**
 * Add an index if the store does not already have it (upgrade path).
 * @param {IDBObjectStore} store
 * @param {{ name: string, keyPath: string, unique?: boolean }} spec
 */
function createIndexIfMissing(store, spec) {
  if (store.indexNames.contains(spec.name)) {
    return;
  }
  console.log(`[DB]   Creating index: ${spec.name} on ${store.name}`);
  store.createIndex(spec.name, spec.keyPath, { unique: spec.unique ?? false });
}

/**
 * v5: indexes for ContextFlow fields on existing `nodes` stores.
 * @param {IDBTransaction} transaction
 */
function migrateNodesV5(transaction) {
  if (!transaction.db.objectStoreNames.contains('nodes')) {
    return;
  }
  const store = transaction.objectStore('nodes');
  const nodeIndexes = OBJECT_STORES.nodes.indexes || [];
  for (const index of nodeIndexes) {
    createIndexIfMissing(store, index);
  }
}

/**
 * Create or upgrade the database.
 * @param {IDBDatabase} db
 * @param {IDBVersionChangeEvent} event
 */
export function upgradeDatabase(db, event) {
  const oldVersion = event.oldVersion;
  const newVersion = event.newVersion;
  const tx = event.target.transaction;

  console.log(`[DB] Upgrading database from v${oldVersion} to v${newVersion}`);
  console.log(`[DB] Existing object stores:`, Array.from(db.objectStoreNames));

  try {
    for (const [storeName, config] of Object.entries(OBJECT_STORES)) {
      if (!db.objectStoreNames.contains(storeName)) {
        console.log(`[DB] Creating object store: ${storeName}`);

        const store = db.createObjectStore(storeName, { keyPath: config.keyPath });

        if (config.indexes) {
          for (const index of config.indexes) {
            createIndexIfMissing(store, index);
          }
        }

        console.log(`[DB] ✓ Created object store: ${storeName}`);
      } else {
        console.log(`[DB] Object store already exists: ${storeName}`);
      }
    }

    if (oldVersion < 5) {
      migrateNodesV5(tx);
    }

    console.log(`[DB] ✓ Database upgrade completed`);
  } catch (error) {
    console.error(`[DB] Error during database upgrade:`, error);
    throw error;
  }
}
