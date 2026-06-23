# TextReader - 文档朗读器

基于 Electron 构建的桌面文档阅读与朗读工具，支持 **.docx** 和 **.md** 格式，集成 Web Speech API 实现中英文混合划词朗读。

## 功能特性

- 📄 **多格式支持** — 打开并渲染 `.docx`（Word 文档）和 `.md`（Markdown）文件
- 🎨 **精美排版** — 富文本样式渲染，支持标题、列表、引用、代码块、表格等
- 🔊 **划词朗读** — 选中文字自动朗读，基于浏览器内置 Web Speech API
- 🌐 **中英文智能检测** — 自动根据选中文本的英文字母占比切换 `en-US` / `zh-CN`，发音自然
- 🎛️ **一键控制** — 工具栏滑动开关 + 停止按钮 + Esc 快捷键，随时控制朗读

## 技术栈

| 层 | 技术 |
|----|------|
| 框架 | Electron |
| .docx 解析 | mammoth |
| .md 解析 | markdown-it |
| 朗读 | Web Speech API (SpeechSynthesis) |
| 打包 | electron-builder |

## 项目结构

```
wordreader/
├── main.js            # 主进程 — 窗口管理、菜单、文件读取、格式转换
├── preload.js         # 预加载脚本 — contextBridge IPC 桥梁
├── index.html         # 界面 — 工具栏、内容区、状态栏
├── renderer.js        # 渲染进程 — UI 交互、TTS 朗读逻辑
├── icon.png           # 应用图标 (256×256)
├── package.json       # 项目配置 + 打包配置
├── scripts/
│   └── generate-icon.js  # 图标生成脚本
└── README.md
```

## 开发环境要求

- [Node.js](https://nodejs.org/) >= 18
- npm >= 9
- Windows / macOS / Linux

## 快速开始

```bash
# 1. 克隆 / 进入项目目录
cd wordreader

# 2. 安装依赖
npm install

# 3. 启动开发模式
npm start
```

## 打包分发

```bash
# 打包当前系统平台
npm run build

# 仅打包 Windows（NSIS 安装包）
npm run build:win

# 仅打包 macOS（DMG）
npm run build:mac

# 仅打包 Linux（AppImage + deb）
npm run build:linux
```

打包输出位于 `release/` 目录：

| 平台 | 产物 |
|------|------|
| Windows | `release/TextReader Setup x.x.x.exe`（NSIS 安装包） |
| macOS | `release/TextReader-x.x.x.dmg` |
| Linux | `release/TextReader-x.x.x.AppImage` + `.deb` |

## 使用说明

1. 启动应用后，按 **Ctrl+O** 或点击 **📂 Open** 按钮打开文档
2. 支持的格式：`.docx`、`.md`
3. 点击工具栏右侧 **朗读开关** 启用划词朗读
4. 在内容区鼠标划选文字，松开即自动朗读
5. 点击 **⏹ 停止** 或按 **Esc** 中断朗读
6. 状态栏实时显示朗读状态和语言检测结果

## 菜单快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+O` / `Cmd+O` | 打开文件 |
| `Ctrl+Shift+I` / `Cmd+Option+I` | 开发者工具 |
| `Ctrl+0` / `Cmd+0` | 重置缩放 |
| `F11` / `Cmd+Ctrl+F` | 全屏 |
| `Esc` | 停止朗读（朗读中） |

## License

ISC
