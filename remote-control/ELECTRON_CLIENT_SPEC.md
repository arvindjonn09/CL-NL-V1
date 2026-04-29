# SetuLink Electron Desktop Client — Complete Implementation Spec

## Purpose

Build a native-feel Electron desktop client for SetuLink remote desktop sessions. The goal is an
experience identical to Windows RDP: frameless full-screen window, all keyboard shortcuts forwarded
to the remote machine (including Win, Alt+Tab, Alt+F4), pointer lock, directional clipboard sync,
and a minimal auto-hiding toolbar.

The Electron app is a shell that loads the existing Next.js frontend. It adds native capabilities
(keyboard hooks, clipboard, window management) that a browser tab cannot provide.

---

## Repository Layout

All paths are relative to `remote-control/` (the monorepo root containing `agent/`, `server/`,
`web/`, etc.).

```
remote-control/
  agent/                          Go Windows agent (already exists)
  server/                         Node.js relay server (already exists)
  web/                            Next.js frontend (already exists)
  electron/                       NEW — Electron desktop client
    src/
      main.js
      preload.js
      tier2-keys.js
    electron-builder.yml
    package.json
    .gitignore
```

---

## Part 1 — Electron App (New Files)

### 1.1 `electron/package.json`

```json
{
  "name": "setulink-desktop",
  "version": "1.0.0",
  "description": "SetuLink Desktop Client",
  "main": "src/main.js",
  "scripts": {
    "start": "electron .",
    "build:win": "electron-builder --win",
    "build:mac": "electron-builder --mac",
    "build:linux": "electron-builder --linux"
  },
  "dependencies": {
    "uiohook-napi": "^1.5.3"
  },
  "devDependencies": {
    "electron": "^30.0.0",
    "electron-builder": "^24.0.0"
  }
}
```

---

### 1.2 `electron/src/main.js`

This is the Electron main process. It handles:
- Creating a frameless, borderless window
- Loading the SetuLink frontend URL
- Managing uiohook for Tier 2 keyboard interception
- Focus-based clipboard push via IPC to renderer
- Heartbeat watchdog that calls `uiohook.stop()` if renderer hangs

