# Current State

## Checkpoint Summary

The repository is in the middle of the remote-desktop relay migration. The current intended architecture is:

```text
Browser canvas
  <-> backend WebSocket relay
  <-> SetuLinkAgent service
  <-> named pipe
  <-> setulink-agent.exe --helper in active user session
```

The Windows service/helper pipe issue has been addressed in the agent source with:

- Explicit named pipe ACL.
- Helper-launch logging.
- Helper-mode direct logging.
- Relay error reporting when helper exits before pipe connection.

## Current Browser Route

The desktop viewer uses:

```text
web/app/remoteaccess/devices/[id]/desktop/page.tsx
```

It opens:

```text
/api/remoteaccess/ws/DEVICE_ID?sessionId=SESSION_ID
```

and draws JPEG frames to a canvas.

## Current Server Route

The backend WebSocket code in `server/src/wsServer.js`:

- Accepts agent WebSocket registration.
- Accepts browser remote desktop WebSocket requests.
- Validates remote-access cookie/session.
- Sends `remote-desktop-start` to the connected agent.
- Relays `RDF1` binary frames to browser clients.
- Sends browser input JSON to the agent as `remote-desktop-control`.
- Sends `remote-desktop-stop` when the last browser leaves a session.

## Current Agent Route

The agent WebSocket code in `agent/ws.go`:

- Handles `remote-desktop-start`.
- Starts `StartRemoteDesktopRelay`.
- Handles `remote-desktop-control`.
- Ignores legacy `remote-desktop-pending` pushes for the relay path.

The relay code:

- Creates a named pipe.
- Launches helper in active user session.
- Waits for helper connection.
- Publishes JPEG frames to the backend as `RDF1` binary messages.

## Known Active Working Tree

This repo has many uncommitted changes beyond these architecture docs. Do not assume a clean baseline.

The most important remote-desktop-related active changes are around:

```text
agent/desktop_pipe_windows.go
agent/helper_windows.go
agent/remote_desktop_relay.go
agent/session_launcher_windows.go
agent/ws.go
server/src/wsServer.js
server/src/remoteAccess/handlers.js
server/src/remoteDesktop/sessions.js
web/app/remoteaccess/devices/[id]/desktop/page.tsx
```

## Verification Done Locally

Server focused test:

```text
node --test src/remoteAccess/__tests__/remote_access.test.js
```

Result:

```text
22 tests passed
```

Full server test command:

```text
node --test
```

Result:

```text
72 passed, 1 failed
```

The failure was unrelated to remote desktop:

```text
email.test.js expected "Your SetuLink password was reset"
actual "Your NetraLink password was reset"
```

Go tests were not run in this Linux workspace because `go` and `gofmt` are not installed here.

## Next Verification Steps

On the Windows build machine:

```powershell
cd C:\fresh\agent
gofmt -w .
go test ./...
go build -o setulink-agent.exe .
```

Replace the installed service binary and restart:

```powershell
Stop-Service SetuLinkAgent -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Get-Process setulink-agent -ErrorAction SilentlyContinue | Stop-Process -Force

Copy-Item "C:\Program Files\SetuLink\setulink-agent.exe" "C:\Program Files\SetuLink\setulink-agent.exe.bak-relay" -Force
Copy-Item "C:\fresh\agent\setulink-agent.exe" "C:\Program Files\SetuLink\setulink-agent.exe" -Force

Start-Service SetuLinkAgent
```

Then click Connect and inspect:

```powershell
Select-String -Path "C:\ProgramData\SetuLink\logs\agent.log" -Pattern 'remote-desktop-relay-start|relay-start|helper-launch|helper-launched|helper-start|helper-pipe-connected|helper-connected|helper-pipe-connect-failed|did not connect|helper exited' |
  Select-Object -Last 60

Get-CimInstance Win32_Process -Filter "name = 'setulink-agent.exe'" |
  Select-Object ProcessId,SessionId,CommandLine
```

Expected during an active session:

```text
helper-connected
setulink-agent.exe --helper --pipe=... --session-id=...
```

