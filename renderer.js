/**
 * TextReader - 渲染进程脚本
 * 支持 .docx / .md / .pdf 格式，章节目录导航，Web Speech API 朗读。
 */

// ---- DOM 引用 ----

const btnOpen        = document.getElementById('btnOpen');
const btnStop        = document.getElementById('btnStop');
const btnToc         = document.getElementById('btnToc');
const fileInfo       = document.getElementById('fileInfo');
const contentEl      = document.getElementById('content');
const sidebar        = document.getElementById('sidebar');
const tocTree        = document.getElementById('tocTree');
const tocCount       = document.getElementById('tocCount');
const statusFile     = document.getElementById('statusFile');
const statusSize     = document.getElementById('statusSize');
const ttsToggle      = document.getElementById('ttsToggle');
const ttsLabel       = document.getElementById('ttsLabel');
const ttsUnsupported = document.getElementById('ttsUnsupported');
const ttsIndicator   = document.getElementById('ttsIndicator');

// ---- 目录功能状态 ----

let tocData = null;           // 当前文档的目录数据
let sidebarOpen = false;      // 侧边栏是否打开
let activeHeadingId = null;   // 当前高亮的标题
let tocScrollTimer = null;    // 防抖定时器

// ---- 朗读功能状态 ----

let ttsEnabled = false;
let isSpeaking = false;
let activeUtterance = null;
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
  closeSidebar();
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

// ---- 目录侧边栏功能 ----

function openSidebar() {
  sidebar.classList.add('open');
  sidebarOpen = true;
  btnToc.classList.add('active');
}

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOpen = false;
  btnToc.classList.remove('active');
  // 注意: 不在这里清除 tocData，以便用户可以重新打开侧边栏
}

function toggleSidebar() {
  if (sidebarOpen) {
    closeSidebar();
  } else if (tocData && tocData.length > 0) {
    openSidebar();
  }
}

function buildTocTree(items, container) {
  container.innerHTML = '';
  for (const item of items) {
    const el = document.createElement('button');
    el.className = `toc-item toc-level-${item.level}`;
    el.textContent = item.text;
    el.title = item.text;
    el.addEventListener('click', () => {
      scrollToHeading(item.id);
    });
    el.setAttribute('data-heading-id', item.id);
    container.appendChild(el);

    if (item.children && item.children.length > 0) {
      buildTocTree(item.children, container);
    }
  }
}

function scrollToHeading(id) {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // 临时高亮
    setActiveTocItem(id);
  }
}

function setActiveTocItem(id) {
  // 清除所有 active
  const allItems = tocTree.querySelectorAll('.toc-item');
  allItems.forEach(item => item.classList.remove('active'));

  // 设置新的 active
  const activeItem = tocTree.querySelector(`[data-heading-id="${id}"]`);
  if (activeItem) {
    activeItem.classList.add('active');
    // 滚动到可见
    activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  activeHeadingId = id;
}

function updateTocScrolling() {
  if (!tocData || tocData.length === 0) return;

  // 防抖
  if (tocScrollTimer) clearTimeout(tocScrollTimer);
  tocScrollTimer = setTimeout(() => {
    // 查找当前可视区域内的标题
    const headings = contentEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
    let currentId = null;

    for (const heading of headings) {
      const rect = heading.getBoundingClientRect();
      // 标题在可视区域内（顶部以上 80px 到中间）
      if (rect.top <= 120) {
        currentId = heading.id;
      } else {
        break; // 后续的标题都在下方，不需要继续
      }
    }

    if (currentId && currentId !== activeHeadingId) {
      setActiveTocItem(currentId);
    }
  }, 100);
}

function renderToc(toc) {
  tocData = toc;
  if (!toc || toc.length === 0) {
    btnToc.classList.remove('visible');
    closeSidebar();
    return;
  }

  // 显示目录按钮
  btnToc.classList.add('visible');

  // 构建目录树
  buildTocTree(toc, tocTree);

  // 更新标题数量
  const count = countTocItems(toc);
  tocCount.textContent = `(${count} 项)`;

  // 默认打开侧边栏
  openSidebar();
}

function countTocItems(items) {
  let count = 0;
  for (const item of items) {
    count += 1 + countTocItems(item.children);
  }
  return count;
}

// 目录按钮事件
btnToc.addEventListener('click', toggleSidebar);

// 内容区滚动监听（scroll-spy）
contentEl.addEventListener('scroll', updateTocScrolling);

// ---- 安全调用 electronAPI ----

function isElectronAPIAvailable() {
  return !!(window.electronAPI && typeof window.electronAPI.openFile === 'function');
}

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
      result.then(() => {}, (err) => {
        console.error('[Renderer] openFile IPC failed:', err);
        showError('无法打开文件', `IPC 调用失败: ${err.message || err}`);
      });
    }
  } catch (err) {
    console.error('[Renderer] openFile threw synchronously:', err);
    showError('调用失败', `调用 openFile 时发生异常: ${err.message || err}`);
  }
}

