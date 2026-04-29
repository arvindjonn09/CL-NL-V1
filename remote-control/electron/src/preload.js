const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  const listener = (_event, packet) => callback(packet);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('electronAPI', {
  onTier2KeyDown: (callback) => on('tier2-keydown', callback),
  onTier2KeyUp: (callback) => on('tier2-keyup', callback),
  onClipboardPush: (callback) => on('clipboard-push', callback),
  onHookReleased: (callback) => on('hook-released', callback),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard-write', text),
  readClipboard: () => ipcRenderer.invoke('clipboard-read'),
  setSessionState: (active) => ipcRenderer.send('session-state', { active }),
  ackHeartbeat: () => ipcRenderer.send('heartbeat-ack'),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  notifyDisconnect: () => ipcRenderer.send('session-disconnect'),
});
