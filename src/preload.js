const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectStemFiles: () => ipcRenderer.invoke('dialog:selectStemFiles'),
  readStemBuffer: (filePath) => ipcRenderer.invoke('dialog:readStemBuffer', filePath),
  login: (credentials) => ipcRenderer.invoke('api:login', credentials),
  getProjects: (params) => ipcRenderer.invoke('api:getProjects', params || {}),
  uploadStem: (payload) => ipcRenderer.invoke('api:uploadStem', payload),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
});


