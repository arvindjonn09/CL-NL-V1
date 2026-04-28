# Failure Scenarios

Last reviewed for Phase 5.

Use these tests in a controlled environment. Do not run destructive scenarios on a production device unless you have an approved maintenance window.

## Deliberate Backend Outage

1. Block the backend API from the device or stop the test backend.
2. Wait for several heartbeat attempts.
3. Check logs:

```powershell
Get-Content "C:\ProgramData\SetuLink\logs\agent.log" -Tail 200
```

Expected result: heartbeat/backend failures are logged. Recovery state becomes degraded after repeated failures. Watchdog may eventually mark operator attention if thresholds are exceeded.

If this fails: confirm the device is using the backend you blocked and that heartbeats were running before the outage.

## Bad Checksum Manifest

1. Set `UPGRADE_SHA256` to a value that does not match the upgrade binary.
2. Trigger:

```text
check-upgrade
```

Expected result: staging fails during verification. The existing agent binary remains in place. Upgrade does not apply.

If this fails: verify the manifest was served by `GET /api/admin/upgrades/manifest`.

## Bad Upgrade Binary

1. Serve a binary that downloads and matches the configured checksum but cannot pass startup checks in the test environment.
2. Trigger `check-upgrade`.
3. Trigger `apply-staged-upgrade`.

Expected result: updater helper applies the staged binary, startup checks fail, rollback is requested, and the backup binary is restored.

If this fails: check `C:\ProgramData\SetuLink\temp\upgrade\upgrade-state.json` and `agent.log`.

## Missing Or Invalid Config

1. In a test VM, stop the service:

```powershell
sc.exe stop SetuLinkAgent
```

2. Rename or corrupt:

```text
C:\ProgramData\SetuLink\config\agent.json
```

3. Start the service:

```powershell
sc.exe start SetuLinkAgent
```

Expected result: startup fails with a config error in `agent.log`. The device goes offline if heartbeats stop.

If this fails: confirm the service is using the normal install config path and not portable mode.

Recovery: rerun the installer repair path to regenerate valid config.

## Stale Temp File Cleanup

1. Create an old temp download file under:

```text
C:\ProgramData\SetuLink\temp
```

Use a name beginning with:

```text
.download-
```

2. Ensure its modified time is older than 24 hours.
3. Restart the service or trigger watchdog safe repair by using a controlled threshold test.

Expected result: stale `.download-*` temp files older than 24 hours are removed. A cleanup log entry appears when files are removed.

If this fails: confirm the filename prefix and modified time.

## Repeated Worker Failures Leading To Operator Attention

1. In a controlled test, cause repeated command worker request failures or file worker failures.
2. Wait for watchdog evaluation.
3. Check diagnostics and logs.

Expected result: diagnostics include:

```text
operator_attention_needed: true
watchdog.state: operator-attention-needed
```

Reasons may include:

```text
repeated command worker failures
repeated file worker failures
```

If thresholds continue to be exceeded or repair attempts hit the cap, expected result changes to:

```text
watchdog.state: escalation-requested
```

If this fails: confirm the failures are consecutive. Successful worker polls reset the matching worker failure counter.

## Service Recovery Failure

1. Verify recovery policy:

```powershell
sc.exe qfailure SetuLinkAgent
sc.exe qfailureflag SetuLinkAgent
```

2. In a disposable VM, terminate the service process unexpectedly.

Expected result: Windows restarts `SetuLinkAgent` according to service recovery policy.

If this fails: rerun the installer. The installer is responsible for applying service recovery settings on fresh install and repair/update.

