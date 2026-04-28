package main

import (
	"os"
	"sync"
	"time"

	agenthealth "remote-control-agent/internal/health"
	agentrecovery "remote-control-agent/internal/recovery"
	agentwatchdog "remote-control-agent/internal/watchdog"
)

const serviceName = "SetuLinkAgent"

type OperationSummary struct {
	ID               string `json:"id,omitempty"`
	Command          string `json:"command,omitempty"`
	Filename         string `json:"filename,omitempty"`
	Status           string `json:"status,omitempty"`
	ExitCode         int    `json:"exitCode,omitempty"`
	ErrorMessage     string `json:"errorMessage,omitempty"`
	DurationMs       int64  `json:"durationMs,omitempty"`
	BytesTransferred int64  `json:"bytesTransferred,omitempty"`
	DestinationPath  string `json:"destinationPath,omitempty"`
	At               string `json:"at,omitempty"`
}

type AgentErrorSummary struct {
	Level   string `json:"level,omitempty"`
	Source  string `json:"source,omitempty"`
	Message string `json:"message,omitempty"`
	At      string `json:"at,omitempty"`
}

type AgentRuntime struct {
	RunMode        string
	StartupAt      time.Time
	ExecutablePath string
}

type StartupCheckSummary struct {
	Passed   bool
	Failed   []string
	Warnings []string
	At       string
}

type AgentRecoverySummary struct {
	State                        string     `json:"state"`
	Degraded                     bool       `json:"degraded"`
	ConsecutiveBackendFailures   int        `json:"consecutiveBackendFailures"`
	LastSuccessfulBackendContact *time.Time `json:"lastSuccessfulBackendContact,omitempty"`
	DegradedReason               string     `json:"degradedReason,omitempty"`
}

type AgentWatchdogSummary struct {
	State                      string     `json:"state"`
	OperatorAttentionNeeded    bool       `json:"operatorAttentionNeeded"`
	EscalationRequested        bool       `json:"escalationRequested"`
	Reasons                    []string   `json:"reasons,omitempty"`
	ConsecutiveBackendFailures int        `json:"consecutiveBackendFailures"`
	ConsecutiveCommandFailures int        `json:"consecutiveCommandWorkerFailures"`
	ConsecutiveFileFailures    int        `json:"consecutiveFileWorkerFailures"`
	RepairAttempts             int        `json:"repairAttempts"`
	MaxRepairAttempts          int        `json:"maxRepairAttempts"`
	LastRepairAt               *time.Time `json:"lastRepairAt,omitempty"`
	NextRepairAfter            *time.Time `json:"nextRepairAfter,omitempty"`
	DegradedSince              *time.Time `json:"degradedSince,omitempty"`
	DegradedDurationSeconds    int64      `json:"degradedDurationSeconds,omitempty"`
	UnhealthyRuntimeLoops      []string   `json:"unhealthyRuntimeLoops,omitempty"`
}

var healthState = struct {
	sync.Mutex
	runtime       AgentRuntime
	startupChecks *StartupCheckSummary
	lastCommand   *OperationSummary
	lastFile      *OperationSummary
	lastError     *AgentErrorSummary
}{}

func initHealthState(runMode string) {
	exePath, err := os.Executable()
	if err != nil {
		exePath = "unknown"
	}

	healthState.Lock()
	defer healthState.Unlock()
	healthState.runtime = AgentRuntime{
		RunMode:        normalizeRunMode(runMode),
		StartupAt:      time.Now().UTC(),
		ExecutablePath: exePath,
	}
}

func normalizeRunMode(runMode string) string {
	switch runMode {
	case "windows-service":
		return "windows-service"
	case "console":
		return "foreground"
	default:
		return runMode
	}
}

func recordCommandSummary(summary OperationSummary) {
	summary.At = time.Now().UTC().Format(time.RFC3339)

	healthState.Lock()
	defer healthState.Unlock()
	healthState.lastCommand = &summary
}

func recordFileSummary(summary OperationSummary) {
	summary.At = time.Now().UTC().Format(time.RFC3339)

	healthState.Lock()
	defer healthState.Unlock()
	healthState.lastFile = &summary
}

