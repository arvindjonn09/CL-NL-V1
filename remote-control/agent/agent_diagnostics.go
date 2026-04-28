package main

import agentdiagnostics "remote-control-agent/internal/diagnostics"

func buildDiagnosticSnapshot(cfg *Config) agentdiagnostics.Snapshot {
	runtimeInfo, lastCommand, lastFile, _ := snapshotHealth()
	startupChecks := snapshotStartupChecks()
	recoverySummary := snapshotRecoverySummary()
	watchdogSummary := snapshotWatchdogSummary()

	return agentdiagnostics.BuildSnapshot(agentdiagnostics.RuntimeInput{
		DeviceID:       cfg.DeviceID,
		Hostname:       cfg.Hostname,
		Username:       cfg.Username,
		RunMode:        runtimeInfo.RunMode,
		Version:        cfg.Version,
		ExecutablePath: runtimeInfo.ExecutablePath,
		ConfigPath:     cfg.ConfigPath,
		LogPath:        cfg.LogPath,
		BackendURL:     cfg.ServerURL,
		ServiceName:    serviceNameForRunMode(runtimeInfo.RunMode),
		StartupAt:      runtimeInfo.StartupAt,
		StartupChecks:  diagnosticStartupSummary(startupChecks),
		Recovery: agentdiagnostics.RecoverySummary{
			State:                        recoverySummary.State,
			Degraded:                     recoverySummary.Degraded,
			ConsecutiveBackendFailures:   recoverySummary.ConsecutiveBackendFailures,
			LastSuccessfulBackendContact: recoverySummary.LastSuccessfulBackendContact,
			DegradedReason:               recoverySummary.DegradedReason,
		},
		Watchdog: agentdiagnostics.WatchdogSummary{
			State:                      watchdogSummary.State,
			OperatorAttentionNeeded:    watchdogSummary.OperatorAttentionNeeded,
			EscalationRequested:        watchdogSummary.EscalationRequested,
			Reasons:                    append([]string(nil), watchdogSummary.Reasons...),
			ConsecutiveBackendFailures: watchdogSummary.ConsecutiveBackendFailures,
			ConsecutiveCommandFailures: watchdogSummary.ConsecutiveCommandFailures,
			ConsecutiveFileFailures:    watchdogSummary.ConsecutiveFileFailures,
			RepairAttempts:             watchdogSummary.RepairAttempts,
			MaxRepairAttempts:          watchdogSummary.MaxRepairAttempts,
			LastRepairAt:               watchdogSummary.LastRepairAt,
			NextRepairAfter:            watchdogSummary.NextRepairAfter,
			DegradedSince:              watchdogSummary.DegradedSince,
			DegradedDurationSeconds:    watchdogSummary.DegradedDurationSeconds,
			UnhealthyRuntimeLoops:      append([]string(nil), watchdogSummary.UnhealthyRuntimeLoops...),
		},
		LastCommand: diagnosticOperationView(lastCommand),
		LastFile:    diagnosticOperationView(lastFile),
		Upgrade:     diagnosticUpgradeSummary(cfg),
	})
}

func serviceNameForRunMode(runMode string) string {
	if runMode == "windows-service" {
		return serviceName
	}
	return ""
}

func diagnosticStartupSummary(summary *StartupCheckSummary) *agentdiagnostics.StartupSummary {
	if summary == nil {
		return nil
	}
	return &agentdiagnostics.StartupSummary{
		Passed:   summary.Passed,
		Failed:   append([]string(nil), summary.Failed...),
		Warnings: append([]string(nil), summary.Warnings...),
		At:       summary.At,
	}
}

func diagnosticOperationView(summary *OperationSummary) *agentdiagnostics.OperationView {
	if summary == nil {
		return nil
	}
	return &agentdiagnostics.OperationView{
		Status: summary.Status,
		At:     summary.At,
	}
}

func diagnosticUpgradeSummary(cfg *Config) *agentdiagnostics.UpgradeSummary {
	summary := upgradeRuntimeSummary(cfg)
	if summary.Status == "" {
		return nil
	}
	return &agentdiagnostics.UpgradeSummary{
		Status:  summary.Status,
		Version: summary.Version,
		Reason:  summary.Reason,
	}
}
