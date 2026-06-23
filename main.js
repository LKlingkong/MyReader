const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const mammoth = require('mammoth');
const MarkdownIt = require('markdown-it');

// ---- Node.js 环境 Polyfill（pdfjs-dist 需要浏览器 API） ----

// DOMMatrix polyfill
if (!globalThis.DOMMatrix) {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor(init) {
      if (init && Array.isArray(init)) {
        this.a = init[0] || 1; this.b = init[1] || 0;
        this.c = init[2] || 0; this.d = init[3] || 1;
        this.e = init[4] || 0; this.f = init[5] || 0;
      } else {
        this.a = 1; this.b = 0;
        this.c = 0; this.d = 1;
        this.e = 0; this.f = 0;
      }
      this.m11 = this.a; this.m12 = this.b;
      this.m21 = this.c; this.m22 = this.d;
      this.m41 = this.e; this.m42 = this.f;
    }

    get isIdentity() {
      return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
    }

    transformPoint() { return { x: 0, y: 0 }; }
    static fromMatrix() { return new DOMMatrix(); }
    static fromFloat32Array() { return new DOMMatrix(); }
  };
}

// Path2D polyfill
if (!globalThis.Path2D) {
  globalThis.Path2D = class Path2D {
    addPath() {}
    arc() {}
    arcTo() {}
    bezierCurveTo() {}
    closePath() {}
    ellipse() {}
    lineTo() {}
    moveTo() {}
    quadraticCurveTo() {}
    rect() {}
    roundRect() {}
  };
}

// ImageData polyfill
if (!globalThis.ImageData) {
  globalThis.ImageData = class ImageData {
    constructor(width, height) {
      this.width = width || 1;
      this.height = height || 1;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
      this.colorSpace = 'srgb';
    }
  };
}

// pdfjs-dist 是 ESM-only 模块，通过动态 import 延迟加载
// 使用 legacy 构建以获得更好的 Node.js 兼容性
let pdfjsLib = null;

async function getPdfjsLib() {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // 禁用 worker，在主线程运行
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    // 关闭字体渲染（仅提取文本）
    pdfjsLib.GlobalWorkerOptions.workerPort = null;
  }
  return pdfjsLib;
}

// 初始化 markdown-it 实例（启用 heading ID 用于 TOC 锚点）
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true
});

let mainWindow = null;
let currentFileName = null;

const APP_NAME = 'TextReader';
const APP_SUBTITLE = '文档朗读器';
const SUPPORTED_EXTENSIONS = ['.docx', '.md', '.pdf'];

function buildWindowTitle(fileName) {
  return fileName ? `${APP_NAME} - ${fileName}` : `${APP_NAME} - ${APP_SUBTITLE}`;
}

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  console.log('[Main] Creating window with preload:', preloadPath);
  console.log('[Main] __dirname:', __dirname);
  console.log('[Main] preload.js exists:', fs.existsSync(preloadPath));

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    },
    title: buildWindowTitle(),
    icon: path.join(__dirname, 'icon.png')
  });

  mainWindow.loadFile('index.html');

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Main] Page loaded, checking electronAPI...');
    mainWindow.webContents.executeJavaScript(
      'JSON.stringify({ hasAPI: !!window.electronAPI, type: typeof window.electronAPI, keys: window.electronAPI ? Object.keys(window.electronAPI) : "N/A" })'
    ).then(result => {
      console.log('[Main] Renderer electronAPI status:', result);
    }).catch(err => {
      console.error('[Main] Renderer check failed:', err.message);
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    currentFileName = null;
  });
}

// 构建应用菜单
function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开...',
          accelerator: 'CmdOrCtrl+O',
          click: () => handleFileOpen()
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          role: 'quit'
        }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 TextReader',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于 TextReader',
              message: 'TextReader v1.1.0',
              detail: '一款支持 .docx / .md / .pdf 格式的桌面文档朗读器。\n\n基于 Electron 构建，支持章节目录导航与 Web Speech API 朗读。'
            });
          }
        }
      ]
    }
  ];

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about', label: '关于 TextReader' },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ---- 文件转换逻辑 ----

