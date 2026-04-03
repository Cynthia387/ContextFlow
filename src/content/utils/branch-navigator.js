/**
 * 分支导航模块
 * 用于导航到不在当前显示分支上的消息
 */

import { log } from '../../shared/utils.js';
import { resolveMessageId, findArticleByMessageId, messageIdExistsInDOM } from './message-id-helper.js';

/**
 * 获取当前页面显示的路径 ID 列表
 */
export function getCurrentDisplayedPath() {
  const articles = document.querySelectorAll('article');

  const path = Array.from(articles).map((article) => {
    // 使用统一的 resolveMessageId 函数提取 ID
    const messageId = resolveMessageId(article);
    if (messageId) return messageId;

    // 最后的兜底：data-turn-id
    return article.getAttribute('data-turn-id');
  });

  // 过滤无效值
  return path.filter(id => id);
}

/**
 * 获取消息在当前显示中的分支信息
 * 针对 HTML 结构：<div class="... tabular-nums">1/2</div>
 * @param {string} id - 消息 ID (messageId 或 turnId)
 * @returns {{ current: number, total: number } | null} 分支信息
 */
export function getBranchInfo(id) {
  const article = findArticleByMessageId(id);
  if (!article) return null;

  // 1. 查找包含数字的元素
  // <div class="px-0.5 text-sm font-semibold tabular-nums">1/2</div>
  const branchInfoEl = article.querySelector('.tabular-nums');
  
  // 如果找不到，说明没有分支（比如只有一条回复的情况，界面上可能不显示这个条）
  if (!branchInfoEl) {
    // 默认返回 1/1
    return { current: 1, total: 1 };
  }

  // 2. 解析文本 "1/2"
  const text = branchInfoEl.innerText.trim();
  const match = text.match(/(\d+)\s*\/\s*(\d+)/); // \s* 允许数字和斜杠间有空格
  
  if (match) {
    return {
      current: parseInt(match[1], 10),
      total: parseInt(match[2], 10)
    };
  }
  
  // 如果找到了元素但没解析出数字，兜底返回 1/1
  return { current: 1, total: 1 };
}

/**
 * 点击分支导航按钮
 * 策略：找到 .tabular-nums，它的前一个兄弟是 Prev，后一个兄弟是 Next
 * @param {string} id - 消息 ID
 * @param {'prev' | 'next'} direction - 导航方向
 */
export function clickBranchButton(id, direction) {
  const article = findArticleByMessageId(id);
  if (!article) {
    log('warn', 'BranchNav', `Article not found for ID: ${id}`);
    return false;
  }

  // 1. 先找到路标：那个显示数字的 div
  const branchInfoEl = article.querySelector('.tabular-nums');
  if (!branchInfoEl) {
    log('warn', 'BranchNav', `Branch info element (.tabular-nums) not found for ${id}`);
    return false;
  }

  let button = null;

  // 2. 利用 DOM 结构查找按钮 (结构是：Button - Div - Button)
  if (direction === 'prev') {
    // 上一个兄弟元素
    button = branchInfoEl.previousElementSibling;
    // 再次确认它是不是按钮 (防止中间插了别的 div)
    if (button && button.tagName !== 'BUTTON') {
      button = button.querySelector('button') || branchInfoEl.parentElement.firstElementChild;
    }
  } else {
    // 下一个兄弟元素
    button = branchInfoEl.nextElementSibling;
    if (button && button.tagName !== 'BUTTON') {
      button = button.querySelector('button') || branchInfoEl.parentElement.lastElementChild;
    }
  }

  // 3. 兜底策略：如果兄弟节点找错了，直接找父容器里的所有按钮
  if (!button || button.tagName !== 'BUTTON') {
    const parent = branchInfoEl.parentElement;
    if (parent) {
      const allButtons = parent.querySelectorAll('button');
      if (allButtons.length >= 2) {
        button = direction === 'prev' ? allButtons[0] : allButtons[allButtons.length - 1];
      }
    }
  }

  if (!button) {
    log('error', 'BranchNav', `Button ${direction} not found`);
    return false;
  }

  // 4. 检查禁用状态
  if (button.disabled) {
    log('warn', 'BranchNav', `Button ${direction} is disabled`);
    return false;
  }

  // 5. 执行点击 (JS 点击无视 opacity: 0)
  try {
    button.click();
    return true;
  } catch (e) {
    log('error', 'BranchNav', `Click failed: ${e.message}`);
    return false;
  }
}

/**
 * 等待 DOM 更新（消息切换后）
 * 修复：不再胡乱推测新的 ID，只负责检测旧元素是否消失/脱离文档流
 * @param {string} oldId - 点击前的消息 ID
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<void>} 成功则 resolve，超时 reject
 */
