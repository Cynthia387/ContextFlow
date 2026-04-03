/**
 * QA 树构建和管理模块
 *
 * 将扁平的 nodes + edges 转换为嵌套的 QA 树结构，
 * 并支持追踪用户当前选中的分支路径。
 */

/**
 * @typedef {Object} RootNode
 * @property {'root'} type
 * @property {QNode[]} questions - 顶层问题（可能有多个）
 */

/**
 * @typedef {Object} QNode
 * @property {'Q'} type
 * @property {string} key - 实例 key: `${userId}::${parentAssistantId ?? 'root'}`
 * @property {string} userId - user 消息的 ID
 * @property {string} content - 完整内容
 * @property {string} preview - 截断预览
 * @property {number|null} createTime
 * @property {ANode[]} answers - 该问题的所有回答（0..n）
 */

/**
 * @typedef {Object} ANode
 * @property {'A'} type
 * @property {string} key - 实例 key: `${assistantId}::${parentUserId}`
 * @property {string} assistantId - assistant 消息的 ID
 * @property {string} content - 完整内容
 * @property {string} preview - 截断预览
 * @property {number|null} createTime
 * @property {QNode[]} nextQuestions - 该回答之后的所有追问（0..n）
 */

/**
 * @typedef {Object} QATree
 * @property {RootNode} root - 虚拟根节点
 * @property {Map<string, QNode>} qNodeMap - userId -> QNode
 * @property {Map<string, ANode>} aNodeMap - assistantId -> ANode
 * @property {Map<string, string>} parentMap - nodeId -> parentNodeId
 * @property {Map<string, string[]>} childrenMap - nodeId -> [childNodeId, ...]
 * @property {Set<string>} selectedPath - 当前选中路径上的所有节点 ID
 * @property {string|null} activeLeafId - 当前活跃的叶子节点 ID
 */

const PREVIEW_LENGTH = 80;

/**
 * 截断文本生成预览
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
function truncate(text, maxLength = PREVIEW_LENGTH) {
  if (!text) return '';
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength) + '…';
}

/**
 * 排序比较函数：按 createTime 升序，没有则按 id 字典序
 * @param {Object} a
 * @param {Object} b
 * @returns {number}
 */
function sortByTimeOrId(a, b) {
  const timeA = a.createTime;
  const timeB = b.createTime;

  // 都有 createTime，按时间升序
  if (timeA != null && timeB != null) {
    return timeA - timeB;
  }

  // 只有一个有 createTime，有的排前面
  if (timeA != null) return -1;
  if (timeB != null) return 1;

  // 都没有 createTime，按 id 字典序
  const idA = a.userId || a.assistantId || a.key || '';
  const idB = b.userId || b.assistantId || b.key || '';
  return idA.localeCompare(idB);
}

/**
 * 递归排序 QA 树中的所有 children
 * @param {QNode[]} questions
 */
function sortQATreeRecursively(questions) {
  if (!questions || questions.length === 0) return;

  questions.sort(sortByTimeOrId);

  for (const qNode of questions) {
    if (qNode.answers && qNode.answers.length > 0) {
      qNode.answers.sort(sortByTimeOrId);

      for (const aNode of qNode.answers) {
        if (aNode.nextQuestions && aNode.nextQuestions.length > 0) {
          sortQATreeRecursively(aNode.nextQuestions);
        }
      }
    }
  }
}

/**
 * 构建 QA 树
 *
 * @param {Array} nodes - 节点数组（来自 parseMapping）
 * @param {Array} edges - 边数组（来自 parseMapping）
 * @returns {QATree}
 */
