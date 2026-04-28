# Troubleshooting Runbook

Last reviewed for Phase 5.

Use this for first response when a device is not healthy.

## Important Status Labels

- `Healthy`: recent heartbeat and diagnostics are normal.
- `Offline`: the backend has not seen a recent heartbeat.
- `Degraded`: diagnostics or recent operational errors show a problem.
- `Recovery in progress`: connectivity recently recovered and the agent is confirming stability.
- `Operator attention needed`: the watchdog crossed an attention threshold.
- `Upgrade pending`: an approved upgrade is pending or reported by diagnostics.
- `Stale`: heartbeat is older than expected but not yet offline.

## Logs

Installer log:

```text
C:\ProgramData\SetuLink\logs\installer.log
```

Agent log:

```text
C:\ProgramData\SetuLink\logs\agent.log
```

Read recent logs:

```powershell
Get-Content "C:\ProgramData\SetuLink\logs\agent.log" -Tail 160
Get-Content "C:\ProgramData\SetuLink\logs\installer.log" -Tail 160
```

Expected result: logs are structured and include component names such as `startup`, `heartbeat`, `registration`, `recovery`, `watchdog`, `commands`, `files`, or `upgrade`.

## Device Offline

1. Check the service:

```powershell
sc.exe query SetuLinkAgent
```

Expected result: `STATE : 4 RUNNING`.

If this fails: start the service or rerun the installer:

```powershell
sc.exe start SetuLinkAgent
```

2. Check backend connectivity:

```powershell
Invoke-RestMethod "https://setuapi.shivomsangha.com/health"
```

Expected result: backend health responds.

If this fails: fix DNS, firewall, proxy, TLS, or backend availability.

3. Check agent log for heartbeat errors:

```powershell
Get-Content "C:\ProgramData\SetuLink\logs\agent.log" -Tail 160
```

Expected result: heartbeat errors identify request, status, or connectivity problems.

## Degraded State

1. Check admin health reason and diagnostics.
2. Check `diagnosticsDegradedReason` or latest diagnostics JSON.
3. Check `agent.log` for `recovery` and `watchdog` entries.

Expected result: the reason points to backend failures, startup warnings, worker failures, or watchdog attention.

If this fails: request a `runtime-log-snapshot` action from the admin action path and inspect the result payload.

## Recovery In Progress

This means the agent was degraded and has seen backend success. It remains in recovery briefly until stability is confirmed.

1. Wait for the next heartbeat interval.
2. Refresh admin health.
3. Check `agent.log` for recovery transition logs.

Expected result: status returns to `Healthy` after stable backend contact.

If this persists: treat it as degraded and inspect heartbeat, backend connectivity, and diagnostics.

## Operator Attention Needed

The watchdog sets this when thresholds are crossed, such as repeated backend failures, repeated command worker failures, repeated file worker failures, prolonged degraded state, excessive repair attempts, or stale runtime loops.

1. Check device diagnostics for `watchdog.reasons`.
2. Check agent logs:

```powershell
Get-Content "C:\ProgramData\SetuLink\logs\agent.log" -Tail 200
```

Expected result: `watchdog` entries show summary, safe repair, or escalation reasons.

If this fails: restart the service once and monitor. If the same reason returns, investigate the named subsystem instead of repeatedly restarting.

## Command Dispatch Issues

1. Confirm the device is online.
2. Confirm pending action or command is supported.
3. Check agent log component `commands`.
4. Check recent admin action status.

Supported admin action names include:

```text
force-heartbeat
restart-service
refresh-metadata
runtime-log-snapshot
check-upgrade
apply-staged-upgrade
```

Expected result: commands are fetched, executed, and results are posted.

If this fails: check backend request errors, action result post errors, and watchdog command worker failure counts.

## File Transfer Issues

1. Confirm the device is online.
2. Confirm `C:\ProgramData\SetuLink\files` exists and is writable.
3. Check agent log component `files`.
4. Check whether file download URL is reachable from the device.

Expected result: file jobs are downloaded into the configured files directory and completion is posted.

If this fails: inspect download errors, file write errors, and file complete/failed status post errors.

