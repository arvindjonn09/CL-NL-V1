# Device Onboarding Runbook

Last reviewed for Phase 5.

Use this procedure after installing SetuLink on a new Windows device.

## What Happens During Onboarding

1. The installer writes `C:\ProgramData\SetuLink\config\agent.json`.
2. The installer creates or updates the `SetuLinkAgent` Windows service.
3. The installer configures Windows service recovery.
4. The service starts the agent in `windows-service` mode.
5. The agent runs startup checks.
6. The agent registers with the backend and sends heartbeats.
7. The backend stores runtime metadata, latest heartbeat, diagnostics, recovery state, and health labels.

Expected result: the device appears in the admin device list and moves to `Healthy` after a recent heartbeat and normal diagnostics.

## Healthy Device Checklist

1. Confirm the service is running:

```powershell
sc.exe query SetuLinkAgent
```

Expected result: `STATE : 4 RUNNING`.

If this fails: check `installer.log` and `agent.log`, then rerun the installer as Administrator if the service is missing.

2. Confirm the config exists:

```powershell
Get-Content "C:\ProgramData\SetuLink\config\agent.json"
```

Expected result: config contains `backendUrl`, `serverUrl`, runtime paths, version, and agent token.

If this fails: rerun the installer. Do not hand-create the service as a substitute for installer setup.

3. Confirm agent startup and heartbeat logs:

```powershell
Get-Content "C:\ProgramData\SetuLink\logs\agent.log" -Tail 120
```

Expected result: structured logs include startup checks, registration, and heartbeat entries.

If this fails: check for config errors, backend connectivity errors, or startup-gate failures.

4. Confirm the admin UI or admin API shows the device.

Expected result: health label is `Healthy`, connection status is online, run mode is `windows-service`, and service name is `SetuLinkAgent`.

If this fails: confirm the device ID in logs, verify backend reachability, and check `/api/admin/devices/:id/health` when authenticated.

## Admin Fields To Check First

- `healthLabel`: should be `Healthy`.
- `healthStatus`: should be `healthy`.
- `connectionStatus`: should be `online`.
- `runMode`: should be `windows-service`.
- `serviceName`: should be `SetuLinkAgent`.
- `diagnosticsDegraded`: should be false.
- `diagnosticsHeartbeatFailureCount`: should be low or zero.

## First-Response Checks

1. Check service state.
2. Check `agent.log`.
3. Check `installer.log` if install validation failed.
4. Check backend `/health` from the device.
5. Check admin health for the device.