export function waitForBranchChange(oldId, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    // 1. 在点击刚刚发生时，先尝试获取一次旧元素作为参照
    // 注意：这里我们通过 ID 查找特定的 DOM 节点引用
    // 如果是 messageId，我们要找到那个内部的 div；如果是 article，就找 article
    // 为了简单判断，我们直接看能不能在 DOM 里再 select 到这个 ID
    
    const checkChange = () => {
      // 使用统一的函数检查旧 ID 是否还存在于 DOM 中
      const stillExists = messageIdExistsInDOM(oldId);

      // 如果旧 ID 不存在了，说明 DOM 已经刷新
      if (!stillExists) {
        resolve(); // 变化已完成
        return;
      }

      // 检查超时
      if (Date.now() - startTime > timeout) {
        // [修改建议] 超时通常不应该 reject，因为有时 React 复用了组件导致 ID 没变（比如内容变了但 ID 还没变，或者这就是同一个分支？）
        // 但对于 message-id 切换机制，ID 必须变。所以这里 reject 是合理的。
        log('warn', 'BranchNav', `Timeout waiting for ID ${oldId} to disappear`);
        // 即使超时，也 resolve 让流程继续尝试，由后续的路径检查来决定是否失败
        resolve(); 
        return;
      }

      requestAnimationFrame(checkChange);
    };

    requestAnimationFrame(checkChange);
  });
}

/**
 * 在指定消息处切换到目标分支索引
 * 修复：使用 messageId，并基于层级深度(Depth)进行稳定切换
 * * @param {string} startMessageId - 起始消息的 message ID
 * @param {number} targetIndex - 目标分支索引（1-based）
 * @returns {Promise<boolean>} 是否成功
 */
export async function switchToBranchIndex(startMessageId, targetIndex) {
  // 1. 获取分支信息 (确保 getBranchInfo 内部也支持 messageId 查找)
  const branchInfo = getBranchInfo(startMessageId);
  
  if (!branchInfo) {
    log('warn', 'BranchNav', `No branch info for message: ${startMessageId}`);
    return false;
  }

  const { current, total } = branchInfo;

  if (targetIndex < 1 || targetIndex > total) {
    log('warn', 'BranchNav', `Invalid target index: ${targetIndex}/${total}`);
    return false;
  }

  if (current === targetIndex) {
    log('info', 'BranchNav', `Already on branch ${targetIndex}`);
    return true;
  }

  // 2. 锁定层级 (Depth)
  // 因为每次点击后，当前层级的 messageId 会变 (v1 -> v2)，所以我们不能一直用 startMessageId
  // 我们必须记住它在路径中的位置（索引）。
  let currentPath = getCurrentDisplayedPath();
  const depthIndex = currentPath.indexOf(startMessageId);

  if (depthIndex === -1) {
    log('error', 'BranchNav', `Start message ${startMessageId} not found in current path`);
    return false;
  }

  // 计算需要点击的次数和方向
  const diff = targetIndex - current;
  const direction = diff > 0 ? 'next' : 'prev';
  const clicks = Math.abs(diff);

  log('info', 'BranchNav', `Switching depth [${depthIndex}] from ${current} to ${targetIndex} (${clicks} clicks ${direction})`);

  // 3. 执行循环点击
  for (let i = 0; i < clicks; i++) {
    // 重新获取路径 (因为上一次点击可能已经改变了 DOM)
    currentPath = getCurrentDisplayedPath();
    
    // [关键修正] 获取当前层级对应的 ID
    // 比如：第一次循环是 v1的ID，第二次循环就是 v2的ID
    const currentIdAtDepth = currentPath[depthIndex];

    if (!currentIdAtDepth) {
      log('error', 'BranchNav', `Lost track of node at depth ${depthIndex} during step ${i + 1}`);
      return false;
    }

    // 执行点击
    if (!clickBranchButton(currentIdAtDepth, direction)) {
      log('error', 'BranchNav', `Failed to click ${direction} button for ${currentIdAtDepth} at step ${i + 1}`);
      return false;
    }

    // 等待 DOM 更新
    try {
      // 这里的 waitForBranchChange 需要传入旧 ID，它会等待直到该 ID 从 DOM 消失或变为新状态
      await waitForBranchChange(currentIdAtDepth, 2000);
      
      // 额外缓冲，等待 React 彻底渲染完新 ID
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      log('error', 'BranchNav', `Error waiting for branch change: ${error.message}`);
      return false;
    }
  }

  return true;
}

/**
 * 根据节点数据构建从根到目标的路径
 * @param {string} targetId - 目标消息 ID
 * @param {Map<string, Object>} nodeMap - 节点映射
 * @returns {string[]} 从根到目标的路径（ID 数组）
 */