async function convertDocx(buffer) {
  const result = await mammoth.convertToHtml({ buffer });
  return {
    html: result.value,
    messages: result.messages
  };
}

function convertMarkdown(buffer) {
  const text = buffer.toString('utf-8');
  const html = md.render(text);
  return { html };
}

async function convertPdf(buffer) {
  const lib = await getPdfjsLib();
  const data = new Uint8Array(buffer);
  const pdf = await lib.getDocument({ data }).promise;
  const pages = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    // 按 y 坐标分组（同一行的文字），然后按 x 坐标排序
    const lines = {};
    for (const item of textContent.items) {
      const y = Math.round(item.transform[5]);
      if (!lines[y]) lines[y] = [];
      lines[y].push(item);
    }

    // 按 y 从大到小排序（PDF 坐标原点在左下）
    const sortedY = Object.keys(lines).sort((a, b) => b - a);

    let pageHtml = `<section class="pdf-page" data-page="${i}">`;
    if (pdf.numPages > 1) {
      pageHtml += `<div class="pdf-page-number">第 ${i} 页 / 共 ${pdf.numPages} 页</div>`;
    }

    for (const y of sortedY) {
      // 按 x 坐标排序同一行的文字
      lines[y].sort((a, b) => a.transform[4] - b.transform[4]);
      const lineText = lines[y].map(item => item.str).join(' ').trim();
      if (lineText) {
        // 检测是否是标题（全大写、较短、或单独成行的大字体）
        const isHeading = detectPdfHeading(lineText, lines[y]);
        if (isHeading) {
          pageHtml += `<h3>${escapeHtml(lineText)}</h3>`;
        } else {
          pageHtml += `<p>${escapeHtml(lineText)}</p>`;
        }
      }
    }

    pageHtml += '</section>';
    pages.push(pageHtml);
  }

  return { html: pages.join('\n') };
}

/**
 * 简单的 PDF 标题检测：较短行 + 字体可能较大
 */
