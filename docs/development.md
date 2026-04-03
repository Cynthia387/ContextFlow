# Development guide

## Environment setup

### Prerequisites
- Node.js >= 16
- Chrome >= 120
- A ChatGPT account

### Initialize the project
```bash
cd ContextFlow
npm init -y
npm install --save-dev prettier eslint
```

---

## Debugging

### 1. Content Script
Open DevTools on the ChatGPT tab:
```
F12 → Console
```
Look for logs prefixed with `[ContextFlow]`.

### 2. Service Worker
```
chrome://extensions/ → This extension → Service Worker → Inspect views
```

### 3. Side Panel
Open the extension side panel, then right-click → Inspect.

---

## Code style

### Naming
```javascript
// Constants: SCREAMING_SNAKE_CASE
const API_BASE_URL = '/backend-api';
const MAX_CACHE_SIZE = 100;

// Functions: camelCase, verb-first
function fetchConversation() {}
function parseMapping() {}

// Classes: PascalCase
class ConversationDB {}
class CacheManager {}

// “Private” helpers: leading underscore
function _internalHelper() {}
```

### Comments
Use JSDoc:
```javascript
/**
 * Fetch conversation data.
 * @param {string} conversationId - Conversation id
 * @returns {Promise<Object>} Conversation payload
 * @throws {Error} When the API call fails
 */
async function fetchConversation(conversationId) {
  // ...
}
```

### Errors
```javascript
// Preferred: try/catch
try {
  const data = await fetchData();
  return data;
} catch (error) {
  console.error('[Module] Error:', error);
  throw new Error(`Failed to fetch: ${error.message}`);
}

// Avoid: unhandled rejections
const data = await fetchData(); // May throw without a handler
```

---

## Module development

### Content Script

#### API module
```javascript
// src/content/api/conversation.js

/**
 * Fetch full conversation data.
 */
export async function fetchConversation(conversationId) {
  const response = await fetch(
    `/backend-api/conversation/${conversationId}`,
    { credentials: 'include' }
  );

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }

  return await response.json();
}
```

#### Parser module
```javascript
// src/content/parser/mapping-parser.js

/**
 * Parse mapping into a flat node array.
 */
export function parseMapping(mapping) {
  const nodes = [];

  for (const nodeId in mapping) {
    const node = mapping[nodeId];
    if (node.message && node.message.author.role !== 'system') {
      nodes.push({
        id: nodeId,
        role: node.message.author.role,
        content: node.message.content.parts?.join('') || '',
        parent: node.parent,
        children: node.children || [],
        createTime: node.message.create_time
      });
    }
  }

  return nodes;
}
```

### Service Worker

#### Message handling
```javascript
// src/background/messaging/message-handler.js

export function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch(error => {
        console.error('[Background] Message error:', error);
        sendResponse({ error: error.message });
      });

    return true; // Keep the message channel open for async response
  });
}

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'CONVERSATION_LOADED':
      return await handleConversationLoaded(message.payload);

    case 'GET_CONVERSATION':
      return await handleGetConversation(message.payload);

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}
```

#### IndexedDB
```javascript
// src/background/database/db.js

export class ConversationDB {
  constructor() {
    this.dbName = 'ChatGPTGraphDB';
    this.version = 1;
  }

  async open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create object stores
        if (!db.objectStoreNames.contains('conversations')) {
          const store = db.createObjectStore('conversations', { keyPath: 'id' });
          store.createIndex('updateTime', 'updateTime');
        }
      };
    });
  }

  async save(conversation) {
    const db = await this.open();
    const tx = db.transaction('conversations', 'readwrite');
    const store = tx.objectStore('conversations');

    return new Promise((resolve, reject) => {
      const request = store.put(conversation);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}
```

---

## Messaging examples

### From Content Script
```javascript
// src/content/index.js

async function sendToBackground(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type, payload },
      response => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      }
    );
  });
}

// Example
try {
  const result = await sendToBackground('CONVERSATION_LOADED', {
    conversationId: 'xxx',
    mapping: { ... }
  });
  console.log('Success:', result);
} catch (error) {
  console.error('Failed:', error);
}
```

### From Service Worker to Side Panel
```javascript
// src/background/messaging/message-handler.js

async function notifySidePanel(type, payload) {
  const tabs = await chrome.tabs.query({ active: true });

  for (const tab of tabs) {
    try {
      await chrome.runtime.sendMessage({ type, payload });
    } catch (error) {
      console.warn('Side panel not open');
    }
  }
}

// Example
await notifySidePanel('CONVERSATION_UPDATED', {
  conversationId: 'xxx',
  updateType: 'new_message'
});
```