export function buildQATree(nodes, edges) {
  if (!nodes || nodes.length === 0) {
    return createEmptyTree();
  }

  // 1. 创建原始节点映射
  const rawNodeMap = new Map(nodes.map(n => [n.id, n]));

  // 2. 构建父子关系映射
  // 优先使用 edges，同时用 nodes 的 parent/children 字段补充
  const parentMap = new Map();    // nodeId -> parentNodeId
  const childrenMap = new Map();  // nodeId -> [childNodeId, ...]

  // 2a. 先从 nodes 的 parent 字段构建（包含指向 system 等被跳过节点的关系）
  for (const node of nodes) {
    if (node.parent) {
      parentMap.set(node.id, node.parent);
    }
    // 从 children 字段构建 childrenMap
    if (node.children && node.children.length > 0) {
      childrenMap.set(node.id, [...node.children]);
    }
  }

  // 2b. 用 edges 覆盖/补充（edges 只包含有效节点之间的关系）
  for (const edge of edges) {
    parentMap.set(edge.target, edge.source);

    if (!childrenMap.has(edge.source)) {
      childrenMap.set(edge.source, []);
    }
    const children = childrenMap.get(edge.source);
    if (!children.includes(edge.target)) {
      children.push(edge.target);
    }
  }

  // 3. 创建 QNode 和 ANode
  const qNodeMap = new Map();  // userId -> QNode
  const aNodeMap = new Map();  // assistantId -> ANode

  // 辅助函数：向上追溯找到最近的 assistant 祖先
  function findAncestorAssistant(nodeId) {
    let current = parentMap.get(nodeId);
    const visited = new Set();

    while (current && !visited.has(current)) {
      visited.add(current);
      const node = rawNodeMap.get(current);
      if (node && node.role === 'assistant') {
        return current;
      }
      current = parentMap.get(current);
    }
    return null;
  }

  // 辅助函数：向上追溯找到最近的 user 祖先
  function findAncestorUser(nodeId) {
    let current = parentMap.get(nodeId);
    const visited = new Set();

    while (current && !visited.has(current)) {
      visited.add(current);
      const node = rawNodeMap.get(current);
      if (node && node.role === 'user') {
        return current;
      }
      current = parentMap.get(current);
    }
    return null;
  }

  // 3a. 为每个 user 节点创建 QNode
  for (const node of nodes) {
    if (node.role !== 'user') continue;

    // 向上追溯找到最近的 assistant 祖先（跳过 tool 等中间节点）
    const parentAssistantId = findAncestorAssistant(node.id) || 'root';

    const qNode = {
      type: 'Q',
      key: `${node.id}::${parentAssistantId}`,
      userId: node.id,
      content: node.content || '',
      preview: truncate(node.content),
      createTime: node.createTime || null,
      category: node.category || null,
      answers: []
    };

    qNodeMap.set(node.id, qNode);
  }

  // 3b. 为每个 assistant 节点创建 ANode
  for (const node of nodes) {
    if (node.role !== 'assistant') continue;

    // 向上追溯找到最近的 user 祖先（跳过 tool 等中间节点）
    const parentUserId = findAncestorUser(node.id) || 'unknown';

    const aNode = {
      type: 'A',
      key: `${node.id}::${parentUserId}`,
      assistantId: node.id,
      content: node.content || '',
      preview: truncate(node.content),
      createTime: node.createTime || null,
      nextQuestions: []
    };

    aNodeMap.set(node.id, aNode);
  }

  // 4. 建立 QNode.answers 关系
  // 对于每个 assistant 节点，找到它的 user 祖先，并将自己加入该 user 的 answers
  for (const node of nodes) {
    if (node.role !== 'assistant') continue;

    const parentUserId = findAncestorUser(node.id);
    if (!parentUserId) continue;

    const qNode = qNodeMap.get(parentUserId);
    const aNode = aNodeMap.get(node.id);
    if (qNode && aNode && !qNode.answers.includes(aNode)) {
      qNode.answers.push(aNode);
    }
  }

  // 5. 建立 ANode.nextQuestions 关系
  // 对于每个 user 节点，找到它的 assistant 祖先，并将自己加入该 assistant 的 nextQuestions
  for (const node of nodes) {
    if (node.role !== 'user') continue;

    const parentAssistantId = findAncestorAssistant(node.id);
    if (!parentAssistantId) continue;  // root level question

    const aNode = aNodeMap.get(parentAssistantId);
    const qNode = qNodeMap.get(node.id);
    if (aNode && qNode && !aNode.nextQuestions.includes(qNode)) {
      aNode.nextQuestions.push(qNode);
    }
  }

  // 6. 找出根级别的 QNode（没有 assistant 祖先的 user）
  const rootQuestions = [];
  for (const node of nodes) {
    if (node.role !== 'user') continue;

    const parentAssistantId = findAncestorAssistant(node.id);

    if (!parentAssistantId) {
      const qNode = qNodeMap.get(node.id);
      if (qNode) {
        rootQuestions.push(qNode);
      }
    }
  }

  // 7. 递归排序所有 children
  sortQATreeRecursively(rootQuestions);

  // 8. 创建虚拟根节点
  const root = {
    type: 'root',
    questions: rootQuestions
  };

  // 9. 计算默认选中路径（选择最新的分支）
  const { selectedPath, activeLeafId } = computeDefaultSelectedPath(root, qNodeMap, aNodeMap);

  return {
    root,
    qNodeMap,
    aNodeMap,
    parentMap,
    childrenMap,
    selectedPath,
    activeLeafId
  };
}

