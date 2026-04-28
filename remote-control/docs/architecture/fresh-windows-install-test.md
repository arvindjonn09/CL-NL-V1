# Fresh Windows Install Test

Use this when validating whether the current updated agent/server/browser relay code works on a clean Windows machine.

## Important Rule

Build from the updated source tree.

If the Windows machine pulls from GitHub, commit and push the current local changes first. If the Windows machine uses `C:\fresh`, copy the full updated repo there, not only an old `installer\SetuLinkSetup` folder.

The fresh installer must include these updated files:

```text
agent\desktop_pipe_windows.go
agent\helper_windows.go
agent\remote_desktop_relay.go
agent\session_launcher_windows.go
agent\ws.go
agent\main.go
server\src\wsServer.js
web\app\remoteaccess\devices\[id]\desktop\page.tsx
```

## Build On Windows

Open PowerShell as Administrator:

```powershell
cd C:\fresh\installer\SetuLinkSetup
.\build.ps1 -Clean -DefaultBackendURL "https://netraapi.shivomsangha.com"
```

Expected:

```text
dist\SetuLinkSetup.exe
```

The build output must show fresh SHA256 values for:

```text
assets\setulink-agent.exe
assets\SetuLinkInstallerBootstrap.exe
assets\setulink-updater.exe
assets\ffmpeg\ffmpeg.exe
```

## Remove Old Install State

For a true fresh test, remove the existing service and runtime folders first.

Run as Administrator:

```powershell
Stop-Service SetuLinkAgent -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Get-Process setulink-agent -ErrorAction SilentlyContinue | Stop-Process -Force
sc.exe delete SetuLinkAgent
Start-Sleep -Seconds 3

Remove-Item "C:\Program Files\SetuLink" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "C:\ProgramData\SetuLink" -Recurse -Force -ErrorAction SilentlyContinue
```

## Install Fresh

```powershell
cd C:\fresh\installer\SetuLinkSetup
.\dist\SetuLinkSetup.exe /BACKENDURL="https://netraapi.shivomsangha.com"
```

Expected:

```text
C:\Program Files\SetuLink\setulink-agent.exe
C:\Program Files\SetuLink\setulink-updater.exe
C:\Program Files\SetuLink\ffmpeg\ffmpeg.exe
C:\ProgramData\SetuLink\config\agent.json
C:\ProgramData\SetuLink\logs\agent.log
C:\ProgramData\SetuLink\logs\installer.log
```

## Verify Service

```powershell
Get-Service SetuLinkAgent
sc.exe query SetuLinkAgent
Get-Content "C:\ProgramData\SetuLink\logs\installer.log" -Tail 160
Get-Content "C:\ProgramData\SetuLink\logs\agent.log" -Tail 200
```

Expected:

```text
Status: Running
service-mode
startup-gate
initial-heartbeat
remote-desktop-capability
```

## Verify Binary Identity

```powershell
Get-FileHash "C:\fresh\installer\SetuLinkSetup\assets\setulink-agent.exe"
Get-FileHash "C:\Program Files\SetuLink\setulink-agent.exe"
```

Expected: hashes match.

## Test Remote Desktop

1. Sign in to the remote portal.
2. Open the device.
3. Click `Connect`.
4. Watch the logs:

```powershell
Select-String -Path "C:\ProgramData\SetuLink\logs\agent.log" -Pattern 'remote-desktop-relay-start|relay-start|helper-launch|helper-launched|helper-start|helper-pipe-connected|helper-connected|helper-pipe-connect-failed|did not connect|helper exited' |
  Select-Object -Last 80
```

Expected success sequence:

```text
remote-desktop-relay-start
relay-start
helper-launch-path
helper-launched
helper-start
helper-pipe-connected
helper-connected
```

During an active session:

```powershell
Get-CimInstance Win32_Process -Filter "name = 'setulink-agent.exe'" |
  Select-Object ProcessId,SessionId,CommandLine
```

Expected:

```text
one service process
one temporary --helper --pipe=... --session-id=... process
```

## If It Fails

If logs show:

```text
desktop helper did not connect to pipe: context deadline exceeded
```

check:

```powershell
Select-String -Path "C:\ProgramData\SetuLink\logs\agent.log" -Pattern 'helper-launch|helper-launched|helper-start|helper-pipe-connect-failed|helper exited|did not connect' |
  Select-Object -Last 80

Get-CimInstance Win32_Process -Filter "name = 'setulink-agent.exe'" |
  Select-Object ProcessId,SessionId,CommandLine
```

Interpretation:

```text
helper-launched missing       => CreateProcessAsUser/session launch issue
helper-start missing          => helper process did not enter helper mode or cannot log
helper-pipe-connect-failed    => helper started but pipe dial failed
helper-connected missing      => service never accepted helper pipe connection
```

