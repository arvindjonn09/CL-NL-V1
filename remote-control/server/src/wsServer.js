const WebSocket = require('ws');
const { agentSharedSecret } = require('./config');
const { verifyAccessToken } = require('./auth/tokens');
const { REMOTE_ACCESS_COOKIE, isRemoteAccessSessionActive } = require('./remoteAccess/session');
const {
  getRemoteDesktopSessionForUser,
  setRemoteDesktopStatus,
} = require('./remoteDesktop/sessions');

const connectedAgents = new Map();
/**
 * Map<deviceId, Set<WebSocket>>
 */
const browserClientsByDevice = new Map();
const remoteDesktopBrowsersBySession = new Map();
const remoteDesktopBinaryMagic = Buffer.from('RDF1');
const remoteDesktopMaxBufferedBytes = Number(process.env.REMOTE_DESKTOP_MAX_BUFFERED_BYTES || 8 * 1024 * 1024);

function initWebSocket(server, options = {}) {
  const { pool = null, userStore = null } = options;
  const wss = new WebSocket.Server({ server });

  console.log('WebSocket server started');

  wss.on('connection', async (ws, req) => {
    let deviceId = null;
    let clientType = null;
    let remoteDesktopSessionId = null;

    if (isRemoteDesktopBrowserRequest(req)) {
      const accepted = await acceptRemoteDesktopBrowser(ws, req, { pool, userStore });
      if (!accepted) return;
      ({ deviceId, sessionId: remoteDesktopSessionId } = accepted);
      clientType = 'remote-desktop-browser';
      return;
    }

    ws.on('message', (message, isBinary) => {
      try {
        if (isBinary) {
          relayRemoteDesktopBinaryFrame(message);
          return;
        }

        const data = JSON.parse(message.toString());

        if (data.type === 'register' && data.deviceId) {
          if (data.agentToken !== agentSharedSecret) {
            ws.close(1008, 'Invalid agent credentials');
            return;
          }

          clientType = 'agent';
          deviceId = data.deviceId;
          connectedAgents.set(deviceId, ws);
          console.log(`Agent connected: ${deviceId}`);
          return;
        }

        if (data.type === 'browser' && data.deviceId) {
          clientType = 'browser';
          deviceId = data.deviceId;

          if (!browserClientsByDevice.has(deviceId)) {
            browserClientsByDevice.set(deviceId, new Set());
          }

          browserClientsByDevice.get(deviceId).add(ws);
          console.log(`Browser WebSocket connected for device: ${deviceId}`);
          return;
        }

        if (data.type === 'output' && data.commandId) {
          const payload = {
            type: 'output',
            commandId: data.commandId,
            chunk: data.chunk || '',
            deviceId,
          };

          console.log(
            `OUTPUT ${data.commandId} (${deviceId}): ${String(data.chunk || '').trimEnd()}`
          );

          broadcastToBrowsers(deviceId, payload);
          return;
        }

        if (data.type === 'remote-desktop-status' && data.sessionId) {
          relayRemoteDesktopStatus(data.sessionId, data);
          return;
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    });

    ws.on('close', () => {
      if (clientType === 'agent' && deviceId) {
        connectedAgents.delete(deviceId);
        console.log(`Agent disconnected: ${deviceId}`);
      }

      if (clientType === 'browser' && deviceId) {
        const clients = browserClientsByDevice.get(deviceId);
        if (clients) {
          clients.delete(ws);
          if (clients.size === 0) {
            browserClientsByDevice.delete(deviceId);
          }
        }
        console.log(`Browser WebSocket disconnected for device: ${deviceId}`);
      }

      if (clientType === 'remote-desktop-browser' && remoteDesktopSessionId) {
        removeRemoteDesktopBrowser(remoteDesktopSessionId, ws);
        console.log(`Remote desktop browser disconnected: ${deviceId} sessionId=${remoteDesktopSessionId}`);
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
    });
  });
}

function isRemoteDesktopBrowserRequest(req) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  return pathname.startsWith('/api/remoteaccess/ws/');
}

function parseCookies(header) {
  return String(header || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf('=');
      if (index <= 0) return cookies;
      const key = part.slice(0, index);
      const value = part.slice(index + 1);
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

async function remoteUserFromRequest(req, { pool, userStore }) {
  if (!pool || !userStore) return null;
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[REMOTE_ACCESS_COOKIE];
  if (!token) return null;

  const verification = verifyAccessToken(token);
  if (!verification.valid || verification.payload.purpose !== 'remote-access') return null;

  const active = await isRemoteAccessSessionActive(pool, verification.payload.sid);
  const user = await userStore.getUser(verification.payload.email);
  if (!active || !user) return null;

  return {
    email: user.email,
    displayName: user.displayName,
    isActive: user.isActive,
    remoteAccessEnabled: user.remoteAccessEnabled,
    deviceScopeMode: user.deviceScopeMode,
    deviceIds: user.deviceIds || [],
    sid: verification.payload.sid,
  };
}

async function acceptRemoteDesktopBrowser(ws, req, { pool, userStore }) {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const deviceId = decodeURIComponent(url.pathname.replace('/api/remoteaccess/ws/', '').split('/')[0] || '');
    const sessionId = url.searchParams.get('sessionId');
    if (!deviceId || !sessionId) {
      ws.close(1008, 'Remote desktop session required');
      return null;
    }

    const remoteUser = await remoteUserFromRequest(req, { pool, userStore });
    if (!remoteUser) {
      ws.close(1008, 'Remote access session required');
      return null;
    }

    const { session } = await getRemoteDesktopSessionForUser(pool, sessionId, remoteUser);
    if (!session || session.device_id !== deviceId || ['ended', 'failed', 'expired', 'denied'].includes(session.status)) {
      ws.close(1008, 'Remote desktop session unavailable');
      return null;
    }

    addRemoteDesktopBrowser(sessionId, ws);
    ws.on('message', (message, isBinary) => {
      try {
        const agent = connectedAgents.get(deviceId);
        if (!agent || agent.readyState !== WebSocket.OPEN) {
          ws.close(1011, 'Agent unavailable');
          return;
        }

        if (isBinary) return;
        const control = JSON.parse(message.toString());
        agent.send(JSON.stringify({
          type: 'remote-desktop-control',
          sessionId,
          deviceId,
          payload: control,
        }));
      } catch (err) {
        console.error('Remote desktop control relay error:', err);
      }
    });

    ws.on('close', () => {
      const empty = removeRemoteDesktopBrowser(sessionId, ws);
      if (empty) stopRemoteDesktopRelay(deviceId, sessionId);
    });

    ws.send(JSON.stringify({ type: 'remote-desktop-ready', sessionId, deviceId }));
    const agent = connectedAgents.get(deviceId);
    if (!agent || agent.readyState !== WebSocket.OPEN) {
      ws.close(1011, 'Agent unavailable');
      return null;
    }

    agent.send(JSON.stringify({
      type: 'remote-desktop-start',
      sessionId,
      deviceId,
      transport: 'jpeg-websocket',
    }));

    await setRemoteDesktopStatus(pool, sessionId, 'media_starting', 'browser websocket attached');
    console.log(`Remote desktop relay paired: ${deviceId} sessionId=${sessionId}`);
    return { deviceId, sessionId };
  } catch (err) {
    console.error('Remote desktop WebSocket accept error:', err);
    ws.close(1011, 'Remote desktop relay failed');
    return null;
  }
}

function addRemoteDesktopBrowser(sessionId, ws) {
  if (!remoteDesktopBrowsersBySession.has(sessionId)) {
    remoteDesktopBrowsersBySession.set(sessionId, new Set());
  }
  remoteDesktopBrowsersBySession.get(sessionId).add(ws);
}

function removeRemoteDesktopBrowser(sessionId, ws) {
  const clients = remoteDesktopBrowsersBySession.get(sessionId);
  if (!clients) return false;
  clients.delete(ws);
  if (clients.size === 0) {
    remoteDesktopBrowsersBySession.delete(sessionId);
    return true;
  }
  return false;
}

function stopRemoteDesktopRelay(deviceId, sessionId) {
  const agent = connectedAgents.get(deviceId);
  if (!agent || agent.readyState !== WebSocket.OPEN) return;
  agent.send(JSON.stringify({
    type: 'remote-desktop-stop',
    sessionId,
    deviceId,
  }));
}

function sendToRemoteDesktopBrowsers(sessionId, payload, options = {}) {
  const clients = remoteDesktopBrowsersBySession.get(sessionId);
  if (!clients) return;
  const body = options.binary ? payload : JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      if (options.binary && client.bufferedAmount > remoteDesktopMaxBufferedBytes) {
        continue;
      }
      client.send(body, options.binary ? { binary: true } : undefined);
    }
  }
}

function parseRemoteDesktopBinaryFrame(message) {
  const buffer = Buffer.isBuffer(message) ? message : Buffer.from(message);
  if (buffer.length < 8 || !buffer.subarray(0, 4).equals(remoteDesktopBinaryMagic)) {
    return null;
  }
  const headerLength = buffer.readUInt32BE(4);
  const headerStart = 8;
  const headerEnd = headerStart + headerLength;
  if (headerLength <= 0 || headerEnd > buffer.length) {
    return null;
  }
  const header = JSON.parse(buffer.subarray(headerStart, headerEnd).toString('utf8'));
  if (!header.sessionId) return null;
  return { sessionId: header.sessionId, buffer };
}

function relayRemoteDesktopBinaryFrame(message) {
  const frame = parseRemoteDesktopBinaryFrame(message);
  if (!frame) return;
  sendToRemoteDesktopBrowsers(frame.sessionId, frame.buffer, { binary: true });
}

function relayRemoteDesktopStatus(sessionId, status) {
  sendToRemoteDesktopBrowsers(sessionId, {
    type: 'remote-desktop-status',
    sessionId,
    status: status.status,
    reason: status.reason || null,
  });
}

function getConnectedAgent(deviceId) {
  return connectedAgents.get(deviceId);
}

function broadcastToBrowsers(deviceId, data) {
  const clients = browserClientsByDevice.get(deviceId);

  console.log('Broadcasting to browsers:', { deviceId, data });

  if (!clients) return;

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  }
}

function pushRemoteDesktopPending(deviceId, sessionId) {
  const agent = connectedAgents.get(deviceId);
  if (!agent || agent.readyState !== WebSocket.OPEN) return false;

  agent.send(JSON.stringify({
    type: 'remote-desktop-pending',
    sessionId,
    deviceId,
  }));
  console.log(`Remote desktop pending pushed to agent: ${deviceId} sessionId=${sessionId}`);
  return true;
}

module.exports = {
  initWebSocket,
  getConnectedAgent,
  broadcastToBrowsers,
  pushRemoteDesktopPending,
};
