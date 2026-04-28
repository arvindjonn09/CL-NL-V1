package diagnostics

import "time"

type StartupSummary struct {
	Passed   bool     `json:"passed"`
	Failed   []string `json:"failed,omitempty"`
	Warnings []string `json:"warnings,omitempty"`
	At       string   `json:"at,omitempty"`
}

type RecoverySummary struct {
	State                        string     `json:"state"`
	Degraded                     bool       `json:"degraded"`
	ConsecutiveBackendFailures   int        `json:"consecutiveBackendFailures"`
	LastSuccessfulBackendContact *time.Time `json:"lastSuccessfulBackendContact,omitempty"`
	DegradedReason               string     `json:"degradedReason,omitempty"`
}

type WatchdogSummary struct {
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

type OperationView struct {
	Status string `json:"status,omitempty"`
	At     string `json:"at,omitempty"`
}

type UpgradeSummary struct {
	Status  string `json:"status,omitempty"`
	Version string `json:"version,omitempty"`
	Reason  string `json:"reason,omitempty"`
}

type Snapshot struct {
	DeviceID                     string          `json:"device_id"`
	Hostname                     string          `json:"hostname,omitempty"`
	Username                     string          `json:"username,omitempty"`
	RunMode                      string          `json:"run_mode,omitempty"`
	Version                      string          `json:"version,omitempty"`
	ExecutablePath               string          `json:"executable_path,omitempty"`
	ConfigPath                   string          `json:"config_path,omitempty"`
	LogPath                      string          `json:"log_path,omitempty"`
	BackendURL                   string          `json:"backend_url,omitempty"`
	ServiceName                  string          `json:"service_name,omitempty"`
	StartupOK                    bool            `json:"startup_ok"`
	StartupChecks                *StartupSummary `json:"startup_checks,omitempty"`
	Recovery                     RecoverySummary `json:"recovery"`
	Watchdog                     WatchdogSummary `json:"watchdog"`
	Degraded                     bool            `json:"degraded"`
	DegradedReason               string          `json:"degraded_reason,omitempty"`
	OperatorAttentionNeeded      bool            `json:"operator_attention_needed,omitempty"`
	EscalationRequested          bool            `json:"escalation_requested,omitempty"`
	LastSuccessfulBackendContact *time.Time      `json:"last_successful_backend_contact,omitempty"`
	HeartbeatFailureCount        int             `json:"heartbeat_failure_count"`
	LastCommandStatus            string          `json:"last_command_status,omitempty"`
	LastFileStatus               string          `json:"last_file_status,omitempty"`
	Upgrade                      *UpgradeSummary `json:"upgrade,omitempty"`
	UptimeSeconds                int64           `json:"uptime_seconds"`
}

type RuntimeInput struct {
	DeviceID       string
	Hostname       string
	Username       string
	RunMode        string
	Version        string
	ExecutablePath string
	ConfigPath     string
	LogPath        string
	BackendURL     string
	ServiceName    string
	StartupAt      time.Time
	StartupChecks  *StartupSummary
	Recovery       RecoverySummary
	Watchdog       WatchdogSummary
	LastCommand    *OperationView
	LastFile       *OperationView
	Upgrade        *UpgradeSummary
	Now            time.Time
}
