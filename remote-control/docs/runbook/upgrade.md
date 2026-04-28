# Upgrade Runbook

Last reviewed for Phase 5.

SetuLink upgrades use an approved manifest served by the backend. The agent stages the new binary, verifies checksum and size, backs up the current binary, and applies the staged binary through `setulink-updater.exe`.

## Manifest Environment Variables

Set these on the server process before approving an upgrade:

```text
UPGRADE_VERSION
UPGRADE_DOWNLOAD_URL
UPGRADE_SHA256
UPGRADE_SIZE_BYTES
```

Optional:

```text
UPGRADE_MIN_COMPATIBLE_VERSION
```

Expected result: authenticated agents can fetch a manifest from:

```text
GET /api/agent/upgrades/manifest
```

Authenticated admins can inspect the approved manifest at:

```text
GET /api/admin/upgrades/manifest
```

If this fails: verify all required environment variables are set and `UPGRADE_DOWNLOAD_URL` is an HTTP or HTTPS URL.

## Stage An Upgrade

1. Confirm the device is online and healthy.

Expected result: health label is `Healthy` or the operator has accepted the current risk.

2. Trigger the admin action:

```text
check-upgrade
```

Expected result: the agent fetches the manifest, downloads the binary, verifies SHA256 and size, stages it under `C:\ProgramData\SetuLink\temp\upgrade`, and records upgrade status.

If this fails: check `agent.log` component `upgrade` for manifest, download, verify, or stage errors.

## Apply A Staged Upgrade

1. Confirm staging succeeded.

Expected result: `check-upgrade` action result reports `upgrade staged` and includes staged and backup paths.

2. Trigger the admin action:

```text
apply-staged-upgrade
```

Expected result: the agent starts `setulink-updater.exe`, writes upgrade state, replaces the binary, and restarts the Windows service. A brief disconnect is expected.

If this fails: check `agent.log`, `C:\ProgramData\SetuLink\temp\upgrade\upgrade-state.json`, and service state.

## Confirm Upgrade Success

1. Check service state:

```powershell
sc.exe query SetuLinkAgent
```

Expected result: service is running.

2. Check agent logs:

```powershell
Get-Content "C:\ProgramData\SetuLink\logs\agent.log" -Tail 200
```

Expected result: startup checks pass and upgrade is marked `success`.

3. Check admin device metadata.

Expected result: `agentVersion` reflects the upgraded version after heartbeat.

## Rollback Behavior

After an upgrade apply, the agent starts with upgrade state `applied-pending-startup`. If startup checks fail, the agent marks rollback requested and starts the updater helper to swap the backup binary back into place.

Expected result: upgrade status is reported as `rollback-requested`, service restarts, and the previous binary is restored.

If this fails: inspect `upgrade-state.json`, `agent.log`, and service state. Do not delete the backup or staged files until you understand the failure.

## Post-Upgrade Operator Checks

1. Service is running.
2. Heartbeat resumes.
3. Health label returns to `Healthy`.
4. `agentVersion` is the expected version.
5. `agent.log` has no repeated startup, recovery, or watchdog escalation entries.
6. Windows service recovery policy is still present:

```powershell
sc.exe qfailure SetuLinkAgent
sc.exe qfailureflag SetuLinkAgent
```

