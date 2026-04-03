/**
 * ContextFlow - popup script
 */

import { initI18n, i18n, SUPPORTED_LOCALES, getUserLocale, setUserLocale } from '../shared/i18n.js';
import { STORAGE_KEYS, DEFAULT_COLLAPSE_SETTINGS } from '../shared/constants.js';
import { MESSAGE_TYPES } from '../shared/constants.js';

// 折叠设置
let collapseSettings = { ...DEFAULT_COLLAPSE_SETTINGS };

// Side panel UI zoom (CSS zoom). This is independent from the webpage zoom.
let sidepanelUiZoom = 1;
const SIDEPANEL_ZOOM_MIN = 60; // %
const SIDEPANEL_ZOOM_MAX = 140; // %
const SIDEPANEL_ZOOM_STEP = 5; // %

// Debug log enabled state
let debugLogEnabled = false;

// Debug log levels
let debugLogLevels = {
  verbose: true,  // log, debug, info
  warn: true,
  error: true
};

/**
 * 加载折叠设置
 */
async function loadCollapseSettings() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.COLLAPSE_SETTINGS);
    const stored = result[STORAGE_KEYS.COLLAPSE_SETTINGS];
    if (stored) {
      collapseSettings = { ...DEFAULT_COLLAPSE_SETTINGS, ...stored };
    }
  } catch (e) {
    console.warn('Failed to load collapse settings:', e);
  }
  return collapseSettings;
}

/**
 * Load sidepanel UI zoom
 */
async function loadSidepanelZoom() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SIDEPANEL_UI_ZOOM);
    const stored = result[STORAGE_KEYS.SIDEPANEL_UI_ZOOM];
    const z = Number(stored);
    if (Number.isFinite(z) && z >= 0.5 && z <= 2.5) {
      sidepanelUiZoom = z;
    } else {
      sidepanelUiZoom = 1;
    }
  } catch (e) {
    console.warn('Failed to load sidepanel zoom:', e);
    sidepanelUiZoom = 1;
  }
  return sidepanelUiZoom;
}

/**
 * Save sidepanel UI zoom
 */
async function saveSidepanelZoom(nextZoom) {
  const z = Number(nextZoom);
  if (!Number.isFinite(z)) return;
  sidepanelUiZoom = Math.max(0.5, Math.min(2.5, z));
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.SIDEPANEL_UI_ZOOM]: sidepanelUiZoom });
  } catch (e) {
    console.error('Failed to save sidepanel zoom:', e);
  }
}

/**
 * 保存折叠设置
 */
async function saveCollapseSettings() {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.COLLAPSE_SETTINGS]: collapseSettings });

    // 通知 content script 设置已变更
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && (tab.url.includes('chatgpt.com') || tab.url.includes('chat.openai.com'))) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'COLLAPSE_SETTINGS_CHANGED' });
      } catch (e) {
        // Content script 可能未加载，忽略错误
      }
    }
  } catch (e) {
    console.error('Failed to save collapse settings:', e);
  }
}

/**
 * 创建折叠设置面板 HTML
 */
function createCollapseSettingsHTML() {
  const disabledClass = collapseSettings.enabled ? '' : 'setting-disabled';

  return `
    <div class="collapse-settings">
      <h3>${i18n('collapseSettingsTitle') || 'Content Collapse Settings'}</h3>

      <div class="setting-item">
        <label for="collapse-enabled">
          <input type="checkbox" id="collapse-enabled" ${collapseSettings.enabled ? 'checked' : ''}>
          ${i18n('collapseEnabled') || 'Enable auto collapse'}
        </label>
      </div>

      <div class="setting-group ${disabledClass}" id="collapse-options">
        <div class="setting-item">
          <label for="collapse-threshold">${i18n('collapseThreshold') || 'Collapse threshold'}</label>
          <div>
            <input type="number" id="collapse-threshold" value="${collapseSettings.threshold}" min="50" max="2000" step="50">
            <span class="unit">${i18n('collapseThresholdUnit') || 'characters'}</span>
          </div>
        </div>

        <div class="setting-item">
          <label for="collapse-question">
            <input type="checkbox" id="collapse-question" ${collapseSettings.autoCollapseQuestion ? 'checked' : ''}>
            ${i18n('collapseQuestion') || 'Auto collapse questions'}
          </label>
        </div>

        <div class="setting-item">
          <label for="collapse-answer">
            <input type="checkbox" id="collapse-answer" ${collapseSettings.autoCollapseAnswer ? 'checked' : ''}>
            ${i18n('collapseAnswer') || 'Auto collapse answers'}
          </label>
        </div>
      </div>
    </div>
  `;
}