```javascript
const { app, BrowserWindow, ipcMain, clipboard, globalShortcut } = require('electron');
const { uIOhook, UiohookKey } = require('uiohook-napi');
const path = require('path');
const { TIER2_KEYS, VK_LWIN, VK_RWIN } = require('./tier2-keys');

// The URL to load. In development override with: SETULINK_URL=http://localhost:3201 npm start
const SETULINK_URL = process.env.SETULINK_URL || 'https://netralink.shivomsangha.com';

// Release combo: Ctrl+Shift+F12 releases the keyboard hook and returns focus to OS
const RELEASE_COMBO_KEYS = new Set(['ControlLeft', 'ShiftLeft', 'F12']);

let mainWindow = null;
let hookActive = false;
let pressedKeys = new Set();           // tracks currently held keys for release combo detection
let heartbeatMissed = 0;
let heartbeatTimer = null;
const HEARTBEAT_TIMEOUT_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 5000;
let lastClipboardText = '';            // guards against re-sending the same clipboard content

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,             // no OS title bar
    transparent: false,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,          // required for uiohook IPC to work
    },
  });

  mainWindow.loadURL(SETULINK_URL);

  // Tell the renderer it is inside Electron
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript('window.__isElectron = true;');
  });

  mainWindow.on('focus', handleWindowFocus);
  mainWindow.on('blur', handleWindowBlur);
  mainWindow.on('closed', () => {
    stopHook();
    mainWindow = null;
  });
}

// ─── Window Focus ────────────────────────────────────────────────────────────

function handleWindowFocus() {
  startHook();
  pushClipboardToRenderer();
}

function handleWindowBlur() {
  // Do NOT stop the hook on blur — only stop on the release combo or disconnect
  // Stopping on blur would prevent Alt+Tab from reaching the remote machine
  // because the moment we send Alt, the local OS would blur our window
}

// ─── Clipboard Push (Local → Remote) ─────────────────────────────────────────

function pushClipboardToRenderer() {
  const text = clipboard.readText();
  // Only push if the content changed and we have an active session
  if (!text || text === lastClipboardText) return;
  lastClipboardText = text;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('clipboard-push', { text, byteLen: Buffer.byteLength(text, 'utf8') });
  }
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

// Renderer calls this to write pulled clipboard content to local clipboard
ipcMain.handle('clipboard-write', (_event, text) => {
  if (typeof text === 'string') {
    lastClipboardText = text;     // prevent echo on next focus
    clipboard.writeText(text);
  }
});

// Renderer calls this to request current local clipboard (used by preload)
ipcMain.handle('clipboard-read', () => clipboard.readText());

// Renderer reports session active/inactive so we know when to arm the hook
ipcMain.on('session-state', (_event, { active }) => {
  if (!active) {
    stopHook();
    stopHeartbeatWatchdog();
  }
});

// Renderer sends heartbeat ack so the watchdog knows the renderer is alive
ipcMain.on('heartbeat-ack', () => {
  heartbeatMissed = 0;
});

// Renderer asks for full-screen toggle
ipcMain.on('toggle-fullscreen', () => {
  if (mainWindow) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  }
});

// Renderer asks to minimize (exit full-screen, show OS taskbar)
ipcMain.on('minimize-window', () => {
  if (mainWindow) {
    mainWindow.setFullScreen(false);
    mainWindow.minimize();
  }
});

// Renderer triggers disconnect — release hook before unloading
ipcMain.on('session-disconnect', () => {
  stopHook();
  stopHeartbeatWatchdog();
});

// ─── Heartbeat Watchdog ───────────────────────────────────────────────────────

function startHeartbeatWatchdog() {
  stopHeartbeatWatchdog();
  heartbeatMissed = 0;
  heartbeatTimer = setInterval(() => {
    heartbeatMissed++;
    if (heartbeatMissed >= 3) {
      // Renderer is hung — emergency hook release
      console.warn('[electron] heartbeat missed x3 — releasing keyboard hook');
      stopHook();
      stopHeartbeatWatchdog();
    }
  }, HEARTBEAT_INTERVAL_MS + HEARTBEAT_TIMEOUT_MS);
}

function stopHeartbeatWatchdog() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ─── uiohook — Tier 2 Keyboard Hook ─────────────────────────────────────────

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

  // Release combo check: Ctrl+Shift+F12 → release hook and unblind OS
  if (isReleaseCombo()) {
    stopHook();
    mainWindow?.webContents.send('hook-released', {});
    return;  // let OS handle these keys normally
  }

  // Focus guard: if our window is not focused, do not intercept
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isFocused()) return;

  const mapping = TIER2_KEYS[e.keycode];
  if (!mapping) return;  // not a Tier 2 key — let browser handle it via normal keydown

  // Suppress local OS from seeing this key, forward to renderer
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
  // Ctrl+Shift+F12: uiohook keycodes 29 (LCtrl), 42 (LShift), 88 (F12)
  return pressedKeys.has(29) && pressedKeys.has(42) && pressedKeys.has(88);
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  stopHook();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
```

---

### 1.3 `electron/src/preload.js`

