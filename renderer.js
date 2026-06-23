/**
 * TextReader - 渲染进程脚本
 * 接收主进程完成转换后的 HTML，渲染到内容展示区。
 * 支持划选文字后通过 Web Speech API 朗读，自动检测中英文。
 */

// ---- DOM 引用 ----

const btnOpen        = document.getElementById('btnOpen');
const btnStop        = document.getElementById('btnStop');
const fileInfo       = document.getElementById('fileInfo');
const contentEl      = document.getElementById('content');
const statusFile     = document.getElementById('statusFile');
const statusSize     = document.getElementById('statusSize');
const ttsToggle      = document.getElementById('ttsToggle');
const ttsLabel       = document.getElementById('ttsLabel');
const ttsUnsupported = document.getElementById('ttsUnsupported');
const ttsIndicator   = document.getElementById('ttsIndicator');

// ---- 朗读功能状态 ----

let ttsEnabled = false;
let isSpeaking = false;
let activeUtterance = null;   // 防止 GC 回收，跟踪当前朗读
const ttsSupported = 'speechSynthesis' in window;

// ---- 工具函数 ----

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- 语言检测 ----

function detectLanguage(text) {
  const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
  const totalChars = text.length;

  if (totalChars === 0) return 'zh-CN';

  const ratio = englishChars / totalChars;
  const lang = ratio > 0.5 ? 'en-US' : 'zh-CN';

  console.log(`[TTS] Language detect: ${englishChars}/${totalChars} English (${(ratio * 100).toFixed(0)}%) → ${lang}`);
  return lang;
}

// ---- 朗读功能 ----

function setStopButtonVisible(visible) {
  btnStop.classList.toggle('visible', visible);
}

function stopSpeaking() {
  if (!ttsSupported) return;
  window.speechSynthesis.cancel();
}

/**
 * 彻底清理语音资源
 */
function cleanupSpeech() {
  if (!ttsSupported) return;
  window.speechSynthesis.cancel();
  activeUtterance = null;
  isSpeaking = false;
  setStopButtonVisible(false);
  ttsIndicator.textContent = '';
  console.log('[TTS] Cleanup complete');
}

function initTTS() {
  if (!ttsSupported) {
    ttsToggle.disabled = true;
    ttsToggle.checked = false;
    ttsLabel.textContent = '朗读 关';
    ttsUnsupported.classList.add('visible');
    console.warn('[TTS] SpeechSynthesis not supported in this environment');
    return;
  }

  ttsToggle.addEventListener('change', () => {
    ttsEnabled = ttsToggle.checked;
    ttsLabel.textContent = ttsEnabled ? '朗读 开' : '朗读 关';
    ttsIndicator.textContent = ttsEnabled ? '🔊 朗读已开启' : '';

    if (!ttsEnabled) {
      window.speechSynthesis.cancel();
      setStopButtonVisible(false);
      isSpeaking = false;
    }

    console.log(`[TTS] ${ttsEnabled ? 'enabled' : 'disabled'}`);
  });

  btnStop.addEventListener('click', () => {
    stopSpeaking();
  });
}

// ---- 错误显示 ----

function showError(title, msg) {
  contentEl.innerHTML = `
    <div class="placeholder">
      <div class="placeholder-icon">⚠️</div>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(msg)}</p>
    </div>`;
  statusFile.textContent = 'Error';
  statusSize.textContent = '';
}

/**
 * 安全地调用 electronAPI.openFile()，处理各种边界情况
 */
