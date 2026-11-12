const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('storage', {
  load: () => ipcRenderer.invoke('data:load'),
  save: (json) => ipcRenderer.invoke('data:save', json),
});

contextBridge.exposeInMainWorld('updater', {
  get: () => ipcRenderer.invoke('update:get'),
  check: () => ipcRenderer.invoke('update:check'),
  install: () => ipcRenderer.invoke('update:install'),
  onStatus: (callback) => ipcRenderer.on('update:status', (_event, status) => callback(status)),
});

contextBridge.exposeInMainWorld('pronunciation', {
  load: (key) => ipcRenderer.invoke('audio:load', key),
  download: (key, url) => ipcRenderer.invoke('audio:download', key, url),
});
