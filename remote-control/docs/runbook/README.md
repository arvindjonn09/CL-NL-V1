# SetuLink Runbook

Last reviewed for Phase 5.

This runbook is for operators who install, monitor, recover, and upgrade SetuLink agents. It covers the Windows service installer and the simpler Ubuntu systemd install path.

## Files

- [install.md](install.md): Build and run the Windows installer, verify service setup, logs, heartbeat, and service recovery.
- [linux-install.md](linux-install.md): Install the Ubuntu agent service and verify system or bundled ffmpeg detection.
- [device-onboarding.md](device-onboarding.md): Confirm a newly installed device has registered and is Healthy.
- [troubleshooting.md](troubleshooting.md): First-response steps for Offline, Degraded, Recovery in progress, Operator attention needed, command, and file issues.
- [origin-routing.md](origin-routing.md): Fixed public domain and local port routing rules. Check this before updates or deploys.
- [upgrade.md](upgrade.md): Prepare upgrade manifests, trigger `check-upgrade` and `apply-staged-upgrade`, and verify rollback or success.
- [recovery.md](recovery.md): Understand degraded/recovering states, watchdog behavior, automatic repairs, and Windows service recovery.

Testing procedures are under `docs/testing/`:

- [../testing/smoke-test.md](../testing/smoke-test.md): Repeatable release smoke test.
- [../testing/failure-scenarios.md](../testing/failure-scenarios.md): Deliberate failure tests and expected behavior.