/**
 * Create sidepanel zoom settings panel HTML
 */
function createSidepanelZoomSettingsHTML() {
  const percent = Math.round((Number(sidepanelUiZoom) || 1) * 100);
  const clamped = Math.max(SIDEPANEL_ZOOM_MIN, Math.min(SIDEPANEL_ZOOM_MAX, percent));
  return `
    <div class="collapse-settings">
      <h3>${i18n('sidepanelZoomTitle') || 'Side Panel UI Zoom'}</h3>

      <div class="setting-item" style="flex-direction: column; align-items: stretch; gap: 8px;">
        <div style="display:flex; justify-content: space-between; align-items:center; width:100%;">
          <span class="status-label">${i18n('sidepanelZoomLabel') || 'Zoom (independent from webpage)'}</span>
          <span class="zoom-value" id="sidepanel-zoom-value">${clamped}%</span>
        </div>

        <div class="zoom-row">
          <input
            type="range"
            id="sidepanel-zoom-range"
            min="${SIDEPANEL_ZOOM_MIN}"
            max="${SIDEPANEL_ZOOM_MAX}"
            step="${SIDEPANEL_ZOOM_STEP}"
            value="${clamped}"
          />
          <button class="mini-btn" id="sidepanel-zoom-reset">${i18n('reset') || 'Reset'}</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Load debug log enabled setting
 */
async function loadDebugLogSetting() {
  try {
    const result = await chrome.storage.local.get([
      STORAGE_KEYS.DEBUG_LOG_ENABLED,
      STORAGE_KEYS.DEBUG_LOG_LEVELS
    ]);
    debugLogEnabled = result[STORAGE_KEYS.DEBUG_LOG_ENABLED] === true;
    if (result[STORAGE_KEYS.DEBUG_LOG_LEVELS]) {
      debugLogLevels = { ...debugLogLevels, ...result[STORAGE_KEYS.DEBUG_LOG_LEVELS] };
    }
  } catch (e) {
    console.warn('Failed to load debug log setting:', e);
    debugLogEnabled = false;
  }
  return debugLogEnabled;
}

/**
 * Save debug log enabled setting
 */
async function saveDebugLogSetting(enabled) {
  debugLogEnabled = enabled;
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.DEBUG_LOG_ENABLED]: enabled });
  } catch (e) {
    console.error('Failed to save debug log setting:', e);
  }
}

/**
 * Save debug log levels
 */
async function saveDebugLogLevels() {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.DEBUG_LOG_LEVELS]: debugLogLevels });
  } catch (e) {
    console.error('Failed to save debug log levels:', e);
  }
}

/**
 * Create debug log toggle HTML
 */
function createDebugLogSettingsHTML() {
  const disabledClass = debugLogEnabled ? '' : 'setting-disabled';

  return `
    <div class="collapse-settings">
      <h3>${i18n('debugLogTitle') || 'Developer Options'}</h3>

      <div class="setting-item">
        <label for="debug-log-enabled">
          <input type="checkbox" id="debug-log-enabled" ${debugLogEnabled ? 'checked' : ''}>
          ${i18n('debugLogEnabled') || 'Enable debug logging'}
        </label>
      </div>

      <div class="setting-group ${disabledClass}" id="debug-log-levels">
        <div class="setting-item">
          <label for="debug-log-verbose">
            <input type="checkbox" id="debug-log-verbose" ${debugLogLevels.verbose ? 'checked' : ''}>
            ${i18n('debugLogVerbose') || 'Verbose (log/debug/info)'}
          </label>
        </div>

        <div class="setting-item">
          <label for="debug-log-warn">
            <input type="checkbox" id="debug-log-warn" ${debugLogLevels.warn ? 'checked' : ''}>
            ${i18n('debugLogWarn') || 'Warnings'}
          </label>
        </div>

        <div class="setting-item">
          <label for="debug-log-error">
            <input type="checkbox" id="debug-log-error" ${debugLogLevels.error ? 'checked' : ''}>
            ${i18n('debugLogError') || 'Errors'}
          </label>
        </div>
      </div>
    </div>
  `;
}

/**
 * Bind events for debug log toggle
 */
function bindDebugLogSettingsEvents() {
  const enabledCheckbox = document.getElementById('debug-log-enabled');
  const verboseCheckbox = document.getElementById('debug-log-verbose');
  const warnCheckbox = document.getElementById('debug-log-warn');
  const errorCheckbox = document.getElementById('debug-log-error');
  const levelsGroup = document.getElementById('debug-log-levels');

  if (enabledCheckbox) {
    enabledCheckbox.addEventListener('change', async () => {
      debugLogEnabled = enabledCheckbox.checked;

      // Update disabled state of level options
      if (levelsGroup) {
        if (debugLogEnabled) {
          levelsGroup.classList.remove('setting-disabled');
        } else {
          levelsGroup.classList.add('setting-disabled');
        }
      }

      await saveDebugLogSetting(enabledCheckbox.checked);
    });
  }

  if (verboseCheckbox) {
    verboseCheckbox.addEventListener('change', async () => {
      debugLogLevels.verbose = verboseCheckbox.checked;
      await saveDebugLogLevels();
    });
  }

  if (warnCheckbox) {
    warnCheckbox.addEventListener('change', async () => {
      debugLogLevels.warn = warnCheckbox.checked;
      await saveDebugLogLevels();
    });
  }

  if (errorCheckbox) {
    errorCheckbox.addEventListener('change', async () => {
      debugLogLevels.error = errorCheckbox.checked;
      await saveDebugLogLevels();
    });
  }
}

/**
 * Bind events for sidepanel zoom settings
 */
function bindSidepanelZoomSettingsEvents() {
  const range = document.getElementById('sidepanel-zoom-range');
  const valueEl = document.getElementById('sidepanel-zoom-value');
  const resetBtn = document.getElementById('sidepanel-zoom-reset');

  const updateValue = (pct) => {
    if (valueEl) valueEl.textContent = `${pct}%`;
  };

  if (range) {
    range.addEventListener('input', () => {
      const pct = parseInt(range.value, 10);
      updateValue(pct);
    });

    range.addEventListener('change', async () => {
      const pct = parseInt(range.value, 10);
      if (!Number.isFinite(pct)) return;
      const z = pct / 100;
      await saveSidepanelZoom(z);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      if (range) {
        range.value = '100';
        updateValue(100);
      }
      await saveSidepanelZoom(1);
    });
  }
}

/**
 * 绑定折叠设置事件
 */
function bindCollapseSettingsEvents() {
  const enabledCheckbox = document.getElementById('collapse-enabled');
  const thresholdInput = document.getElementById('collapse-threshold');
  const questionCheckbox = document.getElementById('collapse-question');
  const answerCheckbox = document.getElementById('collapse-answer');
  const optionsGroup = document.getElementById('collapse-options');

  if (enabledCheckbox) {
    enabledCheckbox.addEventListener('change', async () => {
      collapseSettings.enabled = enabledCheckbox.checked;

      // 更新子选项的禁用状态
      if (optionsGroup) {
        if (collapseSettings.enabled) {
          optionsGroup.classList.remove('setting-disabled');
        } else {
          optionsGroup.classList.add('setting-disabled');
        }
      }

      await saveCollapseSettings();
    });
  }

  if (thresholdInput) {
    thresholdInput.addEventListener('change', async () => {
      const value = parseInt(thresholdInput.value, 10);
      if (value >= 50 && value <= 2000) {
        collapseSettings.threshold = value;
        await saveCollapseSettings();
      }
    });
  }

  if (questionCheckbox) {
    questionCheckbox.addEventListener('change', async () => {
      collapseSettings.autoCollapseQuestion = questionCheckbox.checked;
      await saveCollapseSettings();
    });
  }

  if (answerCheckbox) {
    answerCheckbox.addEventListener('change', async () => {
      collapseSettings.autoCollapseAnswer = answerCheckbox.checked;
      await saveCollapseSettings();
    });
  }
}

// 创建语言切换器
function createLanguageSwitcher() {
  const container = document.getElementById('language-switcher-container');
  if (!container) return;

  // 如果已经存在，先清空
  container.innerHTML = '';

  const switcher = document.createElement('div');
  switcher.className = 'language-switcher';

  const label = document.createElement('label');
  label.textContent = i18n('languageLabel');
  label.htmlFor = 'language-select';

  const select = document.createElement('select');
  select.id = 'language-select';
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

    // 重新加载状态以更新界面文本
    loadStatusContent();
  });

  switcher.appendChild(label);
  switcher.appendChild(select);
  container.appendChild(switcher);
}

async function loadStatus() {
  // 初始化国际化
  await initI18n();

  // 加载折叠设置
  await loadCollapseSettings();

  // Load side panel UI zoom setting
  await loadSidepanelZoom();

  // Load debug log setting
  await loadDebugLogSetting();

  // 创建语言切换器（只创建一次）
  createLanguageSwitcher();

  // 加载内容
  loadStatusContent();
}

async function loadStatusContent() {
  const container = document.getElementById('content');

  try {
    // 获取存储的 token
    const result = await chrome.storage.local.get(['accessToken', 'tokenTimestamp', 'tokenSource']);

    const hasToken = !!result.accessToken;
    const tokenSource = result.tokenSource || 'manual'; // 'auto' 或 'manual'
    const tokenAge = result.tokenTimestamp ? Date.now() - result.tokenTimestamp : null;
    const tokenAgeMinutes = tokenAge ? Math.floor(tokenAge / 1000 / 60) : null;
    const tokenAgeHours = tokenAge ? Math.floor(tokenAge / 1000 / 60 / 60) : null;
    const tokenExpired = tokenAge && tokenAge > 24 * 60 * 60 * 1000; // 24小时

    let statusHtml = '';

    // 如果没有 token，显示设置引导
    if (!hasToken) {
      statusHtml = `
        <div class="status">
          <div class="status-item">
            <span class="status-label">${i18n('statusLabel')}</span>
            <span class="status-value warning">${i18n('waitingForToken') || 'Waiting for token...'}</span>
          </div>
        </div>

        <div class="help">
          <p>
            <strong>${i18n('autoTokenTitle') || 'Auto Token Capture'}</strong><br><br>
            ${i18n('autoTokenMessage') || 'Token will be automatically captured when you use ChatGPT. Just refresh the ChatGPT page or send a message.'}
          </p>
          <p style="margin-top: 8px; color: #6b7280;">
            ${i18n('manualTokenHint') || 'Or you can manually configure the token below.'}
          </p>
        </div>

        <div class="actions">
          <button class="secondary" id="setup-btn">
            ${i18n('manualSetupBtn') || 'Manual Setup'}
          </button>
        </div>
      `;

      // 折叠设置面板（即使没有 token 也显示）
      statusHtml += createCollapseSettingsHTML();
      // Side panel UI zoom (always available)
      statusHtml += createSidepanelZoomSettingsHTML();
      // Debug log toggle (always available)
      statusHtml += createDebugLogSettingsHTML();

      container.innerHTML = statusHtml;

      document.getElementById('setup-btn').addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('src/setup/index.html') });
      });

      // 绑定折叠设置事件
      bindCollapseSettingsEvents();

      // 绑定侧边栏缩放事件
      bindSidepanelZoomSettingsEvents();

      // 绑定调试日志事件
      bindDebugLogSettingsEvents();

      return;
    }

    // Token 来源标签
    const sourceLabel = tokenSource === 'auto'
      ? (i18n('tokenSourceAuto') || '🤖 Auto')
      : (i18n('tokenSourceManual') || '✏️ Manual');

    // 状态区域
    statusHtml += `
      <div class="status">
        <div class="status-item">
          <span class="status-label">${i18n('authenticationLabel')}</span>
          <span class="status-value ${hasToken ? (tokenExpired ? 'warning' : 'success') : 'error'}">
            ${hasToken ? (tokenExpired ? i18n('tokenExpired') : i18n('authenticated')) : i18n('notConfigured')}
          </span>
        </div>
        <div class="status-item">
          <span class="status-label">${i18n('tokenSourceLabel') || 'Source'}</span>
          <span class="status-value">${sourceLabel}</span>
        </div>
      </div>
    `;

    // Token 信息
    const tokenPreview = result.accessToken.substring(0, 40) + '...';
    const tokenLength = result.accessToken.length;
    const timeDisplay = tokenAgeHours > 0
      ? i18n(tokenAgeHours > 1 ? 'hoursAgo' : 'hourAgo', tokenAgeHours.toString())
      : i18n(tokenAgeMinutes > 1 ? 'minutesAgo' : 'minuteAgo', tokenAgeMinutes.toString());

    statusHtml += `
      <div class="token-info">
        <h3>${i18n('tokenInfoTitle')}</h3>
        <div class="token-preview">${tokenPreview}</div>
        <div class="token-time">
          ${i18n('tokenLength', tokenLength.toString())}<br>
          ${i18n('tokenCaptured', timeDisplay)}
          ${tokenExpired ? `<br><strong style="color: #dc2626;">${i18n('tokenExpiredWarning')}</strong>` : ''}
        </div>
      </div>
    `;

    // 操作按钮
    statusHtml += `
      <div class="actions">
        <button class="primary" id="open-sidepanel-btn" style="flex: 1;">
           ${i18n('openGraphBtn') || 'Open Graph View'}
        </button>
      </div>
      <div class="actions">
        <button class="secondary" id="toggle-floating-btn" style="flex: 1;">
           ${i18n('openFloatingBtn') || 'Floating Window'}
        </button>
      </div>
      <div class="actions">
        <button class="secondary" id="update-btn">
          ${i18n('manualSetupBtn') || 'Manual Setup'}
        </button>
        <button class="secondary" id="clear-btn">
          ${i18n('clearTokenBtn')}
        </button>
      </div>
    `;

    // 帮助信息
    if (tokenExpired) {
      statusHtml += `
        <div class="help">
          <p>${i18n('tokenExpiredAutoHelp') || 'Token expired. It will be auto-renewed when you use ChatGPT, or you can refresh the page.'}</p>
        </div>
      `;
    } else if (tokenSource === 'auto') {
      statusHtml += `
        <div class="help">
          <p>${i18n('autoTokenReadyHelp') || 'Token was automatically captured. It will be auto-renewed when needed.'}</p>
        </div>
      `;
    } else {
      statusHtml += `
        <div class="help">
          <p>${i18n('readyHelp')}</p>
        </div>
      `;
    }

    // 折叠设置面板
    statusHtml += createCollapseSettingsHTML();
    // Side panel UI zoom
    statusHtml += createSidepanelZoomSettingsHTML();
    // Debug log toggle
    statusHtml += createDebugLogSettingsHTML();

    container.innerHTML = statusHtml;

    // 绑定折叠设置事件
    bindCollapseSettingsEvents();

    // 绑定侧边栏缩放事件
    bindSidepanelZoomSettingsEvents();

    // 绑定调试日志事件
    bindDebugLogSettingsEvents();

    // 绑定事件
    const openSidePanelBtn = document.getElementById('open-sidepanel-btn');
    const toggleFloatingBtn = document.getElementById('toggle-floating-btn');
    const updateBtn = document.getElementById('update-btn');
    const clearBtn = document.getElementById('clear-btn');

    if (openSidePanelBtn) {
      openSidePanelBtn.addEventListener('click', async () => {
        try {
          // 获取当前标签页
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab) {
            // 打开侧边栏
            await chrome.sidePanel.open({ tabId: tab.id });
            // 关闭 popup
            window.close();
          }
        } catch (error) {
          console.error('Failed to open side panel:', error);
          alert('Failed to open side panel: ' + error.message);
        }
      });
    }

    if (toggleFloatingBtn) {
      toggleFloatingBtn.addEventListener('click', async () => {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) return;
          await chrome.tabs.sendMessage(tab.id, { type: MESSAGE_TYPES.TOGGLE_FLOATING_PANEL });
          window.close();
        } catch (error) {
          console.error('Failed to toggle floating panel:', error);
          alert('Failed to toggle floating window. Please open ChatGPT first.');
        }
      });
    }

    if (updateBtn) {
      updateBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('src/setup/index.html') });
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (confirm(i18n('confirmClearToken'))) {
          // 通过 background 清除 token（同时清除内存缓存，确保自动捕获能重新工作）
          try {
            await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CLEAR_TOKEN });
          } catch (e) {
            // 兜底：直接清 storage
            await chrome.storage.local.remove(['accessToken', 'tokenTimestamp', 'tokenSource', 'tokenInfo']);
          }
          loadStatusContent();
        }
      });
    }

  } catch (error) {
    console.error('Failed to load status:', error);
    container.innerHTML = `
      <div class="status">
        <div class="status-item">
          <span class="status-label">${i18n('errorLabel')}</span>
          <span class="status-value error">${i18n('errorLoadFailed')}</span>
        </div>
      </div>
      <div class="help">
        <p><strong>${i18n('errorLabel')}:</strong> ${error.message}</p>
      </div>
    `;
  }
}

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', loadStatus);
