# Recovery Runbook

Last reviewed for Phase 5.

This runbook explains automatic recovery behavior and when a human should intervene.

## Degraded

`Degraded` means the agent or backend diagnostics report a problem while the device may still be online. Common causes include repeated backend failures, recent operational errors, startup warnings, or watchdog attention.

Expected result: diagnostics include a reason such as backend failure, agent reported degraded mode, or operator attention needed.

If this persists: inspect `agent.log`, diagnostics, and backend connectivity.

## Recovery In Progress

`Recovery in progress` means the agent was degraded and has seen successful backend contact. The agent waits for stability before returning to normal.

Expected result: the status returns to `Healthy` after subsequent successful heartbeats.

If this persists: treat the device as degraded and check repeated backend failures.

## Operator Attention Needed

The watchdog sets operator attention when thresholds are exceeded. It is a signal to investigate, not an instruction to repeatedly restart the service.

Reasons can include:

- repeated backend/heartbeat failures
- repeated command worker failures
- repeated file worker failures
- excessive repair attempts
- prolonged degraded state
- stuck or unhealthy runtime loops

Expected result: diagnostics contain `operator_attention_needed: true` and `watchdog.reasons`.

If this appears: inspect the first watchdog reason, then check the matching subsystem logs.

## What The Watchdog Does

The watchdog:

1. Records backend request success and failure.
2. Records command worker success and failure.
3. Records file worker success and failure.
4. Records loop heartbeats for runtime loops.
5. Logs periodic health summaries.
6. Marks operator attention when thresholds are crossed.
7. Runs safe repairs only with cooldown and max-attempt caps.
8. Requests stronger escalation only after escalation thresholds are crossed.

## Automatic Repairs

The watchdog safe repair is intentionally bounded. It can:

- recreate runtime directories
- clear stale temp downloads older than 24 hours
- rebuild the agent HTTP client

Expected result: repair attempts are logged by the `watchdog` component and counted in diagnostics.

If repairs reach the cap: operator attention remains and escalation is requested. Investigate the underlying cause.

## When A Human Should Intervene

Intervene when:

- device is `Offline`
- `Operator attention needed` is present
- watchdog escalation is requested
- service repeatedly stops
- upgrade rollback is requested
- command or file failures repeat after backend connectivity is healthy
- startup checks block service startup

First actions:

```powershell
sc.exe query SetuLinkAgent
Get-Content "C:\ProgramData\SetuLink\logs\agent.log" -Tail 200
Get-Content "C:\ProgramData\SetuLink\logs\installer.log" -Tail 120
Invoke-RestMethod "https://setuapi.shivomsangha.com/health"
```

## Windows Service Recovery Policy

The installer configures Windows Service Control Manager recovery for `SetuLinkAgent`.

Policy:

- first failure: restart service
- second failure: restart service
- third failure: restart service
- reset failure count after one day

Verify:

```powershell
sc.exe qfailure SetuLinkAgent
sc.exe qfailureflag SetuLinkAgent
```

Expected result: restart actions are present with a one-day reset period.

If this fails: rerun the installer or repair install. Do not rely on manual recovery settings as the source of truth.

