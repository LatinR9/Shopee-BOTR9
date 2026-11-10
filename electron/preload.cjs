const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("shopeeBot", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  startJob: (payload) => ipcRenderer.invoke("job:start", payload),
  stopJob: () => ipcRenderer.invoke("job:stop"),
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  openReleasesPage: () => ipcRenderer.invoke("update:open-releases"),
  scanVariants: (productUrl, productId) =>
    ipcRenderer.invoke("variants:scan", { productUrl, productId }),
  closeBrowser: () => ipcRenderer.invoke("browser:close"),
  getBrowserInfo: () => ipcRenderer.invoke("browser:info"),
  onLog: (handler) => {
    const listener = (_event, entry) => handler(entry);
    ipcRenderer.on("job:log", listener);
    return () => ipcRenderer.removeListener("job:log", listener);
  },
  onStatus: (handler) => {
    const listener = (_event, status) => handler(status);
    ipcRenderer.on("job:status", listener);
    return () => ipcRenderer.removeListener("job:status", listener);
  },
  onUpdateStatus: (handler) => {
    const listener = (_event, status) => handler(status);
    ipcRenderer.on("update:status", listener);
    return () => ipcRenderer.removeListener("update:status", listener);
  },
});