// ---- 全局键盘快捷键 ----

document.addEventListener('keydown', (e) => {
  // Escape: 停止朗读
  if (e.key === 'Escape' && isSpeaking) {
    e.preventDefault();
    stopSpeaking();
    return;
  }
  // Ctrl/Cmd+O: 打开文件
  if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
    e.preventDefault();
    console.log('[Renderer] Ctrl+O pressed');
    safeOpenFile();
    return;
  }
  // Ctrl/Cmd+B: 切换目录侧边栏
  if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
    e.preventDefault();
    toggleSidebar();
  }
});

// ---- 朗读文本 ----

function speakText(text) {
  if (!text || !ttsSupported) return;

  window.speechSynthesis.cancel();

  const lang = detectLanguage(text);

  const utterance = new SpeechSynthesisUtterance(text);
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
    if (activeUtterance !== utterance) return;
    isSpeaking = false;
    setStopButtonVisible(false);
    ttsIndicator.textContent = ttsEnabled ? '🔊 朗读已开启' : '';
    activeUtterance = null;
    console.log('[TTS] Finished');
  };

  utterance.onerror = (event) => {
    if (activeUtterance !== utterance) return;
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

// ---- 错误模板 ----

const errorTemplates = {
  unsupported: (ext) => `
    <div class="placeholder">
      <div class="placeholder-icon">⚠️</div>
      <h2>不支持的文件格式</h2>
      <p>文件扩展名 <code>${escapeHtml(ext)}</code> 不受支持。</p>
      <p>支持的格式: <strong>.docx</strong>, <strong>.md</strong>, <strong>.pdf</strong></p>
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
  // 关闭旧目录并清空数据
  closeSidebar();
  tocData = null;
  btnToc.classList.remove('visible');

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

    // 渲染目录
    if (fileData.toc && fileData.toc.length > 0) {
      renderToc(fileData.toc);
    }
  } else {
    contentEl.innerHTML = errorTemplates.conversionFailed('No content was generated.');
  }
}

// ---- 应用清理 ----

let _cleanedUp = false;

window.addEventListener('beforeunload', () => {
  if (_cleanedUp) return;
  _cleanedUp = true;
  cleanupSpeech();
});

if (window.electronAPI && typeof window.electronAPI.onAppCleanup === 'function') {
  window.electronAPI.onAppCleanup(() => {
    if (_cleanedUp) return;
    _cleanedUp = true;
    cleanupSpeech();
  });
}

// ---- 事件绑定 ----

if (window.electronAPI && typeof window.electronAPI.onFileOpened === 'function') {
  const unsubscribeFile = window.electronAPI.onFileOpened((fileData) => {
    console.log(`[Renderer] file:opened — "${fileData.fileName}" (${fileData.extension})`);
    if (fileData.toc) {
      console.log(`[Renderer] TOC: ${fileData.toc.length} top-level headings`);
    }
    updateUI(fileData);
  });

  window.addEventListener('beforeunload', () => {
    if (unsubscribeFile) unsubscribeFile();
  });
} else {
  console.error('[Renderer] window.electronAPI.onFileOpened is not available — preload may have failed');
}

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
