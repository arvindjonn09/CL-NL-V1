package watchdog

import "time"

type Status struct {
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
	LastSummaryAt              *time.Time `json:"lastSummaryAt,omitempty"`
	LastObservedBackendFailure string     `json:"lastObservedBackendFailure,omitempty"`
	LastObservedCommandFailure string     `json:"lastObservedCommandWorkerFailure,omitempty"`
	LastObservedFileFailure    string     `json:"lastObservedFileWorkerFailure,omitempty"`
	LastObservedDegradedReason string     `json:"lastObservedDegradedReason,omitempty"`
}

type Actions struct {
	LogSummary        bool
	RunSafeRepair     bool
	RepairReason      string
	RequestEscalation bool
	OperatorAttention bool
	OperatorReasons   []string
	Status            Status
}
