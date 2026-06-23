const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const mammoth = require('mammoth');
const MarkdownIt = require('markdown-it');

// 初始化 markdown-it 实例
const md = new MarkdownIt({
  html: false,         // 安全：不传递原始 HTML，防止 XSS
  linkify: true,
  typographer: true,
  breaks: true
});

let mainWindow = null;
let currentFileName = null;   // 当前打开的文件名

const APP_NAME = 'TextReader';
const APP_SUBTITLE = '文档朗读器';

function buildWindowTitle(fileName) {
  return fileName ? `${APP_NAME} - ${fileName}` : `${APP_NAME} - ${APP_SUBTITLE}`;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    title: buildWindowTitle(),
    icon: path.join(__dirname, 'icon.png')
  });

  mainWindow.loadFile('index.html');

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
              message: 'TextReader v1.0.0',
              detail: '一款支持 .docx 和 .md 格式的桌面文档朗读器。\n\n基于 Electron 构建，使用 Web Speech API 实现划词朗读。'
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

// ---- 文件打开与 IPC 发送 ----

async function handleFileOpen() {
  console.log('[Main] handleFileOpen() called, mainWindow:', mainWindow ? 'exists' : 'null');
  try {
    // 确保窗口获得焦点（修复 Windows 上对话框可能隐藏在后台的问题）
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.focus();
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '打开文档',
      filters: [
        { name: '支持的文档', extensions: ['docx', 'md'] },
        { name: 'Word 文档', extensions: ['docx'] },
        { name: 'Markdown 文件', extensions: ['md'] },
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

    if (ext !== '.docx' && ext !== '.md') {
      mainWindow.webContents.send('file:opened', {
        filePath,
        fileName,
        extension: ext,
        size: 0,
        html: null,
        error: `不支持的文件格式: "${ext}"。支持的格式: .docx, .md`
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
      }
    } catch (convError) {
      conversionError = `转换失败: ${convError.message}`;
      console.error(`[Main] Conversion error for ${fileName}:`, convError);
    }

    // 防止 await 期间窗口被关闭导致 mainWindow 为 null
    if (!mainWindow || mainWindow.isDestroyed()) {
      console.log('[Main] Window closed during file processing, aborting.');
      return;
    }

    // 更新窗口标题
    currentFileName = fileName;
    mainWindow.setTitle(buildWindowTitle(fileName));

    // 通过 IPC 发送转换后的 HTML 到渲染进程
    mainWindow.webContents.send('file:opened', {
      filePath: filePath,
      fileName: fileName,
      extension: ext,
      size: fileBuffer.length,
      html: html,
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

// 注册 IPC 处理器
function registerIpcHandlers() {
  ipcMain.handle('dialog:openFile', async () => {
    await handleFileOpen();
    return { success: true };
  });
}

/**
 * 通知渲染进程清理资源（停止朗读等）
 */
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
