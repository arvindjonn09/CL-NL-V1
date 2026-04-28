package main

import (
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"

	agentrecovery "remote-control-agent/internal/recovery"
	agentwatchdog "remote-control-agent/internal/watchdog"
)

var (
	recoveryTracker *agentrecovery.Tracker
	agentWatchdog   *agentwatchdog.Monitor
	httpClientMu    sync.RWMutex
	agentHTTPClient = agentrecovery.RebuildHTTPClient(15 * time.Second)
)

func initRecoveryState(cfg *Config) {
	recoveryTracker = agentrecovery.NewTracker()
	agentWatchdog = agentwatchdog.NewDefaultMonitor()
	rebuildAgentHTTPClient(15 * time.Second)
	if err := repairRuntimeDirs(cfg); err != nil {
		logger("recovery").Warn("repair-dirs", "runtime directory repair failed", err, nil)
	}
	if removed, err := agentrecovery.ClearStaleTempDownloads(cfg.TempPath, 24*time.Hour); err != nil {
		logger("recovery").Warn("clear-temp", "stale temp cleanup failed", err, nil)
	} else if removed > 0 {
		logger("recovery").Info("clear-temp", "stale temp downloads cleared", logMetadata("removed", removed))
	}
}

func currentAgentHTTPClient() *http.Client {
	httpClientMu.RLock()
	defer httpClientMu.RUnlock()
	return agentHTTPClient
}

func rebuildAgentHTTPClient(timeout time.Duration) {
	httpClientMu.Lock()
	defer httpClientMu.Unlock()
	agentHTTPClient = agentrecovery.RebuildHTTPClient(timeout)
}

func repairRuntimeDirs(cfg *Config) error {
	return agentrecovery.RecreateMissingDirs(agentrecovery.RuntimeDirs{
		LogDir:   filepath.Dir(cfg.LogPath),
		DataDir:  cfg.DataPath,
		TempDir:  cfg.TempPath,
		FilesDir: cfg.FilesPath,
	})
}

func reloadAgentConfig(cfg *Config) (*Config, error) {
	nextCfg, err := LoadConfig(cfg.ConfigPath)
	if err != nil {
		return nil, err
	}
	return nextCfg, nil
}

func backendPolicyFor(method, url string) agentrecovery.Policy {
	switch {
	case strings.Contains(url, "/api/agent/heartbeat"):
		return agentrecovery.HeartbeatPolicy()
	case method == http.MethodGet:
		return agentrecovery.BackendPollPolicy()
	default:
		return agentrecovery.StatusUploadPolicy()
	}
}

func recoverySnapshot() agentrecovery.Snapshot {
	if recoveryTracker == nil {
		return agentrecovery.NewTracker().Snapshot()
	}
	return recoveryTracker.Snapshot()
}

func watchdogSnapshot() agentwatchdog.Status {
	if agentWatchdog == nil {
		return agentwatchdog.NewDefaultMonitor().Snapshot()
	}
	return agentWatchdog.Snapshot()
}

func recordWatchdogBackendSuccess() {
	if agentWatchdog != nil {
		agentWatchdog.RecordBackendSuccess()
	}
}

func recordWatchdogBackendFailure(err error) {
	if agentWatchdog != nil {
		agentWatchdog.RecordBackendFailure(err)
	}
}

func recordWatchdogCommandSuccess() {
	if agentWatchdog != nil {
		agentWatchdog.RecordCommandWorkerSuccess()
	}
}

func recordWatchdogCommandFailure(err error) {
	if agentWatchdog != nil {
		agentWatchdog.RecordCommandWorkerFailure(err)
	}
}

func recordWatchdogFileSuccess() {
	if agentWatchdog != nil {
		agentWatchdog.RecordFileWorkerSuccess()
	}
}

func recordWatchdogFileFailure(err error) {
	if agentWatchdog != nil {
		agentWatchdog.RecordFileWorkerFailure(err)
	}
}

func recordWatchdogLoop(name string) {
	if agentWatchdog != nil {
		agentWatchdog.RecordRuntimeLoop(name)
	}
}

func recordWatchdogDegradedState(snapshot agentrecovery.Snapshot) {
	if agentWatchdog != nil {
		agentWatchdog.RecordDegradedState(snapshot.Degraded, snapshot.DegradedReason)
	}
}

func evaluateWatchdog() agentwatchdog.Actions {
	if agentWatchdog == nil {
		return agentwatchdog.Actions{Status: watchdogSnapshot()}
	}
	return agentWatchdog.Evaluate()
}

func handleWatchdogActions(cfg *Config, actions agentwatchdog.Actions) {
	log := logger("watchdog")

	if actions.LogSummary {
		log.Info("summary", "watchdog health summary", logMetadata(
			"state", actions.Status.State,
			"operatorAttentionNeeded", actions.Status.OperatorAttentionNeeded,
			"escalationRequested", actions.Status.EscalationRequested,
			"reasons", actions.Status.Reasons,
			"backendFailures", actions.Status.ConsecutiveBackendFailures,
			"commandWorkerFailures", actions.Status.ConsecutiveCommandFailures,
			"fileWorkerFailures", actions.Status.ConsecutiveFileFailures,
			"repairAttempts", actions.Status.RepairAttempts,
			"unhealthyRuntimeLoops", actions.Status.UnhealthyRuntimeLoops,
		))
	}

	if actions.RunSafeRepair {
		log.Warn("safe-repair", "watchdog safe repair started", nil, logMetadata(
			"reason", actions.RepairReason,
			"attempt", actions.Status.RepairAttempts,
			"maxAttempts", actions.Status.MaxRepairAttempts,
		))
		if err := runWatchdogSafeRepair(cfg); err != nil {
			recordAgentError("watchdog-repair", err)
			log.Warn("safe-repair", "watchdog safe repair failed", err, logMetadata("reason", actions.RepairReason))
		} else {
			log.Info("safe-repair", "watchdog safe repair completed", logMetadata("reason", actions.RepairReason))
		}
	}

	if actions.RequestEscalation {
		log.Warn("escalation", "watchdog threshold exceeded; operator escalation requested", nil, logMetadata(
			"reasons", actions.OperatorReasons,
			"repairAttempts", actions.Status.RepairAttempts,
		))
	}
}

func runWatchdogSafeRepair(cfg *Config) error {
	if err := repairRuntimeDirs(cfg); err != nil {
		return err
	}
	if removed, err := agentrecovery.ClearStaleTempDownloads(cfg.TempPath, 24*time.Hour); err != nil {
		return err
	} else if removed > 0 {
		logger("watchdog").Info("safe-repair", "watchdog cleared stale temp downloads", logMetadata("removed", removed))
	}
	rebuildAgentHTTPClient(15 * time.Second)
	return nil
}
