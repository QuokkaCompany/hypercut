const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('hypercut', {
  platform: process.platform,
  pickVideo: () => ipcRenderer.invoke('hypercut:pick-video'),
  saveExport: id => ipcRenderer.invoke('hypercut:save-export', id),
  saveProject: project => ipcRenderer.invoke('hypercut:save-project', project),
  openBrowser: () => ipcRenderer.invoke('hypercut:open-browser')
});
