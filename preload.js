const { contextBridge, ipcRenderer } = require('electron');

console.log('[Preload] Script loaded, exposing electronAPI...');

/**
 * 通过 contextBridge 安全地向渲染进程暴露 API。
 * 渲染进程通过 window.electronAPI 访问这些方法。
 */
try {
  contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * 监听主进程发来的文件打开事件。
     * 主进程已完成文件读取和格式转换，直接将 HTML 发送过来。
     *
     * @param {Function} callback - 回调函数，参数为文件数据对象：
     *   - filePath:  string   文件绝对路径
     *   - fileName:  string   文件名（含扩展名）
     *   - extension: string   扩展名（如 ".docx"、".md"）
     *   - size:      number   文件大小（字节）
     *   - html:      string|null  转换后的 HTML 字符串；转换失败时为 null
     *   - error:     string|null  错误信息；成功时为 null
     */
    onFileOpened: (callback) => {
      if (typeof callback !== 'function') {
        throw new TypeError('onFileOpened: callback must be a function');
      }
      const handler = (_event, fileData) => callback(fileData);
      ipcRenderer.on('file:opened', handler);

      return () => {
        ipcRenderer.removeListener('file:opened', handler);
      };
    },

    /**
     * 请求主进程打开文件选择对话框
     * @returns {Promise<void>} 文件打开完成后 resolve
     */
    openFile: () => {
      return ipcRenderer.invoke('dialog:openFile');
    },

    /**
     * 监听主进程发来的应用清理指令（关闭前清理 speechSynthesis）
     * @param {Function} callback - 回调函数
     * @returns {Function} 取消监听的清理函数
     */
    onAppCleanup: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('app:cleanup', handler);
      return () => {
        ipcRenderer.removeListener('app:cleanup', handler);
      };
    },

    /**
     * 移除文件打开事件的所有监听器
     */
    removeAllFileListeners: () => {
      ipcRenderer.removeAllListeners('file:opened');
    }
  });
  console.log('[Preload] electronAPI exposed successfully via contextBridge');
} catch (err) {
  console.error('[Preload] Failed to expose electronAPI:', err);
  // 即使暴露失败，也不抛出异常，让页面可以正常加载并显示错误信息
}