/**
 * 创建空树
 * @returns {QATree}
 */
function createEmptyTree() {
  return {
    root: { type: 'root', questions: [] },
    qNodeMap: new Map(),
    aNodeMap: new Map(),
    parentMap: new Map(),
    childrenMap: new Map(),
    selectedPath: new Set(),
    activeLeafId: null
  };
}

/**
 * 计算默认选中路径
 * 策略：深度优先遍历，每个分支点选择最后一个子节点（最新的）
 *
 * @param {RootNode} root
 * @param {Map<string, QNode>} qNodeMap
 * @param {Map<string, ANode>} aNodeMap
 * @returns {{ selectedPath: Set<string>, activeLeafId: string|null }}
 */
function computeDefaultSelectedPath(root, qNodeMap, aNodeMap) {
  const selectedPath = new Set();
  let activeLeafId = null;

  if (!root.questions || root.questions.length === 0) {
    return { selectedPath, activeLeafId };
  }

  // 从最后一个根问题开始（最新的）
  let currentQ = root.questions[root.questions.length - 1];

  while (currentQ) {
    selectedPath.add(currentQ.userId);
    activeLeafId = currentQ.userId;

    // 如果没有回答，结束
    if (!currentQ.answers || currentQ.answers.length === 0) {
      break;
    }

    // 选择最后一个回答（最新的）
    const currentA = currentQ.answers[currentQ.answers.length - 1];
    selectedPath.add(currentA.assistantId);
    activeLeafId = currentA.assistantId;

    // 如果没有后续问题，结束
    if (!currentA.nextQuestions || currentA.nextQuestions.length === 0) {
      break;
    }

    // 继续到最后一个后续问题
    currentQ = currentA.nextQuestions[currentA.nextQuestions.length - 1];
  }

  return { selectedPath, activeLeafId };
}

/**
 * 从指定节点向上追溯计算选中路径
 *
 * @param {string} nodeId - 起始节点 ID（可以是 user 或 assistant）
 * @param {Map<string, string>} parentMap - 父节点映射
 * @returns {Set<string>} 从根到该节点的路径
 */
export function computePathFromNode(nodeId, parentMap) {
  const path = new Set();

  let current = nodeId;
  while (current) {
    path.add(current);
    current = parentMap.get(current);
  }

  return path;
}

/**
 * 更新选中路径（当用户切换分支时调用）
 *
 * @param {QATree} tree - QA 树
 * @param {string} newActiveNodeId - 新的活跃节点 ID
 * @returns {QATree} 更新后的树（返回新对象以支持 React 状态更新）
 */
export function updateSelectedPath(tree, newActiveNodeId) {
  const newSelectedPath = computePathFromNode(newActiveNodeId, tree.parentMap);

  return {
    ...tree,
    selectedPath: newSelectedPath,
    activeLeafId: newActiveNodeId
  };
}

