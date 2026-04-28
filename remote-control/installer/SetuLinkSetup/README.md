# SetuLink Windows Installer

This folder builds the production SetuLink Windows installer. The expected final output is:

```text
installer\SetuLinkSetup\dist\SetuLinkSetup.exe
```

The installer deploys the agent as a Windows service, writes runtime config under ProgramData, validates service startup, and records diagnostics in installer and agent logs.

## Prerequisites

- Windows build machine
- PowerShell 5.1 or newer
- Go installed and available on `PATH`
- Inno Setup 6 installed, or pass `-InnoSetupCompiler`
- Windows ffmpeg runtime staged under `assets\ffmpeg\`, including `ffmpeg.exe`
  and any DLLs required by the chosen build

## Build

From this folder:

```powershell
.\build.ps1 -Clean
```

The default backend API URL is:

```text
https://netraapi.shivomsangha.com
```

To override the baked backend URL for another environment:

```powershell
.\build.ps1 -Clean -DefaultBackendURL "https://netraapi.shivomsangha.com" -Version "0.1.0"
```

`build.ps1` is the single clean build entrypoint. It always:

- rebuilds `setulink-agent.exe` from the nearest repository root containing `agent\go.mod`
- rebuilds `SetuLinkInstallerBootstrap.exe` from `src`
- copies fresh binaries into `assets`
- verifies bundled ffmpeg exists under `assets\ffmpeg\ffmpeg.exe`
- verifies `build` and `assets` binary SHA256 values match
- prints the full path, SHA256, and file size for each packaged asset:
  `assets\setulink-agent.exe`, `assets\SetuLinkInstallerBootstrap.exe`,
  `assets\setulink-updater.exe`, and `assets\ffmpeg\ffmpeg.exe`
- compiles `dist\SetuLinkSetup.exe` with Inno Setup

It does not silently reuse stale assets. If Go, Inno Setup, or bundled ffmpeg is missing, the build fails.

### Packaging-only build

If the Windows machine only has this `SetuLinkSetup` folder and not the full repo, packaging-only mode is supported:

```powershell
.\build.ps1 -Clean -SkipAgentBuild -SkipBootstrapBuild -SkipUpdaterBuild
```

This mode does not rebuild source. It requires these files to already exist first:

```text
assets\setulink-agent.exe
assets\SetuLinkInstallerBootstrap.exe
assets\setulink-updater.exe
assets\ffmpeg\ffmpeg.exe
```

The build output says `packaging-only`, stages those existing assets into `build\`, and still prints full path, SHA256, and size for each packaged asset. Treat the printed asset report as the proof of which binaries were packaged.

## Install

Run the final installer as administrator:

```powershell
.\dist\SetuLinkSetup.exe
```

To override the backend URL at install time:

```powershell
.\dist\SetuLinkSetup.exe /BACKENDURL="https://netraapi.shivomsangha.com"
```

The backend URL must point to the API host. The installer rejects obvious frontend-host misuse such as:

```text
https://netralink.shivomsangha.com
```

The bootstrap also performs a lightweight health probe against:

```text
<backend-url>/health
```

If the probe fails, installation stops before writing a broken config.

## Installed Layout

```text
C:\Program Files\SetuLink\
  setulink-agent.exe
  setulink-updater.exe
  ffmpeg\
    ffmpeg.exe
    <required ffmpeg DLLs, if any>

C:\ProgramData\SetuLink\
  config\
    agent.json
  logs\
    installer.log
    agent.log
  files\
  data\
  temp\
  device.json
