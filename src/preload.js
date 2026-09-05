const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Existing Dialog & API methods
  selectStemFiles: () => ipcRenderer.invoke('dialog:selectStemFiles'),
  readStemBuffer: (filePath) => ipcRenderer.invoke('dialog:readStemBuffer', filePath),
  login: (credentials) => ipcRenderer.invoke('api:login', credentials),
  getProjects: (params) => ipcRenderer.invoke('api:getProjects', params || {}),
  uploadStem: (payload) => ipcRenderer.invoke('api:uploadStem', payload),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // Stem Watcher APIs
  watcher: {
    getStatus: () => ipcRenderer.invoke('watcher:getStatus'),
    setFolder: (folderPath) => ipcRenderer.invoke('watcher:setFolder', folderPath),
    selectFolderDialog: () => ipcRenderer.invoke('watcher:selectFolderDialog'),
    resetDefault: () => ipcRenderer.invoke('watcher:resetDefault'),
    pause: () => ipcRenderer.invoke('watcher:pause'),
    resume: () => ipcRenderer.invoke('watcher:resume'),
    openFolder: () => ipcRenderer.invoke('watcher:openFolder'),
    getPendingStems: () => ipcRenderer.invoke('watcher:getPendingStems'),
    dismissPending: () => ipcRenderer.invoke('watcher:dismissPending'),

    // Event subscriptions
    onStemsDetected: (callback) => {
      const subscription = (_event, data) => callback(data);
      ipcRenderer.on('watcher:stemsDetected', subscription);
      return () => ipcRenderer.removeListener('watcher:stemsDetected', subscription);
    },
    onStatusChanged: (callback) => {
      const subscription = (_event, data) => callback(data);
      ipcRenderer.on('watcher:statusChanged', subscription);
      return () => ipcRenderer.removeListener('watcher:statusChanged', subscription);
    },
    onFocusDetectedStems: (callback) => {
      const subscription = (_event, data) => callback(data);
      ipcRenderer.on('watcher:focusDetectedStems', subscription);
      return () => ipcRenderer.removeListener('watcher:focusDetectedStems', subscription);
    },
    onOpenSettings: (callback) => {
      const subscription = () => callback();
      ipcRenderer.on('app:openSettings', subscription);
      return () => ipcRenderer.removeListener('app:openSettings', subscription);
    },
  },
});
