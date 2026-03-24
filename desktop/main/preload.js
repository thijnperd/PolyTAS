const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('PolyTASDesktop', {
  sendMessage: (msg) => ipcRenderer.send('polytas:editor-message', msg),
  onMessage: (handler) => ipcRenderer.on('polytas:game-event', (_event, msg) => handler(msg)),
  setGameBounds: (bounds) => ipcRenderer.send('polytas:set-game-bounds', bounds),
  setGameUrl: (url) => ipcRenderer.invoke('polytas:set-game-url', url),
  getGameUrl: () => ipcRenderer.invoke('polytas:get-game-url'),
  runScript: (script) => ipcRenderer.invoke('polytas:run-script', script),
  copyText: (text) => ipcRenderer.invoke('polytas:copy-text', text),
  startOsReplay: (payload) => ipcRenderer.invoke('polytas:os-replay-start', payload),
  stopOsReplay: () => ipcRenderer.invoke('polytas:os-replay-stop'),
});