func recordAgentError(source string, err error) {
	if err == nil {
		return
	}

	healthState.Lock()
	defer healthState.Unlock()
	healthState.lastError = &AgentErrorSummary{
		Level:   "error",
		Source:  source,
		Message: err.Error(),
		At:      time.Now().UTC().Format(time.RFC3339),
	}
}

func recordStartupChecks(summary agenthealth.Summary) {
	startupSummary := StartupCheckSummary{
		Passed:   !summary.Fatal(),
		Failed:   startupCheckNames(summary.Failed),
		Warnings: startupCheckNames(summary.Warnings),
		At:       time.Now().UTC().Format(time.RFC3339),
	}

	healthState.Lock()
	defer healthState.Unlock()
	healthState.startupChecks = &startupSummary
}

func clearAgentError() {
	healthState.Lock()
	defer healthState.Unlock()
	healthState.lastError = nil
}

func snapshotStartupChecks() *StartupCheckSummary {
	healthState.Lock()
	defer healthState.Unlock()

	if healthState.startupChecks == nil {
		return nil
	}
	copyValue := *healthState.startupChecks
	copyValue.Failed = append([]string(nil), healthState.startupChecks.Failed...)
	copyValue.Warnings = append([]string(nil), healthState.startupChecks.Warnings...)
	return &copyValue
}

func snapshotHealth() (AgentRuntime, *OperationSummary, *OperationSummary, *AgentErrorSummary) {
	healthState.Lock()
	defer healthState.Unlock()

	var commandCopy *OperationSummary
	if healthState.lastCommand != nil {
		copyValue := *healthState.lastCommand
		commandCopy = &copyValue
	}

	var fileCopy *OperationSummary
	if healthState.lastFile != nil {
		copyValue := *healthState.lastFile
		fileCopy = &copyValue
	}

	var errorCopy *AgentErrorSummary
	if healthState.lastError != nil {
		copyValue := *healthState.lastError
		errorCopy = &copyValue
	}

	return healthState.runtime, commandCopy, fileCopy, errorCopy
}

func snapshotRecoverySummary() AgentRecoverySummary {
	snapshot := recoverySnapshot()
	return recoverySummaryFromSnapshot(snapshot)
}

func recoverySummaryFromSnapshot(snapshot agentrecovery.Snapshot) AgentRecoverySummary {
	return AgentRecoverySummary{
		State:                        string(snapshot.State),
		Degraded:                     snapshot.Degraded,
		ConsecutiveBackendFailures:   snapshot.ConsecutiveBackendFailures,
		LastSuccessfulBackendContact: snapshot.LastSuccessfulBackendContact,
		DegradedReason:               snapshot.DegradedReason,
	}
}

func snapshotWatchdogSummary() AgentWatchdogSummary {
	return watchdogSummaryFromSnapshot(watchdogSnapshot())
}

func watchdogSummaryFromSnapshot(snapshot agentwatchdog.Status) AgentWatchdogSummary {
	return AgentWatchdogSummary{
		State:                      snapshot.State,
		OperatorAttentionNeeded:    snapshot.OperatorAttentionNeeded,
		EscalationRequested:        snapshot.EscalationRequested,
		Reasons:                    append([]string(nil), snapshot.Reasons...),
		ConsecutiveBackendFailures: snapshot.ConsecutiveBackendFailures,
		ConsecutiveCommandFailures: snapshot.ConsecutiveCommandFailures,
		ConsecutiveFileFailures:    snapshot.ConsecutiveFileFailures,
		RepairAttempts:             snapshot.RepairAttempts,
		MaxRepairAttempts:          snapshot.MaxRepairAttempts,
		LastRepairAt:               snapshot.LastRepairAt,
		NextRepairAfter:            snapshot.NextRepairAfter,
		DegradedSince:              snapshot.DegradedSince,
		DegradedDurationSeconds:    snapshot.DegradedDurationSeconds,
		UnhealthyRuntimeLoops:      append([]string(nil), snapshot.UnhealthyRuntimeLoops...),
	}
}