export function buildPathToTarget(targetId, nodeMap) {
  const path = [];
  let currentId = targetId;
  let safetyCounter = 0;
  const MAX_DEPTH = 10000; // 足够深，但防止死循环

  while (currentId) {
    path.unshift(currentId);
    
    // 安全熔断
    if (++safetyCounter > MAX_DEPTH) {
      console.error('[buildPathToTarget] Potential cycle detected or path too long');
      break;
    }

    const node = nodeMap.get(currentId);
    currentId = node?.parent || null;
  }

  return path;
}

/**
 * 计算兄弟节点中的索引（1-based）
 * @param {string} nodeId - 节点 ID
 * @param {Map<string, Object>} nodeMap - 节点映射
 * @returns {number} 在兄弟中的索引（1-based），如果无法确定返回 1
 */
export function getSiblingIndex(nodeId, nodeMap) {
  // 1. 获取排序好的兄弟列表
  const siblings = getSiblings(nodeId, nodeMap);
  
  // 2. 查找当前节点的位置
  const index = siblings.indexOf(nodeId);
  
  // 3. 转换为 1-based 索引
  // 如果没找到 (index === -1)，默认返回 1
  return index >= 0 ? index + 1 : 1;
}

/**
 * 获取节点的所有兄弟节点 ID（包括自己）
 * @param {string} nodeId - 节点 ID
 * @param {Map<string, Object>} nodeMap - 节点映射
 * @returns {string[]} 兄弟节点 ID 数组（按 createTime 排序）
 */
