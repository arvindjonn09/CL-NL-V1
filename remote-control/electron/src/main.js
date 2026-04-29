const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const { uIOhook } = require('uiohook-napi');
const path = require('path');
const { TIER2_KEYS } = require('./tier2-keys');

const SETULINK_URL = process.env.SETULINK_URL || 'https://netralink.shivomsangha.com';
const HEARTBEAT_TIMEOUT_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 5000;

let mainWindow = null;
let hookActive = false;
let pressedKeys = new Set();
let heartbeatMissed = 0;
let heartbeatTimer = null;
let lastClipboardText = '';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    transparent: false,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadURL(SETULINK_URL);

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.executeJavaScript('window.__isElectron = true;');
  });
  mainWindow.on('focus', handleWindowFocus);
  mainWindow.on('blur', handleWindowBlur);
  mainWindow.on('closed', () => {
    stopHook();
    mainWindow = null;
  });
}

function handleWindowFocus() {
  startHook();
  pushClipboardToRenderer();
}

function handleWindowBlur() {}

function pushClipboardToRenderer() {
  const text = clipboard.readText();
  if (!text || text === lastClipboardText) return;
  lastClipboardText = text;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('clipboard-push', { text, byteLen: Buffer.byteLength(text, 'utf8') });
  }
}

ipcMain.handle('clipboard-write', (_event, text) => {
  if (typeof text === 'string') {
    lastClipboardText = text;
    clipboard.writeText(text);
  }
});

ipcMain.handle('clipboard-read', () => clipboard.readText());

ipcMain.on('session-state', (_event, { active }) => {
  if (active) {
    startHook();
    pushClipboardToRenderer();
    return;
  }
  stopHook();
  stopHeartbeatWatchdog();
});

ipcMain.on('heartbeat-ack', () => {
  heartbeatMissed = 0;
});

ipcMain.on('toggle-fullscreen', () => {
  if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
});

ipcMain.on('minimize-window', () => {
  if (!mainWindow) return;
  mainWindow.setFullScreen(false);
  mainWindow.minimize();
});

ipcMain.on('session-disconnect', () => {
  stopHook();
  stopHeartbeatWatchdog();
});

function startHeartbeatWatchdog() {
  stopHeartbeatWatchdog();
  heartbeatMissed = 0;
  heartbeatTimer = setInterval(() => {
    heartbeatMissed += 1;
    if (heartbeatMissed >= 3) {
      console.warn('[electron] heartbeat missed x3, releasing keyboard hook');
      stopHook();
      stopHeartbeatWatchdog();
    }
  }, HEARTBEAT_INTERVAL_MS + HEARTBEAT_TIMEOUT_MS);
}

function stopHeartbeatWatchdog() {
  if (!heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function startHook() {
  if (hookActive) return;
  hookActive = true;
  pressedKeys.clear();
  uIOhook.on('keydown', handleHookKeyDown);
  uIOhook.on('keyup', handleHookKeyUp);
  uIOhook.start();
  startHeartbeatWatchdog();
  console.log('[electron] uiohook started');
}

function stopHook() {
  if (!hookActive) return;
  hookActive = false;
  pressedKeys.clear();
  uIOhook.removeAllListeners('keydown');
  uIOhook.removeAllListeners('keyup');
  uIOhook.stop();
  stopHeartbeatWatchdog();
  console.log('[electron] uiohook stopped');
}

function handleHookKeyDown(e) {
  pressedKeys.add(e.keycode);
  if (isReleaseCombo()) {
    stopHook();
    mainWindow?.webContents.send('hook-released', {});
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isFocused()) return;

  const mapping = TIER2_KEYS[e.keycode];
  if (!mapping) return;
  e.preventDefault?.();
  mainWindow.webContents.send('tier2-keydown', {
    vkCode: mapping.vk,
    scanCode: e.keycode,
    extended: mapping.extended,
  });
}

function handleHookKeyUp(e) {
  pressedKeys.delete(e.keycode);
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isFocused()) return;

  const mapping = TIER2_KEYS[e.keycode];
  if (!mapping) return;
  e.preventDefault?.();
  mainWindow.webContents.send('tier2-keyup', {
    vkCode: mapping.vk,
    scanCode: e.keycode,
    extended: mapping.extended,
  });
}

function isReleaseCombo() {
  return pressedKeys.has(29) && pressedKeys.has(42) && pressedKeys.has(88);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  stopHook();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