---

## Troubleshooting

### 1. fetch returns 404
**Symptom**: API calls from the Content Script return 404.

**Causes**: Auth/session issues or wrong URL.

**Fix**:
```javascript
// Use a relative path on the ChatGPT origin
const response = await fetch(
  `/backend-api/conversation/${id}`,  // ✅ OK
  { credentials: 'include' }           // ✅ Send cookies
);

// Avoid hard-coded absolute URLs when possible
const response = await fetch(
  `https://chatgpt.com/backend-api/...`, // ❌ Often wrong in-extension
  ...
);
```

### 2. IndexedDB writes fail
**Symptom**: Data does not persist.

**Causes**: Transaction lifetime or permission issues.

**Fix**:
```javascript
// ✅ Return a Promise that completes before the transaction ends
async function save(data) {
  const db = await this.open();
  const tx = db.transaction('conversations', 'readwrite');
  const store = tx.objectStore('conversations');

  return new Promise((resolve, reject) => {
    const request = store.put(data);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ❌ Fire-and-forget inside a short-lived transaction
async function save(data) {
  const db = await this.open();
  const tx = db.transaction('conversations', 'readwrite');
  const store = tx.objectStore('conversations');
  store.put(data); // Not awaited — transaction may close first
}
```

### 3. No response from sendMessage
**Symptom**: `chrome.runtime.sendMessage` never resolves.

**Causes**: Listener did not return `true` for async handling.

**Fix**:
```javascript
// ✅ return true to keep the channel open
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse);
  return true; // Important for async sendResponse
});

// ❌ Channel closes before async work finishes
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse);
  // missing return true
});
```

---

## Testing

### Unit test sketch
```javascript
// test/parser.test.js

import { parseMapping } from '../src/content/parser/mapping-parser.js';

describe('parseMapping', () => {
  it('should parse mapping correctly', () => {
    const mapping = {
      'node1': {
        message: {
          author: { role: 'user' },
          content: { parts: ['Hello'] },
          create_time: 123456
        },
        parent: null,
        children: ['node2']
      }
    };

    const nodes = parseMapping(mapping);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].role).toBe('user');
    expect(nodes[0].content).toBe('Hello');
  });
});
```

### Integration test sketch
```javascript
// test/integration.test.js

describe('Content Script → Service Worker', () => {
  it('should save conversation to database', async () => {
    // 1. Mock API response
    const mockData = { ... };

    // 2. Inject / run Content Script
    await injectContentScript();

    // 3. Wait until persisted
    await waitFor(() => db.has(conversationId));

    // 4. Assert
    const saved = await db.get(conversationId);
    expect(saved.title).toBe('Test Conversation');
  });
});
```

---

## Release

### 1. Versioning
Use semantic versioning: `MAJOR.MINOR.PATCH`

```bash
# Bug fixes
npm version patch  # 0.1.0 → 0.1.1

# New features
npm version minor  # 0.1.1 → 0.2.0

# Breaking changes
npm version major  # 0.2.0 → 1.0.0
```

### 2. Build and zip
```bash
npm run clean
npm run build

cd dist
zip -r chatgpt-graph-v0.1.0.zip *
```

### 3. Chrome Web Store
1. Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Upload the zip
3. Fill in store listing fields
4. Submit for review

---

## Performance instrumentation

### Marks and measures
```javascript
// src/content/index.js

performance.mark('content-script-start');

await fetchConversation(id);

performance.mark('content-script-end');
performance.measure(
  'content-script-duration',
  'content-script-start',
  'content-script-end'
);

const measure = performance.getEntriesByName('content-script-duration')[0];
console.log(`[Perf] Content script took ${measure.duration}ms`);
```

### API latency
```javascript
const start = Date.now();
const response = await fetch(...);
const duration = Date.now() - start;

if (duration > 2000) {
  console.warn(`[Perf] Slow API call: ${duration}ms`);
}
```

---

## Resources

### Chrome Extension APIs
- [Manifest V3](https://developer.chrome.com/docs/extensions/mv3/)
- [Runtime API](https://developer.chrome.com/docs/extensions/reference/runtime/)
- [Storage API](https://developer.chrome.com/docs/extensions/reference/storage/)

### IndexedDB
- [MDN: Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)
- [Dexie.js](https://dexie.org/) — IndexedDB wrapper

### Graph libraries
- [Cytoscape.js](https://js.cytoscape.org/)
- [Sigma.js](https://www.sigmajs.org/)