/**
 * 判断节点是否在选中路径上
 *
 * @param {string} nodeId
 * @param {Set<string>} selectedPath
 * @returns {boolean}
 */
export function isOnSelectedPath(nodeId, selectedPath) {
  return selectedPath.has(nodeId);
}

/**
 * 获取节点在其兄弟中的位置信息
 * 用于显示类似 "< 1/3 >" 的分支切换器
 *
 * @param {string} nodeId
 * @param {QATree} tree
 * @returns {{ index: number, total: number, siblings: string[] } | null}
 */
export function getSiblingInfo(nodeId, tree) {
  const { qNodeMap, aNodeMap, parentMap, childrenMap } = tree;

  const parentId = parentMap.get(nodeId);
  if (!parentId) {
    // 可能是根级别的问题
    const qNode = qNodeMap.get(nodeId);
    if (qNode && tree.root.questions.length > 1) {
      const siblings = tree.root.questions.map(q => q.userId);
      const index = siblings.indexOf(nodeId);
      return {
        index: index >= 0 ? index : 0,
        total: siblings.length,
        siblings
      };
    }
    return null;
  }

  // 获取父节点的所有子节点
  const siblings = childrenMap.get(parentId) || [];
  if (siblings.length <= 1) {
    return null; // 没有兄弟节点，不需要显示切换器
  }

  const index = siblings.indexOf(nodeId);
  return {
    index: index >= 0 ? index : 0,
    total: siblings.length,
    siblings
  };
}

/**
 * 切换到兄弟节点
 *
 * @param {string} currentNodeId - 当前节点 ID
 * @param {'prev' | 'next'} direction - 方向
 * @param {QATree} tree
 * @returns {QATree | null} 更新后的树，如果无法切换则返回 null
 */
export function switchToSibling(currentNodeId, direction, tree) {
  const siblingInfo = getSiblingInfo(currentNodeId, tree);
  if (!siblingInfo || siblingInfo.total <= 1) {
    return null;
  }

  const { index, siblings } = siblingInfo;
  let newIndex;

  if (direction === 'prev') {
    newIndex = index > 0 ? index - 1 : siblings.length - 1;
  } else {
    newIndex = index < siblings.length - 1 ? index + 1 : 0;
  }

  const newNodeId = siblings[newIndex];
  if (!newNodeId || newNodeId === currentNodeId) {
    return null;
  }

  // 切换到新节点后，需要找到该节点子树中的最深叶子节点
  const newLeafId = findDeepestLeaf(newNodeId, tree);

  return updateSelectedPath(tree, newLeafId);
}

/**
 * 找到从指定节点开始的最深叶子节点
 * 策略：每个分支点选择最后一个子节点
 *
 * @param {string} startNodeId
 * @param {QATree} tree
 * @returns {string}
 */
function findDeepestLeaf(startNodeId, tree) {
  const { qNodeMap, aNodeMap, childrenMap } = tree;

  let currentId = startNodeId;
  let visited = new Set();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);

    const children = childrenMap.get(currentId) || [];
    if (children.length === 0) {
      // 叶子节点
      return currentId;
    }

    // 选择最后一个子节点（最新的）
    // 需要按照排序后的顺序选择
    const qNode = qNodeMap.get(currentId);
    const aNode = aNodeMap.get(currentId);

    if (qNode && qNode.answers.length > 0) {
      // 当前是 Q 节点，下一步到最后一个 A
      currentId = qNode.answers[qNode.answers.length - 1].assistantId;
    } else if (aNode && aNode.nextQuestions.length > 0) {
      // 当前是 A 节点，下一步到最后一个 Q
      currentId = aNode.nextQuestions[aNode.nextQuestions.length - 1].userId;
    } else {
      // 没有子节点了
      return currentId;
    }
  }

  return currentId;
}

