/**
 * i18n 辅助函数
 */

// 当前使用的语言
let currentLocale = null;

// 支持的语言列表
export const SUPPORTED_LOCALES = {
  'en': 'English',
  'zh_CN': '简体中文'
};

/**
 * 获取用户设置的语言
 * @returns {Promise<string>}
 */
export async function getUserLocale() {
  try {
    const result = await chrome.storage.local.get(['userLocale']);
    return result.userLocale || chrome.i18n.getUILanguage().replace('-', '_');
  } catch (error) {
    return chrome.i18n.getUILanguage().replace('-', '_');
  }
}

/**
 * 设置用户语言
 * @param {string} locale - 语言代码
 * @returns {Promise<void>}
 */
export async function setUserLocale(locale) {
  await chrome.storage.local.set({ userLocale: locale });
  currentLocale = locale;
}

/**
 * 获取当前语言
 * @returns {string}
 */
export function getCurrentLocale() {
  return currentLocale || chrome.i18n.getUILanguage().replace('-', '_');
}

/**
 * 加载指定语言的消息
 * @param {string} locale - 语言代码
 * @returns {Promise<Object>}
 */
async function loadMessages(locale) {
  try {
    // 尝试精确匹配
    const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`);
    const response = await fetch(url);
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.warn(`Failed to load locale ${locale}:`, error);
  }

  // 尝试语言代码（去掉国家/地区）
  const lang = locale.split('_')[0];
  if (lang !== locale) {
    try {
      const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.warn(`Failed to load language ${lang}:`, error);
    }
  }

  // 回退到英文
  try {
    const url = chrome.runtime.getURL('_locales/en/messages.json');
    const response = await fetch(url);
    return await response.json();
  } catch (error) {
    console.error('Failed to load fallback locale:', error);
    return {};
  }
}

// 缓存的消息
let messagesCache = null;

/**
 * 获取国际化消息
 * @param {string} key - 消息键
 * @param {Array|string} substitutions - 替换内容
 * @returns {string}
 */
export function i18n(key, substitutions) {
  // 如果有缓存，使用缓存的消息
  if (messagesCache && messagesCache[key]) {
    let message = messagesCache[key].message;

    // 处理占位符替换
    if (substitutions) {
      const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
      subs.forEach((sub, index) => {
        const placeholder = `$${index + 1}`;
        message = message.replace(new RegExp(`\\$${index + 1}\\$`, 'g'), sub);
      });

      // 处理命名占位符
      if (messagesCache[key].placeholders) {
        Object.entries(messagesCache[key].placeholders).forEach(([name, config]) => {
          const placeholderPattern = new RegExp(`\\$${name.toUpperCase()}\\$`, 'gi');
          message = message.replace(placeholderPattern, subs[0] || '');
        });
      }
    }

    return message;
  }

  // 回退到 Chrome API
  return chrome.i18n.getMessage(key, substitutions) || key;
}

/**
 * 初始化页面国际化
 * 查找所有带有 data-i18n 属性的元素并替换文本
 * @param {string} locale - 可选的语言代码
 */
export async function initI18n(locale) {
  // 获取用户设置的语言
  if (!locale) {
    locale = await getUserLocale();
  }

  currentLocale = locale;

  // 加载消息文件
  messagesCache = await loadMessages(locale);

  // 翻译所有带有 data-i18n 属性的元素
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    const text = i18n(key);

    // 如果是 HTML 内容（包含标签），使用 innerHTML
    if (text.includes('<')) {
      element.innerHTML = text;
    } else {
      element.textContent = text;
    }
  });

  // 翻译所有带有 data-i18n-placeholder 属性的输入框
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    const key = element.getAttribute('data-i18n-placeholder');
    element.placeholder = i18n(key);
  });

  // 翻译所有带有 data-i18n-title 属性的元素
  document.querySelectorAll('[data-i18n-title]').forEach(element => {
    const key = element.getAttribute('data-i18n-title');
    element.title = i18n(key);
  });

  // 翻译页面标题
  const titleKey = document.documentElement.getAttribute('data-i18n-title');
  if (titleKey) {
    document.title = i18n(titleKey);
  }

  // 设置 HTML lang 属性
  document.documentElement.lang = locale.replace('_', '-');
}

/**
 * 创建语言切换器
 * @param {HTMLElement} container - 容器元素
 * @param {Function} onLocaleChange - 语言切换回调
 */
export function createLanguageSwitcher(container, onLocaleChange) {
  const switcher = document.createElement('div');
  switcher.className = 'language-switcher';

  const select = document.createElement('select');
  select.className = 'language-select';

  // 添加语言选项
  Object.entries(SUPPORTED_LOCALES).forEach(([code, name]) => {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = name;
    select.appendChild(option);
  });

  // 设置当前语言
  getUserLocale().then(locale => {
    select.value = locale;
  });

  // 监听变化
  select.addEventListener('change', async (e) => {
    const newLocale = e.target.value;
    await setUserLocale(newLocale);
    await initI18n(newLocale);

    if (onLocaleChange) {
      onLocaleChange(newLocale);
    }
  });

  switcher.appendChild(select);
  container.appendChild(switcher);

  return switcher;
}
