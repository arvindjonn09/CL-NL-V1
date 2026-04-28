# System Architecture

## Purpose

The system provides unattended device management and remote access:

- Operators/admins use the web app for fleet health, commands, file transfer, upgrades, users, and diagnostics.
- Remote-access users authenticate separately and can open assigned devices.
- Installed agents maintain outbound connectivity to the backend.
- Remote desktop is relayed over backend WebSockets with JPEG frames, not direct browser-to-agent networking.

## Runtime Components

```mermaid
flowchart TD
  Browser[Admin or remote user browser]
  Web[Next.js web app]
  Api[Express API server]
  Ws[WebSocket server]
  Db[(Postgres)]
  Agent[SetuLinkAgent service]
  Helper[setulink-agent.exe --helper]
  OS[Windows active user desktop]

  Browser --> Web
  Web --> Api
  Browser <--> Ws
  Api <--> Db
  Ws <--> Agent
  Agent <--> Api
  Agent <--> Helper
  Helper --> OS
```

## Backend Responsibilities

The backend owns:

- Device registration, heartbeat, health summaries, and diagnostics.
- Admin authentication, remote-access authentication, sessions, and acknowledgement gates.
- Commands, file jobs, device actions, upgrade manifests, and audit events.
- Remote desktop session records and WebSocket relay pairing.
- Browser to agent command/control routing over WebSockets.

Key files:

- `server/src/index.js`
- `server/src/wsServer.js`
- `server/src/db/schema.js`
- `server/src/remoteAccess/*`
- `server/src/remoteDesktop/*`
- `server/src/admin/*`
- `server/src/diagnostics/*`
- `server/src/upgrades/*`

## Agent Responsibilities

The agent owns:

- Startup checks and runtime path preparation.
- Device registration and heartbeats.
- Command polling/execution and streaming command output over WebSocket.
- File transfers.
- Device actions and upgrade apply/rollback helpers.
- Diagnostics, watchdog state, and recovery policy.
- Remote desktop capture/input on the endpoint.

Key files:

- `agent/main.go`
- `agent/ws.go`
- `agent/heartbeat.go`
- `agent/actions.go`
- `agent/file_transfer.go`
- `agent/agent_diagnostics.go`
- `agent/agent_upgrade.go`
- `agent/internal/*`

## Windows Remote Desktop Split

Windows service mode crosses a user boundary:

```text
LocalSystem service
  -> launches helper in active user session
  -> helper captures desktop and injects input
```

The service and helper communicate through a named pipe. The pipe ACL allows:

```text
SYSTEM
Administrators
Interactive Users
Authenticated Users
```

This boundary is the most important Windows-specific part of the architecture.

## Data Flow Summary

```mermaid
sequenceDiagram
  participant B as Browser
  participant S as Server
  participant A as Agent service
  participant H as Active-user helper
  participant D as Desktop

  A->>S: register + keep WebSocket open
  A->>S: heartbeat and diagnostics
  B->>S: authenticated HTTP requests
  B->>S: browser WebSocket for live streams
  S->>A: commands, actions, remote desktop start/control
  A->>H: named pipe messages
  H->>D: capture screen / inject input
  H->>A: JPEG frames over named pipe
  A->>S: RDF1 binary JPEG frames over agent WebSocket
  S->>B: RDF1 binary JPEG frames over browser WebSocket
```

## Deployment Shape

```mermaid
flowchart LR
  PublicWeb[Public web hostname] --> WebProc[Next.js process]
  PublicApi[Public API hostname] --> ApiProc[Node API process]
  ApiProc --> Pg[(Postgres)]
  WindowsDevice[Windows endpoint] --> ApiProc
  WindowsDevice --> WsEndpoint[API WebSocket endpoint]
```

The Windows endpoint initiates outbound HTTP/WebSocket connections. Inbound device ports are not part of the intended design.