function detectPdfHeading(text, items) {
  const len = text.length;
  // 太长的文本不太可能是标题
  if (len > 80) return false;
  // 单行短文本（可能是标题）
  if (len <= 50 && text.endsWith('.') === false && text.endsWith('。') === false) {
    // 检查字体大小（如果有的话）
    if (items.length > 0 && items[0].height > 12) return true;
    if (len <= 30) return true; // 短文本大概率是标题
  }
  return false;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- TOC 提取与 heading ID 注入 ----

/**
 * 从 HTML 中提取标题，构建目录树，同时给标题添加 id 属性
 */
function extractToc(html) {
  const toc = [];
  const stack = [{ level: 0, children: toc }];
  let idCounter = 0;

  // 匹配 h1-h6 标签，包括可能已有的属性
  const headingRegex = /<h([1-6])(\s[^>]*)?>([\s\S]*?)<\/h\1>/gi;

  const resultHtml = html.replace(headingRegex, (match, level, attrs, text) => {
    level = parseInt(level);
    idCounter++;
    const headingId = `heading-${idCounter}`;
    const plainText = text.replace(/<[^>]+>/g, '').trim();

    // 构建 TOC 树
    const item = { level, text: plainText, id: headingId, children: [] };

    // 弹出层级 >= 当前层级的节点
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    stack[stack.length - 1].children.push(item);
    stack.push(item);

    // 保留已有属性，添加/替换 id
    const existingAttrs = attrs ? attrs.trim() : '';
    const cleanAttrs = existingAttrs.replace(/\s*id\s*=\s*["'][^"']*["']/g, '');
    return `<h${level} id="${headingId}"${cleanAttrs ? ' ' + cleanAttrs : ''}>${text}</h${level}>`;
  });

  return { html: resultHtml, toc };
}

// ---- 文件打开与 IPC 发送 ----

async function handleFileOpen() {
  console.log('[Main] handleFileOpen() called, mainWindow:', mainWindow ? 'exists' : 'null');
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.focus();
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '打开文档',
      filters: [
        { name: '支持的文档', extensions: ['docx', 'md', 'pdf'] },
        { name: 'Word 文档', extensions: ['docx'] },
        { name: 'Markdown 文件', extensions: ['md'] },
        { name: 'PDF 文件', extensions: ['pdf'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (result.canceled) {
      console.log('[Main] File dialog cancelled by user');
      return;
    }
    if (result.filePaths.length === 0) {
      console.log('[Main] No file selected');
      return;
    }

    const filePath = result.filePaths[0];
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      mainWindow.webContents.send('file:opened', {
        filePath,
        fileName,
        extension: ext,
        size: 0,
        html: null,
        toc: null,
        error: `不支持的文件格式: "${ext}"。支持的格式: .docx, .md, .pdf`
      });
      return;
    }

    let fileBuffer;
    try {
      fileBuffer = await fs.promises.readFile(filePath);
    } catch (readError) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('file:opened', {
          filePath,
          fileName,
          extension: ext,
          size: 0,
          html: null,
          toc: null,
          error: `文件读取失败: ${readError.message}`
        });
      }
      return;
    }

    let html = null;
    let conversionError = null;

    try {
      if (ext === '.docx') {
        const docxResult = await convertDocx(fileBuffer);
        html = docxResult.html;
        if (docxResult.messages && docxResult.messages.length > 0) {
          console.log('[Main] mammoth conversion messages:', docxResult.messages);
        }
      } else if (ext === '.md') {
        const mdResult = convertMarkdown(fileBuffer);
        html = mdResult.html;
      } else if (ext === '.pdf') {
        const pdfResult = await convertPdf(fileBuffer);
        html = pdfResult.html;
      }
    } catch (convError) {
      conversionError = `转换失败: ${convError.message}`;
      console.error(`[Main] Conversion error for ${fileName}:`, convError);
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
      console.log('[Main] Window closed during file processing, aborting.');
      return;
    }

    // 提取目录结构并注入 heading id
    let toc = null;
    if (html && !conversionError) {
      const tocResult = extractToc(html);
      html = tocResult.html;
      toc = tocResult.toc;
      console.log(`[Main] TOC extracted: ${countTocItems(toc)} headings`);
    }

    currentFileName = fileName;
    mainWindow.setTitle(buildWindowTitle(fileName));

    mainWindow.webContents.send('file:opened', {
      filePath: filePath,
      fileName: fileName,
      extension: ext,
      size: fileBuffer.length,
      html: html,
      toc: toc,
      error: conversionError
    });

    console.log(
      `[Main] File processed: ${fileName} (${ext}, ${fileBuffer.length} bytes)` +
      (html ? `, HTML: ${html.length} chars` : '') +
      (conversionError ? `, ERROR: ${conversionError}` : '')
    );

  } catch (error) {
    console.error('[Main] handleFileOpen error:', error);
    dialog.showErrorBox(
      '意外错误',
      `发生意外错误:\n${error.message}`
    );
  }
}

function countTocItems(toc) {
  let count = 0;
  for (const item of toc) {
    count += 1 + countTocItems(item.children);
  }
  return count;
}

// 注册 IPC 处理器
function registerIpcHandlers() {
  ipcMain.handle('dialog:openFile', async () => {
    await handleFileOpen();
    return { success: true };
  });
}

function notifyRendererCleanup() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('app:cleanup');
    } catch (err) {
      console.warn('[Main] Failed to send cleanup notification:', err.message);
    }
  }
}

// ---- App 生命周期 ----

app.whenReady().then(() => {
  buildMenu();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  notifyRendererCleanup();
});
