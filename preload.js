// [Preload] 第一行执行 — 验证 preload 脚本是否被加载
console.log('[Preload] === PRELOAD START ===');

(function () {
  'use strict';
  try {
    console.log('[Preload] require("electron")...');
    const electron = require('electron');
    console.log('[Preload] electron keys:', Object.keys(electron));

    const { contextBridge, ipcRenderer } = electron;
    console.log('[Preload] contextBridge:', typeof contextBridge);
    console.log('[Preload] ipcRenderer:', typeof ipcRenderer);

    console.log('[Preload] Calling exposeInMainWorld...');
    contextBridge.exposeInMainWorld('electronAPI', {
      // 简单测试方法
      ping: () => 'pong',

      // 请求主进程打开文件选择对话框
      openFile: () => {
        console.log('[Preload] openFile() invoked');
        return ipcRenderer.invoke('dialog:openFile');
      },

      // 监听文件打开事件
      onFileOpened: (callback) => {
        console.log('[Preload] onFileOpened() registered');
        const handler = (_event, fileData) => callback(fileData);
        ipcRenderer.on('file:opened', handler);
        return () => {
          ipcRenderer.removeListener('file:opened', handler);
        };
      },

      // 监听应用清理指令
      onAppCleanup: (callback) => {
        console.log('[Preload] onAppCleanup() registered');
        const handler = () => callback();
        ipcRenderer.on('app:cleanup', handler);
        return () => {
          ipcRenderer.removeListener('app:cleanup', handler);
        };
      },

      // 移除文件监听
      removeAllFileListeners: () => {
        console.log('[Preload] removeAllFileListeners() called');
        ipcRenderer.removeAllListeners('file:opened');
      }
    });

    console.log('[Preload] === PRELOAD SUCCESS ===');
  } catch (err) {
    console.error('[Preload] === PRELOAD ERROR ===');
    console.error('[Preload]', err.message);
    console.error('[Preload]', err.stack);
  }
})();
