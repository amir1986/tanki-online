// Minimal bridge between the game page and the Electron shell.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tanki', {
  isElectron: true,
  quit: () => ipcRenderer.send('quit'),
  toggleFullscreen: () => ipcRenderer.send('fullscreen'),
  serverInfo: () => ipcRenderer.invoke('server-info'),
});
