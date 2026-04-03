# Architecture

## Overview

This project uses a **modular layered architecture** and follows the Chrome Extension Manifest V3 model.

```
┌─────────────────────────────────────────────────┐
│           ChatGPT Web Page (DOM)                │
└─────────────────┬───────────────────────────────┘
                  │
        ┌─────────▼─────────┐
        │  Content Script   │ ← Page data capture
        │  - API Caller     │
        │  - DOM Observer   │
        │  - Data Parser    │
        └─────────┬─────────┘
                  │ Runtime Messages
        ┌─────────▼──────────┐
        │  Service Worker    │ ← Data hub
        │  - Message Router  │
        │  - IndexedDB       │
        │  - Cache Manager   │
        └─────────┬──────────┘
                  │ Runtime Messages
        ┌─────────▼─────────┐
        │   Side Panel      │ ← User interface
        │  - Graph Render   │
        │  - Search UI      │
        │  - Node Details   │
        └───────────────────┘
```

## Core design principles

### 1. Single responsibility (SRP)
Each module has one clear role:
- **Content Script**: data capture only
- **Service Worker**: data management only
- **Side Panel**: presentation only

### 2. Dependency inversion (DIP)
- Higher-level modules do not depend on low-level details; both depend on abstractions
- Modules are decoupled via message passing

### 3. Open/closed (OCP)
- Open for extension, closed for unnecessary modification
- Use interfaces and abstractions for extensibility

## Module design

### Content Script

#### Responsibilities
1. Call the ChatGPT API for conversation mapping
2. Parse the mapping tree
3. Observe DOM changes on the page
4. Send data to the Service Worker

#### Submodules

**API** (`src/content/api/`)
```javascript
// conversation.js
export async function fetchConversation(conversationId) {
  // Call /backend-api/conversation/{id}
}
```

**Parser** (`src/content/parser/`)
```javascript
// mapping-parser.js
export function parseMapping(mapping) {
  // Normalize mapping into a standard structure
}

// branch-extractor.js
export function extractBranches(mapping) {
  // Extract all branches
}
```

**Observer** (`src/content/observer/`)
```javascript
// mutation-observer.js
export function observeNewMessages(callback) {
  // Watch for new messages
}
```

#### Data flow
```
ChatGPT API → fetch → parse → send to background
     ↓
   mapping
     ↓
  branches
     ↓
Service Worker
```

---

### Service Worker

#### Responsibilities
1. Receive and persist data from the Content Script
2. Manage the IndexedDB database
3. Implement caching
4. Relay messages between Content Script ↔ Side Panel

#### Submodules

**Database** (`src/background/database/`)
```javascript
// db.js
export class ConversationDB {
  async saveConversation(data) {}
  async getConversation(id) {}
  async updateConversation(id, updates) {}
}

// schema.js
export const DB_SCHEMA = {
  conversations: { keyPath: 'id', indexes: [...] },
  nodes: { keyPath: 'id', indexes: [...] },
  rounds: { keyPath: 'id', indexes: [...] }
};
```

**Cache** (`src/background/cache/`)
```javascript
// cache-manager.js
export class CacheManager {
  async get(key) {}
  async set(key, value, ttl) {}
  async invalidate(key) {}
}
```

**Messaging** (`src/background/messaging/`)
```javascript
// message-handler.js
export function handleMessage(message, sender, sendResponse) {
  // Route messages by type
}
```

#### Database schema

**Conversations**
```javascript
{
  id: string (primary key),
  title: string,
  createTime: number,
  updateTime: number,
  currentNode: string,
  metadata: object
}
```

**Nodes**
```javascript
{
  id: string (primary key),
  conversationId: string (indexed),
  role: 'user' | 'assistant' | 'system',
  content: string,
  createTime: number,
  parent: string,
  children: string[],
  metadata: object
}
```

**Rounds**
```javascript
{
  id: string (primary key),
  conversationId: string (indexed),
  userMessageId: string,
  assistantMessageId: string,
  parentRoundId: string,
  createTime: number
}
```

---

### Side Panel

#### Responsibilities (V0.1 — minimal)
1. Show the current conversation mapping tree
2. Show logs and debug output
3. Manually trigger refresh

#### Responsibilities (full version — later)
1. Render the graph (Cytoscape.js / Sigma.js)
2. Search and filter nodes
3. Node detail panel
4. Branch switching

#### Component layout
```
Side Panel
├── Graph View        # Graph view
├── Search Bar        # Search bar
├── Node Details      # Node detail panel
└── Debug Console     # Debug console (V0.1)
```

