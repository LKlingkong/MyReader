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
      ping: function () {
        return 'pong';
      },
      openFile: function () {
        console.log('[Preload] openFile() invoked');
        return ipcRenderer.invoke('dialog:openFile');
      },
      onFileOpened: function (callback) {
        console.log('[Preload] onFileOpened() registered');
        var handler = function (_event, fileData) {
          callback(fileData);
        };
        ipcRenderer.on('file:opened', handler);
        return function () {
          ipcRenderer.removeListener('file:opened', handler);
        };
      },
      onAppCleanup: function (callback) {
        console.log('[Preload] onAppCleanup() registered');
        var handler = function () { callback(); };
        ipcRenderer.on('app:cleanup', handler);
        return function () {
          ipcRenderer.removeListener('app:cleanup', handler);
        };
      },
      removeAllFileListeners: function () {
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
