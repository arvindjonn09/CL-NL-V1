# Smoke Test Procedure

Last reviewed for Phase 5.

Use this as a repeatable smoke test before release or after installer, agent, recovery, or upgrade changes.

## Preconditions

- Windows test device with Administrator access.
- Backend API reachable from the test device.
- Built installer at `installer\SetuLinkSetup\dist\SetuLinkSetup.exe`.
- Admin access to trigger device actions.

## Fresh Install Test

1. Run installer as Administrator:

```powershell
cd installer\SetuLinkSetup
.\dist\SetuLinkSetup.exe /BACKENDURL="https://setuapi.shivomsangha.com"
```

Expected result: installation completes.

If this fails: inspect `C:\ProgramData\SetuLink\logs\installer.log`.

2. Verify service:

```powershell
sc.exe query SetuLinkAgent
```

Expected result: service exists and is running.

3. Verify recovery policy:

```powershell
sc.exe qfailure SetuLinkAgent
sc.exe qfailureflag SetuLinkAgent
```

Expected result: restart actions are configured and reset period is one day.

## Heartbeat Test

1. Check logs:

```powershell
Get-Content "C:\ProgramData\SetuLink\logs\agent.log" -Tail 160
```

Expected result: startup checks, registration, and heartbeat logs appear.

2. Check admin UI or device API.

Expected result: device is online and health label is `Healthy`.

If this fails: check backend `/health`, config backend URL, and heartbeat errors.

## Backend Outage And Recovery Test

1. Temporarily block backend access from the test device or stop the test backend.

Expected result: heartbeat/backend failures appear in `agent.log`; diagnostics eventually show degraded state after repeated failures.

2. Restore backend access.

Expected result: the device moves through `Recovery in progress` and returns to `Healthy` after successful heartbeats.

If this fails: check recovery logs and `diagnosticsHeartbeatFailureCount`.

## Staged Upgrade Test

1. Configure server upgrade environment variables:

```text
UPGRADE_VERSION
UPGRADE_DOWNLOAD_URL
UPGRADE_SHA256
UPGRADE_SIZE_BYTES
```

2. Trigger action:

```text
check-upgrade
```

Expected result: action succeeds and reports staged upgrade paths.

If this fails: inspect `agent.log` component `upgrade`.

## Apply Upgrade Test

1. Trigger action:

```text
apply-staged-upgrade
```

Expected result: service briefly disconnects, updater helper replaces the binary, service restarts, startup checks pass, and upgrade status becomes `success`.

2. Confirm version:

Expected result: admin device metadata shows the expected `agentVersion` after heartbeat.

## Rollback Test

1. Stage an upgrade in a controlled test environment.
2. Force startup checks to fail after apply, for example by applying a test binary/config combination that cannot pass startup checks.
3. Trigger `apply-staged-upgrade`.

Expected result: upgrade state becomes `rollback-requested`, updater helper restores the backup binary, and the service restarts.

If this fails: inspect:

```powershell
Get-Content "C:\ProgramData\SetuLink\temp\upgrade\upgrade-state.json"
Get-Content "C:\ProgramData\SetuLink\logs\agent.log" -Tail 240
```

## Service Recovery Verification Test

1. Confirm service recovery policy:

```powershell
sc.exe qfailure SetuLinkAgent
sc.exe qfailureflag SetuLinkAgent
```

Expected result: first, second, and third failures restart the service; reset period is one day.

2. In a disposable test VM, stop the agent process unexpectedly rather than using normal service stop.

Expected result: Windows service recovery restarts `SetuLinkAgent`.

If this fails: rerun installer repair and verify recovery policy again.

