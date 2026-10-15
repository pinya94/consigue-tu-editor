// Puente entre la interfaz y el proceso principal.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

function on(channel) {
  return (cb) => {
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  };
}

contextBridge.exposeInMainWorld('editor', {
  info: () => ipcRenderer.invoke('app:info'),
  openProject: (dir) => ipcRenderer.invoke('project:open', dir),
  newProject: (opts) => ipcRenderer.invoke('project:new', opts),
  saveProject: (p) => ipcRenderer.invoke('project:save', p),
  importMedia: (paths) => ipcRenderer.invoke('media:import', paths),
  detectSilences: (args) => ipcRenderer.invoke('silences:detect', args),
  exportVideo: (p) => ipcRenderer.invoke('export:run', p),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onExternalChange: on('project:external'),
  onExportProgress: on('export:progress'),
  onError: on('app:error'),
});