The preload script bridges the main process and the renderer (Next.js page). It runs in the renderer
context but with Node.js access. It exposes a controlled API via `contextBridge`.

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Called when the main process detects a Tier 2 key via uiohook
  onTier2KeyDown: (callback) => ipcRenderer.on('tier2-keydown', (_event, packet) => callback(packet)),
  onTier2KeyUp:  (callback) => ipcRenderer.on('tier2-keyup',   (_event, packet) => callback(packet)),

  // Called when the main process pushes local clipboard to renderer (on focus)
  onClipboardPush: (callback) => ipcRenderer.on('clipboard-push', (_event, data) => callback(data)),

  // Called when the hook is released via Ctrl+Shift+F12
  onHookReleased: (callback) => ipcRenderer.on('hook-released', () => callback()),

  // Renderer writes text to local clipboard (used after clipboard pull)
  writeClipboard: (text) => ipcRenderer.invoke('clipboard-write', text),

  // Renderer reads local clipboard directly (optional utility)
  readClipboard: () => ipcRenderer.invoke('clipboard-read'),

  // Renderer tells main process the session is active/inactive
  setSessionState: (active) => ipcRenderer.send('session-state', { active }),

  // Renderer acknowledges heartbeat so watchdog resets
  ackHeartbeat: () => ipcRenderer.send('heartbeat-ack'),

  // Window controls
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  minimizeWindow:   () => ipcRenderer.send('minimize-window'),
  notifyDisconnect: () => ipcRenderer.send('session-disconnect'),
});
```

---

### 1.4 `electron/src/tier2-keys.js`

Maps uiohook hardware keycodes to Windows Virtual Key codes and the `extended` flag required by
`SendInput`. Only keys the OS would steal are listed here. Regular keys are handled by the browser's
own `keydown` events (Tier 1).

```javascript
// uiohook keycode → { vk: Windows VK code (decimal), extended: bool }
const TIER2_KEYS = {
  // Win keys
  3675: { vk: 0x5B, extended: true  },  // LWin
  3676: { vk: 0x5C, extended: true  },  // RWin

  // Alt (only when combined; standalone alt is handled by browser)
  56:   { vk: 0x12, extended: false },  // LAlt
  3640: { vk: 0x12, extended: true  },  // RAlt (AltGr on intl keyboards — handle carefully)

  // Tab (intercepted so Alt+Tab works)
  15:   { vk: 0x09, extended: false },  // Tab

  // F-keys
  62:   { vk: 0x73, extended: false },  // F4   (Alt+F4)
  88:   { vk: 0x7B, extended: false },  // F12  (release combo key — sent as release only)

  // Ctrl+Esc (opens Start menu)
  1:    { vk: 0x1B, extended: false },  // Esc

  // Task Manager: Ctrl+Shift+Esc — Esc is above; Ctrl and Shift are Tier 1 but added here
  // so they get forwarded when held alongside Tier 2 keys
  29:   { vk: 0x11, extended: false },  // LCtrl
  42:   { vk: 0x10, extended: false },  // LShift
  3613: { vk: 0x11, extended: true  },  // RCtrl
  54:   { vk: 0x10, extended: false },  // RShift
};

// Convenience exports for main.js
const VK_LWIN = 0x5B;
const VK_RWIN = 0x5C;

module.exports = { TIER2_KEYS, VK_LWIN, VK_RWIN };
```

> **Note for Codex:** uiohook-napi keycode values can be verified by running a small test script that
> logs `e.keycode` for each key press before finalising this table. The values above are the standard
> scan codes on US keyboards. Verify them in a quick test before shipping.

---

### 1.5 `electron/electron-builder.yml`

```yaml
appId: com.setulink.desktop
productName: SetuLink Desktop
directories:
  output: dist