function safeOpenFile() {
  if (!isElectronAPIAvailable()) {
    console.error('[Renderer] window.electronAPI.openFile is not available');
    showError('API 未就绪',
      'window.electronAPI 不可用。<br><br>可能原因：<br>1. preload.js 加载失败<br>2. contextBridge 未正确暴露 API<br><br>请打开开发者工具 (Ctrl+Shift+I) 查看控制台错误。');
    return;
  }

  try {
    const result = window.electronAPI.openFile();
    if (result && typeof result.catch === 'function') {
      result.catch((err) => {
        console.error('[Renderer] openFile IPC failed:', err);
        showError('无法打开文件', `IPC 调用失败: ${err.message || err}`);
      });
    } else if (result && typeof result.then === 'function') {
      // 有 then 但没有 catch（不太可能，但做防御处理）
      result.then(() => {}, (err) => {
        console.error('[Renderer] openFile IPC failed:', err);
        showError('无法打开文件', `IPC 调用失败: ${err.message || err}`);
      });
    }
    // 如果 openFile() 返回的不是 Promise（比如 undefined），只记录日志
    // 文件对话框由主进程直接打开，不需要等待返回结果
  } catch (err) {
    console.error('[Renderer] openFile threw synchronously:', err);
    showError('调用失败', `调用 openFile 时发生异常: ${err.message || err}`);
  }
}

// ---- 全局键盘快捷键（独立于 TTS） ----

document.addEventListener('keydown', (e) => {
  // Escape: 停止朗读
  if (e.key === 'Escape' && isSpeaking) {
    e.preventDefault();
    stopSpeaking();
    return;
  }
  // Ctrl/Cmd+O: 打开文件
  // 注意：Electron 菜单 accelerator 会优先拦截此组合键，这里的 handler 作为后备
  if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
    e.preventDefault();
    console.log('[Renderer] Ctrl+O pressed');
    safeOpenFile();
  }
});