/**
 * 获取树的统计信息
 *
 * @param {QATree} tree
 * @returns {Object}
 */
export function getTreeStats(tree) {
  const { qNodeMap, aNodeMap, root } = tree;

  // 计算分支点数量
  let branchPointsQ = 0;  // 有多个回答的问题
  let branchPointsA = 0;  // 有多个追问的回答

  for (const qNode of qNodeMap.values()) {
    if (qNode.answers.length > 1) {
      branchPointsQ++;
    }
  }

  for (const aNode of aNodeMap.values()) {
    if (aNode.nextQuestions.length > 1) {
      branchPointsA++;
    }
  }

  // 计算树的深度
  const depth = computeTreeDepth(root);

  return {
    totalQuestions: qNodeMap.size,
    totalAnswers: aNodeMap.size,
    rootQuestions: root.questions.length,
    branchPointsQ,  // 一个问题有多个回答的分支点
    branchPointsA,  // 一个回答有多个追问的分支点
    totalBranchPoints: branchPointsQ + branchPointsA,
    maxDepth: depth
  };
}

/**
 * 计算树的最大深度
 *
 * @param {RootNode} root
 * @returns {number}
 */
function computeTreeDepth(root) {
  if (!root.questions || root.questions.length === 0) {
    return 0;
  }

  function depthOfQ(qNode) {
    if (!qNode.answers || qNode.answers.length === 0) {
      return 1;
    }
    return 1 + Math.max(...qNode.answers.map(depthOfA));
  }

  function depthOfA(aNode) {
    if (!aNode.nextQuestions || aNode.nextQuestions.length === 0) {
      return 1;
    }
    return 1 + Math.max(...aNode.nextQuestions.map(depthOfQ));
  }

  return Math.max(...root.questions.map(depthOfQ));
}

/**
 * 遍历树中的所有节点（深度优先）
 *
 * @param {QATree} tree
 * @param {function} callback - (node, type: 'Q'|'A', depth: number) => void
 */
export function traverseTree(tree, callback) {
  const { root } = tree;

  function traverseQ(qNode, depth) {
    callback(qNode, 'Q', depth);
    for (const aNode of qNode.answers) {
      traverseA(aNode, depth + 1);
    }
  }

  function traverseA(aNode, depth) {
    callback(aNode, 'A', depth);
    for (const qNode of aNode.nextQuestions) {
      traverseQ(qNode, depth + 1);
    }
  }

  for (const qNode of root.questions) {
    traverseQ(qNode, 0);
  }
}

/**
 * 根据选中路径生成用于展示的扁平列表
 * 只包含选中路径上的节点，按对话顺序排列
 *
 * @param {QATree} tree
 * @returns {Array<{type: 'Q'|'A', node: QNode|ANode, depth: number}>}
 */
export function getSelectedPathAsList(tree) {
  const { root, selectedPath } = tree;
  const result = [];

  function collectFromQ(qNode, depth) {
    if (!selectedPath.has(qNode.userId)) return;

    result.push({ type: 'Q', node: qNode, depth });

    // 找到选中的回答
    for (const aNode of qNode.answers) {
      if (selectedPath.has(aNode.assistantId)) {
        collectFromA(aNode, depth);
        break;
      }
    }
  }

  function collectFromA(aNode, depth) {
    result.push({ type: 'A', node: aNode, depth });

    // 找到选中的追问
    for (const qNode of aNode.nextQuestions) {
      if (selectedPath.has(qNode.userId)) {
        collectFromQ(qNode, depth + 1);
        break;
      }
    }
  }

  // 找到选中的根问题
  for (const qNode of root.questions) {
    if (selectedPath.has(qNode.userId)) {
      collectFromQ(qNode, 0);
      break;
    }
  }

  return result;
}

/**
 * 调试：打印树结构到控制台
 *
 * @param {QATree} tree
 */
