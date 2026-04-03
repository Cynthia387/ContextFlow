/**
 * ContextFlow - setup script
 */

import { initI18n, i18n, SUPPORTED_LOCALES, getUserLocale, setUserLocale } from '../shared/i18n.js';

const tokenInput = document.getElementById('token-input');
const testBtn = document.getElementById('test-btn');
const saveBtn = document.getElementById('save-btn');
const alertContainer = document.getElementById('alert-container');

let validatedToken = null;

/**
 * 创建语言切换器
 */
function createLanguageSwitcher() {
  const container = document.getElementById('language-switcher-container');
  if (!container) return;

  // 如果已经存在，先清空
  container.innerHTML = '';

  const switcher = document.createElement('div');
  switcher.className = 'language-switcher';

  const label = document.createElement('label');
  label.textContent = i18n('languageLabel');
  label.htmlFor = 'language-select-setup';

  const select = document.createElement('select');
  select.id = 'language-select-setup';
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

    // 更新语言切换器的标签文本
    label.textContent = i18n('languageLabel');

    // 重新创建按钮文本
    testBtn.textContent = i18n('testTokenBtn');
    saveBtn.textContent = i18n('saveCompleteBtn');
  });

  switcher.appendChild(label);
  switcher.appendChild(select);
  container.appendChild(switcher);
}

// 检查是否已经有 token
async function checkExistingToken() {
  try {
    const result = await chrome.storage.local.get(['accessToken', 'tokenTimestamp']);
    if (result.accessToken) {
      const age = Date.now() - (result.tokenTimestamp || 0);
      const expired = age > 24 * 60 * 60 * 1000;

      if (!expired) {
        showAlert('success', i18n('tokenAlreadyConfigured'));
        tokenInput.placeholder = i18n('newTokenPlaceholder');
      } else {
        showAlert('warning', i18n('tokenExpiredPleaseUpdate'));
      }
    }
  } catch (error) {
    console.error('Failed to check existing token:', error);
  }
}

// 显示提示信息
function showAlert(type, message) {
  alertContainer.innerHTML = `<div class="alert ${type}">${message}</div>`;
}

// 清除提示
function clearAlert() {
  alertContainer.innerHTML = '';
}

// 验证 token 格式
function validateTokenFormat(token) {
  // 移除前后空格
  token = token.trim();

  // 检查是否以 "Bearer " 开头，如果是则移除
  if (token.startsWith('Bearer ')) {
    token = token.substring(7);
  }

  // 基本格式检查
  if (!token) {
    return { valid: false, error: i18n('tokenEmpty') };
  }

  if (token.length < 100) {
    return { valid: false, error: i18n('tokenTooShort') };
  }

  // JWT token 通常以 eyJ 开头（base64 编码的 JSON header）
  if (!token.startsWith('eyJ')) {
    return { valid: false, error: i18n('tokenInvalidFormat') };
  }

  // JWT 格式检查：应该有三个部分，用 . 分隔
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: i18n('tokenInvalidJWT') };
  }

  return { valid: true, token: token };
}

// 测试 token 是否有效
async function testToken(token) {
  try {
    const response = await fetch('https://chatgpt.com/backend-api/me', {
      method: 'GET',
      headers: {
        'authorization': `Bearer ${token}`,
        'accept': '*/*'
      }
    });

    if (response.ok) {
      const data = await response.json();
      return {
        valid: true,
        data: data
      };
    } else if (response.status === 401) {
      return {
        valid: false,
        error: i18n('tokenInvalidOrExpired')
      };
    } else {
      return {
        valid: false,
        error: i18n('apiError', response.status.toString())
      };
    }
  } catch (error) {
    return {
      valid: false,
      error: i18n('networkError', error.message)
    };
  }
}

// 测试按钮点击事件
testBtn.addEventListener('click', async () => {
  clearAlert();

  const rawToken = tokenInput.value;

  // 验证格式
  const formatCheck = validateTokenFormat(rawToken);
  if (!formatCheck.valid) {
    showAlert('error', `❌ ${formatCheck.error}`);
    return;
  }

  const token = formatCheck.token;

  // 显示加载状态
  testBtn.disabled = true;
  testBtn.innerHTML = `<span class="loading"></span>${i18n('testingToken')}`;

  // 测试 token
  const result = await testToken(token);

  testBtn.disabled = false;
  testBtn.textContent = i18n('testTokenBtn');

  if (result.valid) {
    validatedToken = token;
    const email = result.data.email || result.data.name || i18n('accountUnknown');
    showAlert('success', i18n('tokenValidationSuccess', email));
    saveBtn.disabled = false;
  } else {
    validatedToken = null;
    saveBtn.disabled = true;
    showAlert('error', `❌ ${result.error}`);
  }
});

// 保存按钮点击事件
saveBtn.addEventListener('click', async () => {
  if (!validatedToken) {
    showAlert('error', `❌ ${i18n('pleaseTestFirst')}`);
    return;
  }

  saveBtn.disabled = true;
  saveBtn.innerHTML = `<span class="loading"></span>${i18n('savingToken')}`;

  try {
    // 保存到 chrome.storage
    await chrome.storage.local.set({
      accessToken: validatedToken,
      tokenTimestamp: Date.now(),
      tokenSource: 'manual'
    });

    showAlert('success', i18n('tokenSaved'));

    // 等待 1 秒后关闭页面
    setTimeout(() => {
      window.close();
    }, 1000);

  } catch (error) {
    saveBtn.disabled = false;
    saveBtn.textContent = i18n('saveCompleteBtn');
    showAlert('error', `❌ ${i18n('saveFailed', error.message)}`);
  }
});

// 监听输入变化
tokenInput.addEventListener('input', () => {
  clearAlert();
  validatedToken = null;
  saveBtn.disabled = true;
});

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', async () => {
  await initI18n();
  createLanguageSwitcher();
  checkExistingToken();
});