```

## Fresh Install Behavior

On a fresh machine, the installer:

- creates the Program Files and ProgramData directories
- writes `C:\ProgramData\SetuLink\config\agent.json`
- copies bundled ffmpeg into `C:\Program Files\SetuLink\ffmpeg\`
- installs or updates the `SetuLinkAgent` Windows service
- configures service recovery to restart after the first, second, and third failure, resetting the failure count after one day
- starts the service
- validates that the service is installed, the service is running, service-mode startup reaches registration or heartbeat, and bundled ffmpeg exists at `C:\Program Files\SetuLink\ffmpeg\ffmpeg.exe`

The generated config contains both `backendUrl` and `serverUrl` for compatibility with the current agent. The agent creates its own persistent `device.json`.

## Reinstall / Repair Behavior

Rerunning the installer is a repair/update pass:

- stops the existing service when needed
- stops stray `setulink-agent.exe` processes
- replaces the installed binary with the freshly bundled binary
- copies the bundled ffmpeg runtime into `C:\Program Files\SetuLink\ffmpeg\`
- preserves a valid existing backend config unless `/BACKENDURL=...` is supplied
- preserves valid `device.json`
- lets the agent back up and regenerate malformed or invalid `device.json`
- reconfigures service recovery and restarts the service

## Logs

Installer log:

```text
C:\ProgramData\SetuLink\logs\installer.log
```

Agent log:

```text
C:\ProgramData\SetuLink\logs\agent.log
```

The installer log includes selected backend URL source, backend health probe result, config path written, binary copy details, ffmpeg source path, ffmpeg destination path, ffmpeg source existence, number of ffmpeg files copied, post-copy `ffmpeg.exe` verification, service install/config/start details, validation result, and recent agent log text when service startup fails.

The Windows service wrapper writes fatal startup errors and panics to `agent.log`. Early agent startup also writes:

- `binary-identity`, with executable path, config version, binary size, and binary modified time
- `remote-desktop-capability`, with capability state, ffmpeg path, ffmpeg source (`bundled`, `system`, `missing`, or `unsupported`), and readiness reason

Example structured log shape:

```json
{"component":"runtime","action":"remote-desktop-capability","message":"remote desktop capability summary","metadata":{"remoteDesktopCapabilityState":"ready","ffmpegPath":"C:\\Program Files\\SetuLink\\ffmpeg\\ffmpeg.exe","ffmpegSource":"bundled","reason":"Windows JPEG capture and websocket relay runtime ready"}}
```

## Fresh Windows Test Flow

1. Restore the clean Windows snapshot.
2. Copy one fresh `SetuLinkSetup` folder to the machine.
3. Confirm `assets\ffmpeg\ffmpeg.exe` is present before building.
4. Build with `.\build.ps1 -Clean`, or use packaging-only mode with all skip flags when this folder already contains all required packaged assets.
5. Run `.\dist\SetuLinkSetup.exe` as Administrator.
6. Verify `C:\Program Files\SetuLink\ffmpeg\ffmpeg.exe`, service state, agent startup capability logging, and that the remote portal reflects readiness honestly.

## Verification

Fresh install:

```powershell
Test-Path "C:\Program Files\SetuLink\ffmpeg\ffmpeg.exe"
& "C:\Program Files\SetuLink\ffmpeg\ffmpeg.exe" -version
sc.exe query SetuLinkAgent
Get-Content "C:\ProgramData\SetuLink\config\agent.json"
Get-Content "C:\ProgramData\SetuLink\logs\installer.log" -Tail 120
Get-Content "C:\ProgramData\SetuLink\logs\agent.log" -Tail 200
Select-String -Path "C:\ProgramData\SetuLink\logs\agent.log" -Pattern "ffmpeg|remote-desktop|capability|desktop"
Invoke-RestMethod "https://netraapi.shivomsangha.com/health"
```

Reinstall:

```powershell
.\dist\SetuLinkSetup.exe /BACKENDURL="https://netraapi.shivomsangha.com"
Get-Content "C:\ProgramData\SetuLink\logs\installer.log" -Tail 160
Get-Content "C:\ProgramData\SetuLink\logs\agent.log" -Tail 160
sc.exe query SetuLinkAgent
```

After either install path, the device should appear online in the SetuLink dashboard.