---

## Messaging protocol

### Message shapes

```javascript
// Content Script → Service Worker
{
  type: 'CONVERSATION_LOADED',
  payload: {
    conversationId: string,
    mapping: object,
    branches: array
  }
}

// Service Worker → Side Panel
{
  type: 'CONVERSATION_UPDATED',
  payload: {
    conversationId: string,
    updateType: 'new_message' | 'branch_created',
    data: object
  }
}

// Side Panel → Service Worker
{
  type: 'GET_CONVERSATION',
  payload: {
    conversationId: string
  }
}
```

### Message flow

```
┌──────────────┐     CONVERSATION_LOADED      ┌──────────────┐
│   Content    │ ──────────────────────────→  │   Service    │
│   Script     │                               │   Worker     │
│              │ ←──────────────────────────   │              │
└──────────────┘     ACK / ERROR              └──────────────┘
                                                      ↕
                                               CONVERSATION_UPDATED
                                                      ↕
                                              ┌──────────────┐
                                              │  Side Panel  │
                                              └──────────────┘
```

---

## Data flow

### End-to-end flow

```
1. User opens a ChatGPT conversation page
   ↓
2. Content Script is injected and runs
   ↓
3. Extract conversationId
   ↓
4. Call API: GET /backend-api/conversation/{id}
   ↓
5. Parse mapping tree
   ↓
6. Extract branch structure
   ↓
7. Send to Service Worker: CONVERSATION_LOADED
   ↓
8. Service Worker persists to IndexedDB
   ↓
9. Notify Side Panel: CONVERSATION_UPDATED
   ↓
10. Side Panel renders the graph
```

### Incremental updates

```
1. MutationObserver detects a new message
   ↓
2. Extract new message data
   ↓
3. Send to Service Worker: NEW_MESSAGE
   ↓
4. Service Worker updates IndexedDB
   ↓
5. Notify Side Panel: CONVERSATION_UPDATED
   ↓
6. Side Panel incrementally updates the graph
```

---

## Performance

### 1. Deferred loading
- Content Script starts after a short delay to avoid blocking first paint
- Side Panel loads graph libraries on demand

### 2. Incremental updates
- Update when new messages appear instead of always re-parsing everything
- Prefer MutationObserver over polling

### 3. Caching
- In-memory: last few conversations (e.g. 3)
- IndexedDB: durable storage for all conversations
- LRU eviction where applicable

### 4. Data size
- Store only necessary fields
- Truncate very long text for storage

---

## Error handling

### Layered handling

**Content Script**
```javascript
try {
  const data = await fetchConversation(id);
} catch (error) {
  console.error('[Content] API Error:', error);
  // Forward error to Service Worker
  sendMessage({ type: 'ERROR', error });
}
```

**Service Worker**
```javascript
try {
  await db.save(data);
} catch (error) {
  console.error('[Background] DB Error:', error);
  // Notify Side Panel
  notifyError(error);
}
```

**Side Panel**
```javascript
// Show user-visible error
showNotification('Failed to load data. Please refresh the page and try again.');
```

---

## Security

### 1. Data isolation
- Per-user data is stored separately
- `conversationId` is used as a partition key

### 2. Least privilege
- Request only the `host_permissions` you need
- Avoid overbroad permissions such as unnecessary `activeTab` usage

### 3. XSS
- Escape or sanitize user-facing content
- Prefer `textContent` over `innerHTML` for untrusted strings

---

## Extensibility

### 1. Pluggable data sources
Future sources can follow a common interface:
```javascript
// src/content/api/plugin-api.js
export interface DataSource {
  fetchConversation(id): Promise<Mapping>
}
```

### 2. Swappable graph library
Adapter pattern for multiple graph engines:
```javascript
// src/sidepanel/graph/adapter.js
export interface GraphAdapter {
  render(data): void
  updateNode(nodeId, data): void
}
```

### 3. Swappable storage
```javascript
// src/background/storage/interface.js
export interface Storage {
  save(key, value): Promise<void>
  get(key): Promise<any>
}
```

---

## Roadmap

### V0.1 (current)
- ✅ Core architecture
- ✅ API integration
- ✅ Persistence
- ✅ Minimal debug UI

### V0.2
- 🚧 Graph visualization
- 🚧 Node search
- 🚧 Basic interactions

### V0.3
- 📋 Branch switching
- 📋 Node details
- 📋 Export

### V1.0
- 📋 Full graph management
- 📋 Cross-conversation views
- 📋 Performance hardening
