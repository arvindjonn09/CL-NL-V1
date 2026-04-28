# Install Runbook

Last reviewed for Phase 5.

Use this procedure to build, install, and verify a SetuLink Windows agent.

## Build The Installer

1. Open PowerShell on a Windows build machine.

2. Go to the installer folder:

```powershell
cd installer\SetuLinkSetup
```

3. Build a clean installer:

```powershell
.\build.ps1 -Clean
```

Expected result: `dist\SetuLinkSetup.exe` exists. The script rebuilds the agent, bootstrap installer, updater helper, verifies bundled ffmpeg under `assets\ffmpeg\ffmpeg.exe`, verifies asset hashes, and compiles the Inno Setup installer.

The build output must print full path, SHA256, and file size for each packaged asset:

```text
assets\setulink-agent.exe
assets\SetuLinkInstallerBootstrap.exe
assets\setulink-updater.exe
assets\ffmpeg\ffmpeg.exe
```

If this fails: install Go, install Inno Setup 6, pass `-InnoSetupCompiler` with the path to `ISCC.exe`, or place a trusted Windows ffmpeg build under `installer\SetuLinkSetup\assets\ffmpeg\`. At minimum this folder must contain `ffmpeg.exe`; include required DLLs if the chosen build is not fully static.

4. To bake a different backend API URL:

```powershell
.\build.ps1 -Clean -DefaultBackendURL "https://netraapi.shivomsangha.com" -Version "0.1.0"
```

Expected result: the installer is built with the API host as the default backend URL.

If this fails: make sure the URL points to the API host, not the dashboard host.

## Packaging-Only Build

If the Windows test machine only has the `SetuLinkSetup` folder and not the full repo, packaging-only mode remains supported:

```powershell
.\build.ps1 -Clean -SkipAgentBuild -SkipBootstrapBuild -SkipUpdaterBuild
```

Expected result: the script clearly reports `packaging-only`, does not claim a source rebuild, requires all packaged assets to exist first, stages them into `build\`, verifies each by SHA256, and compiles `dist\SetuLinkSetup.exe`.

Required files before running packaging-only mode:

```text
assets\setulink-agent.exe
assets\SetuLinkInstallerBootstrap.exe
assets\setulink-updater.exe
assets\ffmpeg\ffmpeg.exe
```

## Run The Installer

1. Run the installer as Administrator:

```powershell
.\dist\SetuLinkSetup.exe
```

2. To override the backend URL at install time:

```powershell
.\dist\SetuLinkSetup.exe /BACKENDURL="https://netraapi.shivomsangha.com"
```

Expected result: the installer probes `<backend-url>/health`, writes config, copies bundled ffmpeg to `C:\Program Files\SetuLink\ffmpeg\`, installs or updates `SetuLinkAgent`, starts the service, and validates service installation, service running state, registration or heartbeat, and installed bundled ffmpeg.

If this fails: open `C:\ProgramData\SetuLink\logs\installer.log` and check the backend probe, service install, and service validation entries.

## Fresh Windows Snapshot Test

1. Restore the clean Windows snapshot.
2. Copy one fresh `SetuLinkSetup` folder to Windows.
3. Confirm bundled ffmpeg is present:

```powershell
Test-Path ".\assets\ffmpeg\ffmpeg.exe"
```

4. Build the installer:

```powershell
.\build.ps1 -Clean
```

Use packaging-only mode only when all required `assets\...` binaries already exist and this machine does not have the full repo.

5. Run the installer as Administrator:

```powershell
.\dist\SetuLinkSetup.exe
```

6. Verify installed ffmpeg, service state, startup capability logging, and portal readiness.

## Expected Paths

Installed binaries:

```text
C:\Program Files\SetuLink\
  setulink-agent.exe
  setulink-updater.exe
  ffmpeg\
    ffmpeg.exe
    <required ffmpeg DLLs, if any>
```

Runtime files:

```text
C:\ProgramData\SetuLink\
  config\agent.json
  logs\installer.log
  logs\agent.log
  files\
  data\
  temp\
  device.json
```

## Verify Service Installation

1. Check the service:

```powershell
sc.exe query SetuLinkAgent
```

Expected result: the service exists and normally shows `STATE : 4 RUNNING`.

If this fails: rerun the installer as Administrator and check `installer.log`.

2. Check service recovery policy:

```powershell
sc.exe qfailure SetuLinkAgent
sc.exe qfailureflag SetuLinkAgent
```

Expected result: reset period is one day (`86400` seconds) and failure actions restart the service for the first, second, and third failure. `qfailureflag` should show the failure flag enabled when supported by Windows.

If this fails: rerun the installer or repair install. Recovery policy is configured by installer logic, not by manual post-install steps.

## Verify Logs And First Heartbeat

1. Check the installer log:

```powershell
Get-Content "C:\ProgramData\SetuLink\logs\installer.log" -Tail 160
```

Expected result: entries show backend URL selection, backend health probe success, config write, service install/config/start, service recovery configuration, and validation success.

The installer log should also show:

```text
ffmpeg source path: ...
ffmpeg destination path: C:\Program Files\SetuLink\ffmpeg
ffmpeg source exists: true
number of ffmpeg files copied: ...
post-copy ffmpeg verification path: C:\Program Files\SetuLink\ffmpeg\ffmpeg.exe
```

2. Check the agent log:

```powershell
Get-Content "C:\ProgramData\SetuLink\logs\agent.log" -Tail 200
```

Expected result: structured JSON log entries show binary identity, startup checks, remote desktop capability, registration, service mode, and heartbeat activity.

The startup capability log should have this shape:

```json
{"component":"runtime","action":"remote-desktop-capability","message":"remote desktop capability summary","metadata":{"remoteDesktopCapabilityState":"ready","ffmpegPath":"C:\\Program Files\\SetuLink\\ffmpeg\\ffmpeg.exe","ffmpegSource":"bundled","reason":"Windows JPEG capture and websocket relay runtime ready"}}
```

3. Check backend health from the device:

```powershell
Invoke-RestMethod "https://netraapi.shivomsangha.com/health"
```

Expected result: the backend responds successfully.

If this fails: check DNS, TLS, firewall/proxy, and the configured backend URL in `C:\ProgramData\SetuLink\config\agent.json`.

## Fresh Machine Verification Commands

Run these commands on the fresh Windows machine after install:

```powershell
Test-Path "C:\Program Files\SetuLink\ffmpeg\ffmpeg.exe"
& "C:\Program Files\SetuLink\ffmpeg\ffmpeg.exe" -version
sc.exe query SetuLinkAgent
Get-Content "C:\ProgramData\SetuLink\logs\installer.log" -Tail 120
Get-Content "C:\ProgramData\SetuLink\logs\agent.log" -Tail 200
Select-String -Path "C:\ProgramData\SetuLink\logs\agent.log" -Pattern "ffmpeg|remote-desktop|capability|desktop"
```