files:
  - src/**
  - package.json
win:
  target: nsis
  icon: assets/icon.ico
mac:
  target: dmg
  icon: assets/icon.icns
linux:
  target: AppImage
  icon: assets/icon.png
nsis:
  oneClick: false
  allowDirChange: true
  installerIcon: assets/icon.ico
  installerHeaderIcon: assets/icon.ico
```

---

### 1.6 `electron/.gitignore`

```
node_modules/
dist/
```

---

## Part 2 — Protocol Changes (New WebSocket Message Types)

The existing `key_down` / `key_up` / `mouse_move` / `mouse_down` / `mouse_up` / `viewport` message
types are **unchanged**. They continue to handle Tier 1 keys via the browser's native keydown events.

New message types added for Electron-only features:

### `input.keyboard` — Tier 2 keys from uiohook

Sent by the renderer when the main process delivers a Tier 2 key via IPC.

```json
{
  "type": "input.keyboard",
  "action": "down",
  "vkCode": 91,
  "scanCode": 3675,
  "extended": true,
  "seq": 1042,
  "ts": 1714392847291
}
```

Fields:
- `action`: `"down"` or `"up"`
- `vkCode`: Windows Virtual Key code (decimal integer)
- `scanCode`: raw hardware keycode from uiohook (for logging/debugging)
- `extended`: bool — maps to `KEYEVENTF_EXTENDEDKEY` in `SendInput`
- `seq`: monotonic integer per session (detects dropped packets)
- `ts`: client timestamp in milliseconds

### `system.sas` — Trigger Ctrl+Alt+Del on remote

```json
{
  "type": "system.sas",
  "seq": 1043,
  "ts": 1714392847300
}
```

No additional payload. The Go agent calls `SendSAS(FALSE)` via `sas.dll`.

### `clipboard.push` — Local clipboard → Remote clipboard

Sent automatically on window focus when local clipboard content changes.

```json
{
  "type": "clipboard.push",
  "payload": "text content here",
  "byteLen": 18,
  "seq": 1044,
  "ts": 1714392847350
}
```

- `byteLen` is `Buffer.byteLength(text, 'utf8')`. Agent rejects payloads where `byteLen > 2097152` (2 MB).

### `clipboard.pull` — Request remote clipboard → Local

Sent when admin clicks "Pull Clipboard" toolbar button.

```json
{
  "type": "clipboard.pull",
  "seq": 1045,
  "ts": 1714392847400
}
```

No payload. Agent reads remote clipboard and sends back a `remote-desktop-clipboard` message.

### `session.heartbeat` — Keep-alive / RTT probe

Sent by the renderer every 5 seconds. The server echoes it back without forwarding to the agent.

```json
{
  "type": "session.heartbeat",
  "seq": 1046,
  "ts": 1714392848000
}
```

Server echoes: same JSON object, same `seq` and `ts`.

---

## Part 3 — Go Agent Changes

### 3.1 `agent/internal/remotedesktop/input.go`

Extend `ControlMessage` to carry the new fields:

```go
type ControlMessage struct {
    Type             string  `json:"type"`
    // --- existing Tier 1 fields ---
    X                int     `json:"x,omitempty"`
    Y                int     `json:"y,omitempty"`
    XRatio           float64 `json:"xRatio,omitempty"`
    YRatio           float64 `json:"yRatio,omitempty"`
    Button           int     `json:"button,omitempty"`
    Key              string  `json:"key,omitempty"`
    Code             string  `json:"code,omitempty"`
    Width            int     `json:"width,omitempty"`
    Height           int     `json:"height,omitempty"`
    ScaleMode        string  `json:"scaleMode,omitempty"`
    DevicePixelRatio float64 `json:"devicePixelRatio,omitempty"`
    // --- new Tier 2 / Electron fields ---
    Action      string `json:"action,omitempty"`    // "down" | "up" for input.keyboard
    VkCode      uint16 `json:"vkCode,omitempty"`
    ScanCode    uint16 `json:"scanCode,omitempty"`
    Extended    bool   `json:"extended,omitempty"`
    Seq         uint64 `json:"seq,omitempty"`
    Ts          int64  `json:"ts,omitempty"`
    // clipboard
    Payload     string `json:"payload,omitempty"`  // clipboard.push text
    ByteLen     int    `json:"byteLen,omitempty"`
}
```

---

### 3.2 `agent/internal/remotedesktop/input_windows.go`

Add new cases to `InjectInput`:

```go
case "input.keyboard":
    up := message.Action == "up"
    return sendVKCode(message.VkCode, up, message.Extended)
```

Add `sendVKCode` alongside existing `sendKey`:

```go
func sendVKCode(vk uint16, up bool, extended bool) error {
    if vk == 0 {
        return nil
    }
    flags := uint32(0)
    if up {
        flags |= keyEventFKeyUp
    }
    if extended {
        flags |= 0x0001  // KEYEVENTF_EXTENDEDKEY
    }
    event := input{Type: inputKeyboard, Ki: keyboardInput{WVk: vk, DwFlags: flags}}
    return sendInput(unsafe.Pointer(&event), unsafe.Sizeof(event))
}
```

---

### 3.3 New file: `agent/internal/remotedesktop/sas_windows.go`

```go
//go:build windows

package remotedesktop

import "golang.org/x/sys/windows"

func TriggerSAS() error {
    sasDLL := windows.NewLazySystemDLL("sas.dll")
    sendSAS := sasDLL.NewProc("SendSAS")
    _, _, err := sendSAS.Call(0)  // 0 = not from keyboard shortcut, from app
    if err != windows.ERROR_SUCCESS {
        return err
    }
    return nil
}
```

Add to `InjectInput` in `input_windows.go`:

```go
case "system.sas":
    return TriggerSAS()
```

> **Note:** `sas.dll` is only available on Windows Vista+ and only works when the calling process has
> the `SeTcbPrivilege` (which the SYSTEM service has). No extra privilege grant needed.

---

### 3.4 New file: `agent/internal/remotedesktop/clipboard_windows.go`

```go
//go:build windows

package remotedesktop

import (
    "fmt"
    "syscall"
    "unsafe"

    "golang.org/x/sys/windows"
)

var (
    procOpenClipboard   = user32.NewProc("OpenClipboard")
    procCloseClipboard  = user32.NewProc("CloseClipboard")
    procEmptyClipboard  = user32.NewProc("EmptyClipboard")
    procSetClipboardData = user32.NewProc("SetClipboardData")
    procGetClipboardData = user32.NewProc("GetClipboardData")
    kernel32            = windows.NewLazySystemDLL("kernel32.dll")
    procGlobalAlloc     = kernel32.NewProc("GlobalAlloc")
    procGlobalLock      = kernel32.NewProc("GlobalLock")
    procGlobalUnlock    = kernel32.NewProc("GlobalUnlock")
    procGlobalFree      = kernel32.NewProc("GlobalFree")
)

const (
    cfUnicodeText = 13
    gmemMoveable  = 0x0002
)

func WriteClipboard(text string) error {
    utf16, err := syscall.UTF16FromString(text)
    if err != nil {
        return fmt.Errorf("clipboard encode: %w", err)
    }
    size := uintptr(len(utf16) * 2)

    hMem, _, err := procGlobalAlloc.Call(gmemMoveable, size)
    if hMem == 0 {
        return fmt.Errorf("GlobalAlloc: %w", err)
    }

    ptr, _, err := procGlobalLock.Call(hMem)
    if ptr == 0 {
        procGlobalFree.Call(hMem)
        return fmt.Errorf("GlobalLock: %w", err)
    }
    for i, c := range utf16 {
        *(*uint16)(unsafe.Pointer(ptr + uintptr(i)*2)) = c
    }
    procGlobalUnlock.Call(hMem)

    r, _, err := procOpenClipboard.Call(0)
    if r == 0 {
        procGlobalFree.Call(hMem)
        return fmt.Errorf("OpenClipboard: %w", err)
    }
    defer procCloseClipboard.Call()

    procEmptyClipboard.Call()
    r, _, err = procSetClipboardData.Call(cfUnicodeText, hMem)
    if r == 0 {
        return fmt.Errorf("SetClipboardData: %w", err)
    }
    return nil
}

func ReadClipboard() (string, error) {
    r, _, err := procOpenClipboard.Call(0)
    if r == 0 {
        return "", fmt.Errorf("OpenClipboard: %w", err)
    }
    defer procCloseClipboard.Call()

    hMem, _, err := procGetClipboardData.Call(cfUnicodeText)
    if hMem == 0 {
        return "", fmt.Errorf("GetClipboardData: %w", err)
    }

    ptr, _, err := procGlobalLock.Call(hMem)
    if ptr == 0 {
        return "", fmt.Errorf("GlobalLock: %w", err)
    }
    defer procGlobalUnlock.Call(hMem)

    return syscall.UTF16ToString((*[1 << 20]uint16)(unsafe.Pointer(ptr))[:]), nil
}
```

> **Important:** The agent runs as a Windows Service under the SYSTEM account. Clipboard operations
> from SYSTEM work correctly on Windows because the service shares the interactive window station
> (`WinSta0\Default`) — but this must be verified on the target deployment. If clipboard access fails
> from SYSTEM, move clipboard handling into the desktop helper process (which runs in the user
> session), following the same pipe message pattern used for input injection.

---

### 3.5 Wire clipboard into `InjectInput` in `input_windows.go`

```go
case "clipboard.push":
    if message.ByteLen > 2*1024*1024 {
        return fmt.Errorf("clipboard payload too large: %d bytes", message.ByteLen)
    }
    return WriteClipboard(message.Payload)
```

For `clipboard.pull`, the agent needs to send the clipboard content back to the browser. This
requires passing a callback into `InjectInput`. Change `InjectInput` to accept a
`writeBack func(any) error` parameter:

```go
func InjectInput(message ControlMessage, writeBack func(any) error) error {
    switch message.Type {
    // ... existing cases unchanged ...
    case "clipboard.pull":
        text, err := ReadClipboard()
        if err != nil {
            return err
        }
        if writeBack != nil {
            _ = writeBack(map[string]any{
                "type":      "remote-desktop-clipboard",
                "sessionId": message.sessionID,  // see note below
                "text":      text,
            })
        }
        return nil
    }
}
```

> **Note on sessionID:** The ControlMessage does not currently carry a sessionID. Pass it through
> the call chain: `ProcessRemoteDesktopRelayControl` already has `sessionID` as its first parameter.
> Decode the ControlMessage there, then pass `sessionID` into `InjectInput` alongside `writeBack`.
> The simplest approach: add `SessionID string` to `ControlMessage` and populate it in
> `ProcessRemoteDesktopRelayControl` before calling InjectInput.

---

### 3.6 `agent/remote_desktop_relay.go` — pass `writeJSON` into input processing

In `ProcessRemoteDesktopRelayControl`, after decoding the payload, check if it is a
`clipboard.pull` and handle it inline (calling `ReadClipboard` and writing back via the agent's
existing `writeJSON` function). This keeps clipboard logic in the main agent process rather than the
desktop helper.

The `processRemoteDesktopRelayControl` function already has access to the session context. Add a
variant that accepts `writeJSON func(any) error`:

```go
func ProcessRemoteDesktopRelayControlWithReply(sessionID string, payload json.RawMessage, writeJSON func(any) error) error {
    msg, err := remotedesktop.DecodeControlMessage(payload)
    if err != nil {
        return err
    }
    msg.SessionID = sessionID

    if msg.Type == "clipboard.pull" {
        text, err := remotedesktop.ReadClipboard()
        if err != nil {
            return err
        }
        return writeJSON(map[string]any{
            "type":      "remote-desktop-clipboard",
            "sessionId": sessionID,
            "text":      text,
        })
    }

    // All other types go to the desktop pipe as before
    return writeDesktopPipeMessage(active.pipe, desktopPipeMessageInput, payload)
}
```

Call `ProcessRemoteDesktopRelayControlWithReply` from `ws.go` in the `remote-desktop-control` handler,
passing the `writeJSON` closure that is already in scope.

---

## Part 4 — Node.js Server Changes (`server/src/wsServer.js`)

Two changes are needed.

### 4.1 Heartbeat echo (do not forward to agent)

In `acceptRemoteDesktopBrowser`, inside the `ws.on('message', ...)` handler, intercept heartbeats
before forwarding to the agent:

```javascript
// Inside the message handler in acceptRemoteDesktopBrowser:
const control = JSON.parse(message.toString());

// Echo heartbeat back to the browser — do not forward to agent
if (control.type === 'session.heartbeat') {
  ws.send(message.toString());
  return;
}

agent.send(JSON.stringify({
  type: 'remote-desktop-control',
  sessionId,
  deviceId,
  payload: control,
}));
```

### 4.2 Relay `remote-desktop-clipboard` from agent to browser

In the main `wss.on('connection', ...)` message handler (the one that handles agent messages), add:

```javascript
if (data.type === 'remote-desktop-clipboard' && data.sessionId) {
  sendToRemoteDesktopBrowsers(data.sessionId, {
    type: 'remote-desktop-clipboard',
    sessionId: data.sessionId,
    text: data.text || '',
  });
  return;
}
```

Place this handler alongside the existing `remote-desktop-status` handler.

---

## Part 5 — Next.js Page Changes

File: `web/app/remoteaccess/devices/[id]/desktop/page.tsx`

### 5.1 Detect Electron context

At the top of the component, add:

```typescript
const isElectron = typeof window !== 'undefined' && (window as any).__isElectron === true;
```

### 5.2 Heartbeat state

Add state:

```typescript
const [rtt, setRtt] = useState<number | null>(null);
const heartbeatSeqRef = useRef(0);
const heartbeatPendingRef = useRef<Map<number, number>>(new Map());
```

### 5.3 Heartbeat loop (Electron only)

Add inside the socket `onopen` handler:

```typescript
if (isElectron) {
  const heartbeatInterval = setInterval(() => {
    const seq = ++heartbeatSeqRef.current;
    const ts = Date.now();
    heartbeatPendingRef.current.set(seq, ts);
    sendControl('session.heartbeat', { seq, ts });
    // Acknowledge to main process so watchdog resets
    (window as any).electronAPI?.ackHeartbeat();
  }, 5000);

  // Store interval id for cleanup:
  // add heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // heartbeatIntervalRef.current = heartbeatInterval;
}
```

In socket `onmessage`, handle heartbeat responses:

```typescript
if (msg.type === 'session.heartbeat' && msg.seq) {
  const sentAt = heartbeatPendingRef.current.get(msg.seq);
  if (sentAt) {
    heartbeatPendingRef.current.delete(msg.seq);
    setRtt(Date.now() - sentAt);
  }
  return;
}
```

### 5.4 Clipboard pull response handler

In socket `onmessage`, handle clipboard responses from agent:

```typescript
if (msg.type === 'remote-desktop-clipboard' && isElectron) {
  if (typeof msg.text === 'string') {
    (window as any).electronAPI?.writeClipboard(msg.text)
      .then(() => showToast('Clipboard pulled'));
  }
  return;
}
```

### 5.5 Tier 2 key handlers (Electron only)

After the socket is open and live, register the uiohook callbacks:

```typescript
useEffect(() => {
  if (!isElectron) return;
  const api = (window as any).electronAPI;
  if (!api) return;

  api.onTier2KeyDown((packet: { vkCode: number; scanCode: number; extended: boolean }) => {
    sendControl('input.keyboard', { action: 'down', ...packet });
  });
  api.onTier2KeyUp((packet: { vkCode: number; scanCode: number; extended: boolean }) => {
    sendControl('input.keyboard', { action: 'up', ...packet });
  });
  api.onClipboardPush((data: { text: string; byteLen: number }) => {
    sendControl('clipboard.push', { payload: data.text, byteLen: data.byteLen });
  });
  api.onHookReleased(() => {
    // Show "Press Ctrl+Shift+F12 to re-capture keyboard" hint in toolbar
    setHookActive(false);
  });
}, [isElectron]);
```

### 5.6 Toolbar buttons (Electron mode)

Add to the existing `topBarRight` section, gated on `isElectron`:

```tsx
{isElectron && state === 'live' && (
  <>
    {rtt !== null && <span style={rttLabel}>{rtt}ms</span>}
    <button type="button" onClick={handlePullClipboard} style={toolbarBtn}>
      Pull Clipboard
    </button>
    <button type="button" onClick={handleSendSAS} style={toolbarBtn}>
      Ctrl+Alt+Del
    </button>
    <button type="button" onClick={handleToggleFullscreen} style={toolbarBtn}>
      Fullscreen
    </button>
  </>
)}
```

Handlers:

```typescript
function handlePullClipboard() {
  sendControl('clipboard.pull', {});
}

function handleSendSAS() {
  sendControl('system.sas', {});
}

function handleToggleFullscreen() {
  (window as any).electronAPI?.toggleFullscreen();
}
```

### 5.7 Notify main process of session state

When the session becomes `'live'`, tell the main process:

```typescript
useEffect(() => {
  if (!isElectron) return;
  (window as any).electronAPI?.setSessionState(state === 'live');
}, [state, isElectron]);
```

When `disconnect()` is called:

```typescript
(window as any).electronAPI?.notifyDisconnect();
```

### 5.8 Toast helper (simple, no library needed)

Add a minimal toast that appears and fades after 2 seconds:

```typescript
const [toastMsg, setToastMsg] = useState<string | null>(null);
const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

function showToast(msg: string) {
  setToastMsg(msg);
  if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  toastTimerRef.current = setTimeout(() => setToastMsg(null), 2000);
}
```

Render the toast overlaying the bottom of the screen:

```tsx
{toastMsg && (
  <div style={toastStyle}>{toastMsg}</div>
)}
```

---

## Part 6 — Message Flow Summary

```
TIER 2 KEY (e.g. Win key)
─────────────────────────
uiohook fires in main.js
  → focus guard passes
  → mainWindow.webContents.send('tier2-keydown', { vkCode: 91, ... })
  → preload bridges to renderer via contextBridge
  → desktop/page.tsx onTier2KeyDown callback fires
  → sendControl('input.keyboard', { action: 'down', vkCode: 91, ... })
  → WebSocket → server (wsServer.js) forwards as remote-desktop-control
  → agent ws.go receives remote-desktop-control
  → ProcessRemoteDesktopRelayControlWithReply decodes, writes to desktop pipe
  → desktop helper reads pipe, calls InjectInput
  → InjectInput case "input.keyboard" → sendVKCode(91, false, true)
  → Windows SendInput → Win key appears on remote machine

CLIPBOARD PUSH (Local → Remote)
────────────────────────────────
Admin copies text on local machine
Electron window gains focus
main.js handleWindowFocus → pushClipboardToRenderer()
  → mainWindow.webContents.send('clipboard-push', { text, byteLen })
  → preload bridges to renderer
  → desktop/page.tsx onClipboardPush fires
  → sendControl('clipboard.push', { payload: text, byteLen })
  → server forwards as remote-desktop-control
  → agent ProcessRemoteDesktopRelayControlWithReply
  → WriteClipboard(text) on remote machine

CLIPBOARD PULL (Remote → Local)
────────────────────────────────
Admin clicks "Pull Clipboard" button
  → sendControl('clipboard.pull', {})
  → server forwards as remote-desktop-control
  → agent ProcessRemoteDesktopRelayControlWithReply detects 'clipboard.pull'
  → ReadClipboard() on remote machine
  → writeJSON({ type: 'remote-desktop-clipboard', sessionId, text })
  → agent WebSocket → server
  → server relayRemoteDesktopClipboard → browser WebSocket
  → desktop/page.tsx onmessage handles 'remote-desktop-clipboard'
  → electronAPI.writeClipboard(text) → IPC → main.js clipboard.writeText(text)
  → "Clipboard pulled" toast shown

HEARTBEAT
──────────
Every 5s: sendControl('session.heartbeat', { seq, ts })
  → server intercepts, echoes back (does NOT forward to agent)
  → desktop/page.tsx onmessage updates rtt state
  → electronAPI.ackHeartbeat() → IPC → main.js resets heartbeat watchdog
```

---

## Part 7 — Implementation Order

Build in this order to allow incremental testing:

1. **`electron/` skeleton** — Window opens, loads the frontend URL, no uiohook yet
2. **Frameless window + toolbar buttons** — `toggleFullscreen`, `minimizeWindow` IPC work
3. **Heartbeat** — Server echo + renderer loop + RTT display in toolbar
4. **Clipboard push** — on focus event, test with a plain text paste on remote
5. **Clipboard pull** — full round-trip test: copy on remote, click "Pull Clipboard", paste locally
6. **`input.keyboard` (Tier 2)** — add uiohook, test Win key opens remote Start menu
7. **SAS** — toolbar button triggers Ctrl+Alt+Del on remote
8. **Heartbeat watchdog** — verify uiohook stops when renderer hangs
9. **`electron-builder`** — produce `.exe` installer, test fresh install on Windows

---

## Part 8 — Testing Checklist

### Keyboard
- [ ] Regular typing (letters, numbers, Ctrl+C/V) still works (Tier 1 path, unmodified)
- [ ] Win key opens Start menu on **remote** machine, not local
- [ ] Alt+Tab cycles windows on **remote** machine
- [ ] Alt+F4 closes the active **remote** app
- [ ] Ctrl+Shift+Esc opens Task Manager on **remote** machine
- [ ] Ctrl+Shift+F12 releases the keyboard hook — local Win key works again
- [ ] Releasing hook shows "keyboard released" indicator in toolbar
- [ ] Re-focusing the window re-arms the hook

### Clipboard
- [ ] Copy text locally → focus Electron → paste on remote: text appears
- [ ] Same stale clipboard does not re-push if content hasn't changed
- [ ] Password in local clipboard does NOT push on session open (only on focus after copy)
- [ ] Click "Pull Clipboard" → remote clipboard content lands in local clipboard
- [ ] "Clipboard pulled" toast appears after successful pull
- [ ] Clipboard payload over 2 MB is rejected (agent returns error, no crash)

### SAS
- [ ] "Ctrl+Alt+Del" button shows Windows lock/login screen on remote
- [ ] SAS works from a SYSTEM service context (verify on target Windows deployment)

### Connection
- [ ] Heartbeat RTT displays in toolbar and updates every 5s
- [ ] Disconnect button closes session cleanly, hook is released
- [ ] If session connection drops, overlay appears (existing behaviour preserved)
- [ ] Heartbeat watchdog: simulate renderer hang — hook should auto-release within ~18s

### Distribution
- [ ] `electron-builder --win` produces a working `.exe` installer
- [ ] Fresh install on a clean Windows VM connects successfully
- [ ] App loads correct URL (env var `SETULINK_URL` override works for dev)
