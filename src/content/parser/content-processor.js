/**
 * 内容后处理器
 * 将结构化内容（图片、音频等）转换为可读文本
 * 可扩展设计：添加新类型只需在 CONTENT_PROCESSORS 中注册
 */
import { log } from '../../shared/utils.js';


/**
 * 内容处理器注册表
 * key: content_type (part 级别的类型)
 * value: (part) => string
 */
const CONTENT_PROCESSORS = {
  /**
   * 图片资源 (DALL-E 生成、上传图片等)
   * 示例结构:
   * {
   *   content_type: 'image_asset_pointer',
   *   asset_pointer: 'sediment://file_xxx',
   *   width: 1024,
   *   height: 1024,
   *   metadata: {
   *     dalle: { gen_id, prompt, ... },
   *     generation: { gen_id, gen_size, ... }
   *   }
   * }
   */
  'image_asset_pointer': (part) => {
    const pointer = part.asset_pointer || '';

    // 尝试获取图片描述/标题
    const title = part.metadata?.dalle?.prompt
               || part.metadata?.generation?.serialization_title
               || part.metadata?.image_gen_title
               || '图片';

    // 获取尺寸信息
    const width = part.width || part.metadata?.container_pixel_width;
    const height = part.height || part.metadata?.container_pixel_height;
    const sizeInfo = (width && height) ? ` (${width}x${height})` : '';

    const result = `[图片: ${title}${sizeInfo}](${pointer})`;
    log('debug', 'ContentProcessor', 'Processed image_asset_pointer:', { title, pointer, result });
    return result;
  },

  // ========== 后续可扩展的处理器 ==========

  // 音频资源 (预留)
  // 'audio_asset_pointer': (part) => {
  //   const pointer = part.asset_pointer || '';
  //   const title = part.metadata?.title || '音频';
  //   return `[音频: ${title}](${pointer})`;
  // },

  // 视频资源 (预留)
  // 'video_asset_pointer': (part) => {
  //   const pointer = part.asset_pointer || '';
  //   const title = part.metadata?.title || '视频';
  //   return `[视频: ${title}](${pointer})`;
  // },

  // 文件资源 (预留)
  // 'file_asset_pointer': (part) => {
  //   const pointer = part.asset_pointer || '';
  //   const filename = part.metadata?.filename || '文件';
  //   return `[文件: ${filename}](${pointer})`;
  // },
};

/**
 * 处理单个 part
 * @param {Object|string} part - 内容片段
 * @returns {string} 处理后的文本
 */
function processPart(part) {
  if (!part) {
    log('debug', 'ContentProcessor', 'processPart: empty part');
    return '';
  }

  // 字符串直接返回
  if (typeof part === 'string') {
    log('debug', 'ContentProcessor', 'processPart: string, length=', part.length);
    return part;
  }

  // 数组递归处理
  if (Array.isArray(part)) {
    log('debug', 'ContentProcessor', 'processPart: array, length=', part.length);
    return part
      .map(processPart)
      .filter(s => s.length > 0)
      .join('');
  }

  // 结构化对象
  if (typeof part === 'object') {
    const contentType = part.content_type;
    log('debug', 'ContentProcessor', 'processPart: object, content_type=', contentType, 'keys=', Object.keys(part));

    // 查找对应的处理器
    const processor = CONTENT_PROCESSORS[contentType];
    if (processor) {
      log('debug', 'ContentProcessor', 'processPart: found processor for', contentType);
      try {
        const result = processor(part);
        log('debug', 'ContentProcessor', 'processPart: processor result=', result);
        return result;
      } catch (e) {
        console.warn('[ContentProcessor] Processor error:', contentType, e);
        return '';
      }
    }

    // 没有处理器，尝试提取 text 字段
    if (typeof part.text === 'string') {
      log('debug', 'ContentProcessor', 'processPart: using text field, length=', part.text.length);
      return part.text;
    }

    // 有嵌套的 parts
    if (Array.isArray(part.parts)) {
      log('debug', 'ContentProcessor', 'processPart: has nested parts, length=', part.parts.length);
      return part.parts
        .map(processPart)
        .filter(s => s.length > 0)
        .join('');
    }

    log('debug', 'ContentProcessor', 'processPart: no processor, no text, no parts - returning empty');
  }

  return '';
}

/**
 * 处理完整的 content 对象
 * @param {Object|string|null} content - 消息内容
 * @returns {string} 处理后的文本
 */
export function processContent(content) {
  log('debug', 'ContentProcessor', 'processContent called with:', typeof content, content ? Object.keys(content) : 'null');

  if (!content) {
    log('debug', 'ContentProcessor', 'processContent: empty content');
    return '';
  }

  // 简单字符串
  if (typeof content === 'string') {
    log('debug', 'ContentProcessor', 'processContent: string, length=', content.length);
    return content;
  }

  // 数组
  if (Array.isArray(content)) {
    log('debug', 'ContentProcessor', 'processContent: array, length=', content.length);
    return content
      .map(processPart)
      .filter(s => s.length > 0)
      .join('');
  }

  // 对象
  if (typeof content === 'object') {
    log('debug', 'ContentProcessor', 'processContent: object, content_type=', content.content_type, 'has parts=', Array.isArray(content.parts));

    // 有 parts 数组 (multimodal_text, text 等)
    if (Array.isArray(content.parts)) {
      log('debug', 'ContentProcessor', 'processContent: processing parts array, length=', content.parts.length);
      const result = content.parts
        .map(processPart)
        .filter(s => s.length > 0)
        .join('\n');
      log('debug', 'ContentProcessor', 'processContent: parts result length=', result.length);
      return result;
    }

    // 有 text 字段 (code, execution_output 等)
    if (typeof content.text === 'string') {
      return content.text;
    }
  }

  return '';
}

/**
 * 检查内容是否有意义（非空）
 * @param {Object|string|null} content - 消息内容
 * @returns {boolean}
 */
export function hasValidContent(content) {
  const processed = processContent(content);
  return processed && processed.trim().length > 0;
}

/**
 * 检查内容中是否包含特定类型（如图片）
 * @param {Object|string|null} content - 消息内容
 * @param {string} contentType - 要检查的类型
 * @returns {boolean}
 */
export function hasContentType(content, contentType) {
  if (!content || typeof content !== 'object') return false;

  if (Array.isArray(content.parts)) {
    return content.parts.some(part => {
      if (typeof part === 'object' && part.content_type === contentType) {
        return true;
      }
      return false;
    });
  }

  return content.content_type === contentType;
}

/**
 * 注册自定义处理器（用于扩展）
 * @param {string} contentType - 内容类型
 * @param {Function} processor - 处理函数 (part) => string
 */
export function registerProcessor(contentType, processor) {
  if (typeof processor !== 'function') {
    console.error('[ContentProcessor] Processor must be a function');
    return;
  }
  CONTENT_PROCESSORS[contentType] = processor;
}

/**
 * 获取已注册的处理器类型列表
 * @returns {string[]}
 */
export function getRegisteredTypes() {
  return Object.keys(CONTENT_PROCESSORS);
}
