/**
 * 缓存管理模块
 */

import { CONFIG, STORAGE_KEYS } from '../../shared/constants.js';

/**
 * 缓存管理器
 */
export class CacheManager {
  constructor() {
    this.cache = new Map();
    this.maxSize = CONFIG.MAX_CACHE_SIZE;
    this.ttl = CONFIG.CACHE_TTL;
  }

  /**
   * 生成缓存键
   * @param {string} key - 键
   * @returns {string}
   */
  _getCacheKey(key) {
    return `${STORAGE_KEYS.CACHE_PREFIX}${key}`;
  }

  /**
   * 设置缓存
   * @param {string} key - 键
   * @param {any} value - 值
   * @param {number} [ttl] - 过期时间（毫秒），默认使用配置值
   */
  set(key, value, ttl = this.ttl) {
    // 如果缓存已满，删除最旧的条目（LRU）
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

  /**
   * 获取缓存
   * @param {string} key - 键
   * @returns {any|null}
   */
  get(key) {
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    // 检查是否过期
    const age = Date.now() - cached.timestamp;
    if (age > cached.ttl) {
      this.cache.delete(key);
      console.log(`[Cache] Expired: ${key}`);
      return null;
    }

    console.log(`[Cache] Hit: ${key}`);
    return cached.value;
  }

  /**
   * 删除缓存
   * @param {string} key - 键
   */
  delete(key) {
    this.cache.delete(key);
    console.log(`[Cache] Deleted: ${key}`);
  }

  /**
   * 清空缓存
   */
  clear() {
    this.cache.clear();
    console.log('[Cache] Cleared all');
  }

  /**
   * 获取缓存统计
   * @returns {Object}
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      keys: Array.from(this.cache.keys())
    };
  }
}

// 导出单例实例
export const cache = new CacheManager();