export function debugPrintTree(tree) {
  const { root, selectedPath, qNodeMap, aNodeMap, parentMap, childrenMap } = tree;
  const stats = getTreeStats(tree);

  const lines = [];
  lines.push('========== QA Tree ==========');
  lines.push(`Stats: Q=${stats.totalQuestions} A=${stats.totalAnswers} rootQ=${stats.rootQuestions} branchQ=${stats.branchPointsQ} branchA=${stats.branchPointsA} depth=${stats.maxDepth}`);
  lines.push(`ActiveLeaf: ${tree.activeLeafId || '(none)'}`);
  lines.push(`SelectedPath (${selectedPath.size}): ${Array.from(selectedPath).map(id => id.substring(0, 8)).join(' → ')}`);
  lines.push('');

  // 打印 parentMap 摘要
  lines.push(`--- parentMap (${parentMap.size} entries) ---`);
  for (const [child, parent] of parentMap) {
    const childNode = qNodeMap.get(child) || aNodeMap.get(child);
    const parentNode = qNodeMap.get(parent) || aNodeMap.get(parent);
    const childRole = childNode ? (childNode.type === 'Q' ? 'Q' : 'A') : '?';
    const parentRole = parentNode ? (parentNode.type === 'Q' ? 'Q' : 'A') : '?';
    lines.push(`  ${childRole}:${child.substring(0, 8)} ← ${parentRole}:${parent.substring(0, 8)}`);
  }
  lines.push('');

  // 打印树结构
  lines.push('--- Tree Structure ---');
  lines.push(`Root questions: ${root.questions.length}`);

  function printQ(qNode, indent) {
    const sel = selectedPath.has(qNode.userId) ? '✓' : ' ';
    const id = qNode.userId.substring(0, 8);
    const preview = (qNode.preview || '(empty)').substring(0, 50);
    lines.push(`${indent}[${sel}] Q(${id}) "${preview}" → ${qNode.answers.length} answers`);
    for (let i = 0; i < qNode.answers.length; i++) {
      printA(qNode.answers[i], indent + '│ ', i === qNode.answers.length - 1);
    }
  }

  function printA(aNode, indent, isLast) {
    const sel = selectedPath.has(aNode.assistantId) ? '✓' : ' ';
    const id = aNode.assistantId.substring(0, 8);
    const preview = (aNode.preview || '(empty)').substring(0, 50);
    const connector = isLast ? '└─' : '├─';
    lines.push(`${indent}${connector}[${sel}] A(${id}) "${preview}" → ${aNode.nextQuestions.length} next`);
    const childIndent = indent + (isLast ? '  ' : '│ ');
    for (const qNode of aNode.nextQuestions) {
      printQ(qNode, childIndent);
    }
  }

  for (const qNode of root.questions) {
    printQ(qNode, '  ');
  }

  // 检查孤立节点
  const treeQIds = new Set();
  const treeAIds = new Set();
  traverseTree(tree, (node, type) => {
    if (type === 'Q') treeQIds.add(node.userId);
    else treeAIds.add(node.assistantId);
  });

  const orphanQ = [...qNodeMap.keys()].filter(id => !treeQIds.has(id));
  const orphanA = [...aNodeMap.keys()].filter(id => !treeAIds.has(id));

  if (orphanQ.length > 0 || orphanA.length > 0) {
    lines.push('');
    lines.push(`--- Orphan Nodes (not in tree!) ---`);
    for (const id of orphanQ) {
      const q = qNodeMap.get(id);
      const parentId = parentMap.get(id);
      lines.push(`  Q(${id.substring(0, 8)}) parent=${parentId?.substring(0, 8) || 'none'} "${(q.preview || '').substring(0, 40)}"`);
    }
    for (const id of orphanA) {
      const a = aNodeMap.get(id);
      const parentId = parentMap.get(id);
      lines.push(`  A(${id.substring(0, 8)}) parent=${parentId?.substring(0, 8) || 'none'} "${(a.preview || '').substring(0, 40)}"`);
    }
  }

  lines.push('=============================');

  // 一次性输出，避免 console.group 折叠
  console.log(lines.join('\n'));
}