function speakText(text) {
  if (!text || !ttsSupported) return;

  window.speechSynthesis.cancel();

  const lang = detectLanguage(text);

  const utterance = new SpeechSynthesisUtterance(text);
  // 保存到模块级变量，防止 GC 回收导致朗读中断
  activeUtterance = utterance;
  utterance.lang = lang;
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  utterance.onstart = () => {
    isSpeaking = true;
    setStopButtonVisible(true);
    ttsIndicator.textContent = `🔊 正在朗读 (${lang})...`;
    console.log(`[TTS] Speaking ${text.length} chars [${lang}]: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
  };

  utterance.onend = () => {
    if (activeUtterance !== utterance) return; // 忽略旧 utterance 的事件
    isSpeaking = false;
    setStopButtonVisible(false);
    ttsIndicator.textContent = ttsEnabled ? '🔊 朗读已开启' : '';
    activeUtterance = null;
    console.log('[TTS] Finished');
  };

  utterance.onerror = (event) => {
    if (activeUtterance !== utterance) return; // 忽略旧 utterance 的事件
    if (event.error === 'canceled') {
      console.log('[TTS] Cancelled');
    } else {
      console.error('[TTS] Speech error:', event.error);
      ttsIndicator.textContent = '⚠ 朗读出错';
    }
    isSpeaking = false;
    setStopButtonVisible(false);
    activeUtterance = null;
  };

  // 延迟 speak 以确保 cancel 完成（Chromium 中 cancel 是异步的）
  setTimeout(() => {
    window.speechSynthesis.speak(utterance);
  }, 0);
}

function handleTextSelection() {
  if (!ttsEnabled) return;

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;

  const text = selection.toString().trim();

  if (!text) return;

  speakText(text);
}

// ---- 错误 / 空状态渲染 ----

const errorTemplates = {
  unsupported: (ext) => `
    <div class="placeholder">
      <div class="placeholder-icon">⚠️</div>
      <h2>不支持的文件格式</h2>
      <p>文件扩展名 <code>${escapeHtml(ext)}</code> 不受支持。</p>
      <p>支持的格式: <strong>.docx</strong>, <strong>.md</strong></p>
    </div>`,

  conversionFailed: (msg) => `
    <div class="placeholder">
      <div class="placeholder-icon">❌</div>
      <h2>转换失败</h2>
      <p>${escapeHtml(msg)}</p>
    </div>`,

  readFailed: (msg) => `
    <div class="placeholder">
      <div class="placeholder-icon">📁</div>
      <h2>文件读取错误</h2>
      <p>${escapeHtml(msg)}</p>
    </div>`
};

// ---- 主渲染逻辑 ----

function updateUI(fileData) {
  fileInfo.style.display = 'block';
  const statusLabel = fileData.error ? '⚠️' : '✅';
  fileInfo.innerHTML = `${statusLabel} <strong>${escapeHtml(fileData.fileName)}</strong> &nbsp;|&nbsp; ${fileData.extension} &nbsp;|&nbsp; ${formatSize(fileData.size)}`;

  statusFile.textContent = fileData.fileName;
  statusSize.textContent = formatSize(fileData.size);

  if (fileData.error) {
    let errorHtml;
    if (fileData.error.startsWith('Unsupported file format') || fileData.error.startsWith('不支持的文件格式')) {
      errorHtml = errorTemplates.unsupported(fileData.extension);
    } else if (fileData.error.startsWith('Failed to read file') || fileData.error.startsWith('文件读取失败')) {
      errorHtml = errorTemplates.readFailed(fileData.error);
    } else {
      errorHtml = errorTemplates.conversionFailed(fileData.error);
    }
    contentEl.innerHTML = errorHtml;
    console.warn(`[Renderer] Error for ${fileData.fileName}: ${fileData.error}`);
    return;
  }

  if (fileData.html) {
    contentEl.innerHTML = fileData.html;
    console.log(`[Renderer] Rendered "${fileData.fileName}" — ${fileData.html.length} chars of HTML`);
  } else {
    contentEl.innerHTML = errorTemplates.conversionFailed('No content was generated.');
  }
}

// ---- 应用清理 ----

let _cleanedUp = false;

/**
 * 窗口关闭前清理 speechSynthesis，防止后台继续朗读
 */
window.addEventListener('beforeunload', () => {
  if (_cleanedUp) return;
  _cleanedUp = true;
  cleanupSpeech();
});

// 监听主进程发来的清理指令（仅当 electronAPI 可用时）
if (window.electronAPI && typeof window.electronAPI.onAppCleanup === 'function') {
  window.electronAPI.onAppCleanup(() => {
    if (_cleanedUp) return;
    _cleanedUp = true;
    cleanupSpeech();
  });
}

// ---- 事件绑定 ----

// ---- 检查 electronAPI 是否可用 ----

function isElectronAPIAvailable() {
  return !!(window.electronAPI && typeof window.electronAPI.openFile === 'function');
}

if (window.electronAPI && typeof window.electronAPI.onFileOpened === 'function') {
  const unsubscribeFile = window.electronAPI.onFileOpened((fileData) => {
    console.log(`[Renderer] file:opened — "${fileData.fileName}" (${fileData.extension})`);
    updateUI(fileData);
  });

  // 窗口关闭前取消监听
  window.addEventListener('beforeunload', () => {
    if (unsubscribeFile) unsubscribeFile();
  });
} else {
  console.error('[Renderer] window.electronAPI.onFileOpened is not available — preload may have failed');
}

// Open 按钮 — 无论 electronAPI 是否就绪都注册点击事件
btnOpen.addEventListener('click', () => {
  console.log('[Renderer] Open button clicked');
  safeOpenFile();
});

contentEl.addEventListener('mouseup', handleTextSelection);

// ---- 初始化 ----

initTTS();
console.log('[Renderer] TextReader initialized — waiting for file...');
console.log(`[Renderer] TTS supported: ${ttsSupported}`);
console.log(`[Renderer] electronAPI available: ${!!window.electronAPI}`);
if (window.electronAPI) {
  console.log('[Renderer] electronAPI keys:', Object.keys(window.electronAPI));
  console.log('[Renderer] electronAPI.openFile:', typeof window.electronAPI.openFile);
  console.log('[Renderer] electronAPI.onFileOpened:', typeof window.electronAPI.onFileOpened);
  if (typeof window.electronAPI.ping === 'function') {
    console.log('[Renderer] electronAPI.ping():', window.electronAPI.ping());
  }
} else {
  console.error('[Renderer] window.electronAPI is undefined — the preload did not expose any API');
  console.error('[Renderer] This means the preload script failed to load or execute.');
}
