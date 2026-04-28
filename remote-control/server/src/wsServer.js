const WebSocket = require('ws');
const { agentSharedSecret } = require('./config');

const connectedAgents = new Map();
/**
 * Map<deviceId, Set<WebSocket>>
 */
const browserClientsByDevice = new Map();

function initWebSocket(server) {
  const wss = new WebSocket.Server({ server });

  console.log('WebSocket server started');

  wss.on('connection', (ws) => {
    let deviceId = null;
    let clientType = null;

    ws.on('message', (message) => {
      try {
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
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
    });
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