export function getSiblings(nodeId, nodeMap) {
  const node = nodeMap.get(nodeId);
  if (!node) return [nodeId];

  let siblingsNodes = [];

  // 情况 A: 没有父节点 (Root 节点)
  if (!node.parent) {
    // 注意：这就需要遍历整个 map，性能开销较大但不可避免
    siblingsNodes = Array.from(nodeMap.values())
      .filter(n => !n.parent);
  } 
  // 情况 B: 有父节点
  else {
    const parentNode = nodeMap.get(node.parent);
    if (parentNode && parentNode.children) {
      siblingsNodes = parentNode.children
        .map(id => nodeMap.get(id))
        .filter(n => n); // 过滤掉找不到的脏数据
    } else {
      // 父节点数据丢失的边缘情况
      return [nodeId];
    }
  }

  // [关键优化] 稳定排序逻辑
  siblingsNodes.sort((a, b) => {
    const timeA = a.createTime || 0;
    const timeB = b.createTime || 0;
    
    // 1. 优先按创建时间排序 (旧 -> 新)
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    
    // 2. 时间相同，按 ID 字典序排序 (确保确定性)
    // 这一步能防止 "Diff" 计算在刷新后发生跳变
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  return siblingsNodes.map(n => n.id);
}

/**
 * 导航到指定消息
 * 这是主入口函数，处理完整的导航逻辑
 *
 * @param {string} targetId - 目标消息 ID
 * @param {Object[]} nodes - 所有节点数组
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function navigateToMessage(targetId, nodes) {
  log('info', 'BranchNav', `Navigating to message: ${targetId}`);

  // 构建节点映射
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // 检查目标节点是否存在
  if (!nodeMap.has(targetId)) {
    return { success: false, message: `Target node not found: ${targetId}` };
  }

  // 构建目标路径
  const targetPath = buildPathToTarget(targetId, nodeMap); // TODO: 检查逻辑是否正确
  log('info', 'BranchNav', `Target path: ${targetPath.length} nodes`);

  // 获取当前显示的路径
  let currentPath = getCurrentDisplayedPath(); // TODO: 检查逻辑是否正确
  log('info', 'BranchNav', `Current path: ${currentPath.length} nodes`);

  // 检查目标是否已经在当前路径上
  if (currentPath.includes(targetId)) {
    log('info', 'BranchNav', 'Target already in current path');
    return { success: true, message: 'Already on target branch' };
  }

  // 找到分歧点：遍历目标路径，找到第一个不在当前路径上的节点
  let divergeIndex = -1;
  for (let i = 0; i < targetPath.length; i++) {
    if (!currentPath.includes(targetPath[i])) {
      divergeIndex = i;
      break;
    }
  }

  if (divergeIndex === -1) {
    return { success: false, message: 'Unexpected: all target ancestors in current path but target not found' };
  }

  log('info', 'BranchNav', `Divergence at index ${divergeIndex}, node: ${targetPath[divergeIndex]}`);

  // 从分歧点开始，逐层切换分支
  for (let i = divergeIndex; i < targetPath.length; i++) {
    const targetNodeId = targetPath[i];
    const targetNode = nodeMap.get(targetNodeId);

    // 获取目标节点的所有兄弟
    const siblings = getSiblings(targetNodeId, nodeMap);

    if (siblings.length <= 1) {
      // 没有兄弟，不需要切换，继续下一层
      log('info', 'BranchNav', `Node ${targetNodeId.substring(0, 8)}... has no siblings, skipping`);
      continue;
    }

    // 计算目标在兄弟中的索引（1-based）
    const targetSiblingIndex = siblings.indexOf(targetNodeId) + 1;
    log('info', 'BranchNav', `Target sibling index: ${targetSiblingIndex}/${siblings.length}`);

    // 获取当前显示的路径
    currentPath = getCurrentDisplayedPath();

    // 找到当前显示中哪个兄弟在路径上
    let currentSiblingId = null;
    for (const siblingId of siblings) {
      if (currentPath.includes(siblingId)) {
        currentSiblingId = siblingId;
        break;
      }
    }

    // ================= [DEBUG START] =================
    if (!currentSiblingId) {
      log('warn', 'BranchNav', `🛑 No sibling found in current path! Debugging context:`);
      
      // 1. 打印这一层所有的兄弟 ID (State 中的数据)
      console.group('State Data (Siblings)');
      console.log('Target Node ID:', targetNodeId);
      console.log('All Siblings at this level:', siblings);
      console.groupEnd();

      // 2. 打印当前页面上抓取到的所有 ID (DOM 中的数据)
      console.group('DOM Data (Current Path)');
      console.log('Full Current Path IDs:', currentPath);
      // 特别打印出对应 index 的那个 DOM ID，看看它到底是谁
      console.log(`Node at divergence index [${i}]:`, currentPath[i]); 
      console.groupEnd();

      // 3. 尝试进行模糊匹配检查 (帮助排查是否是格式问题)
      const likelyMatch = siblings.find(sId => 
        currentPath.some(pId => pId && (pId.includes(sId) || sId.includes(pId)))
      );
      if (likelyMatch) {
        console.warn(`💡 HINT: Found a potential fuzzy match! State: "${likelyMatch}" vs DOM. Check ID format.`);
      } else {
        console.warn(`❌ No fuzzy match found either.`);
      }
    }
    // ================= [DEBUG END] =================

    if (!currentSiblingId) {
      log('warn', 'BranchNav', `No sibling found in current path for target ${targetNodeId.substring(0, 8)}...`);
      // 尝试继续，可能已经在正确路径上
      continue;
    }

    // 检查是否已经在目标分支
    if (currentSiblingId === targetNodeId) {
      log('info', 'BranchNav', `Already on target sibling at this level`);
      continue;
    }

    // 获取当前兄弟的分支信息
    const branchInfo = getBranchInfo(currentSiblingId);
    if (!branchInfo) {
      log('warn', 'BranchNav', `No branch info for ${currentSiblingId.substring(0, 8)}...`);
      continue;
    }

    log('info', 'BranchNav', `Switching from ${branchInfo.current}/${branchInfo.total} to ${targetSiblingIndex}`);

    // 计算需要点击的次数和方向
    const diff = targetSiblingIndex - branchInfo.current;
    if (diff === 0) {
      log('info', 'BranchNav', 'Already on correct branch index');
      continue;
    }

    const direction = diff > 0 ? 'next' : 'prev';
    const clicks = Math.abs(diff);

    log('info', 'BranchNav', `Need ${clicks} clicks ${direction}`);

    // 执行点击
    for (let c = 0; c < clicks; c++) {
      // 重新获取当前路径（每次点击后 DOM 会变化）
      currentPath = getCurrentDisplayedPath();

      // 重新找当前兄弟
      let currentTurnId = null;
      for (const siblingId of siblings) {
        if (currentPath.includes(siblingId)) {
          currentTurnId = siblingId;
          break;
        }
      }

      if (!currentTurnId) {
        // 可能已经切换了，直接用第一个显示的节点
        currentTurnId = currentPath[0];
      }

      if (!clickBranchButton(currentTurnId, direction)) {
        log('error', 'BranchNav', `Failed to click ${direction} at step ${c + 1}`);
        return { success: false, message: `Failed to click ${direction} button` };
      }

      // 等待 DOM 更新
      try {
        await waitForBranchChange(currentTurnId, 2000);
        await new Promise(resolve => setTimeout(resolve, 150));
      } catch (error) {
        log('error', 'BranchNav', `Error waiting for change: ${error.message}`);
        return { success: false, message: error.message };
      }
    }

    // 等待稳定
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // 最终验证
  currentPath = getCurrentDisplayedPath();
  if (currentPath.includes(targetId)) {
    log('info', 'BranchNav', 'Navigation successful!');
    return { success: true, message: 'Navigation successful' };
  } else {
    log('warn', 'BranchNav', 'Target not in final path, but navigation completed');
    // 可能目标是较深层级的消息，继续返回成功让调用者再次检查
    return { success: true, message: 'Navigation completed' };
  }
}
