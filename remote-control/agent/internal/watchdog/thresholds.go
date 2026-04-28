package watchdog

import "time"

type Thresholds struct {
	BackendFailureAttention int
	BackendFailureEscalate  int
	CommandFailureAttention int
	CommandFailureEscalate  int
	FileFailureAttention    int
	FileFailureEscalate     int
	RepairAttention         int
	MaxRepairAttempts       int
	RepairCooldown          time.Duration
	DegradedAttentionAfter  time.Duration
	LoopStaleAfter          time.Duration
	SummaryInterval         time.Duration
}

func DefaultThresholds() Thresholds {
	return Thresholds{
		BackendFailureAttention: 4,
		BackendFailureEscalate:  8,
		CommandFailureAttention: 4,
		CommandFailureEscalate:  8,
		FileFailureAttention:    4,
		FileFailureEscalate:     8,
		RepairAttention:         3,
		MaxRepairAttempts:       3,
		RepairCooldown:          15 * time.Minute,
		DegradedAttentionAfter:  10 * time.Minute,
		LoopStaleAfter:          2 * time.Minute,
		SummaryInterval:         5 * time.Minute,
	}
}

func (t Thresholds) withDefaults() Thresholds {
	defaults := DefaultThresholds()
	if t.BackendFailureAttention <= 0 {
		t.BackendFailureAttention = defaults.BackendFailureAttention
	}
	if t.BackendFailureEscalate <= 0 {
		t.BackendFailureEscalate = defaults.BackendFailureEscalate
	}
	if t.CommandFailureAttention <= 0 {
		t.CommandFailureAttention = defaults.CommandFailureAttention
	}
	if t.CommandFailureEscalate <= 0 {
		t.CommandFailureEscalate = defaults.CommandFailureEscalate
	}
	if t.FileFailureAttention <= 0 {
		t.FileFailureAttention = defaults.FileFailureAttention
	}
	if t.FileFailureEscalate <= 0 {
		t.FileFailureEscalate = defaults.FileFailureEscalate
	}
	if t.RepairAttention <= 0 {
		t.RepairAttention = defaults.RepairAttention
	}
	if t.MaxRepairAttempts <= 0 {
		t.MaxRepairAttempts = defaults.MaxRepairAttempts
	}
	if t.RepairCooldown <= 0 {
		t.RepairCooldown = defaults.RepairCooldown
	}
	if t.DegradedAttentionAfter <= 0 {
		t.DegradedAttentionAfter = defaults.DegradedAttentionAfter
	}
	if t.LoopStaleAfter <= 0 {
		t.LoopStaleAfter = defaults.LoopStaleAfter
	}
	if t.SummaryInterval <= 0 {
		t.SummaryInterval = defaults.SummaryInterval
	}
	if t.BackendFailureEscalate < t.BackendFailureAttention {
		t.BackendFailureEscalate = t.BackendFailureAttention
	}
	if t.CommandFailureEscalate < t.CommandFailureAttention {
		t.CommandFailureEscalate = t.CommandFailureAttention
	}
	if t.FileFailureEscalate < t.FileFailureAttention {
		t.FileFailureEscalate = t.FileFailureAttention
	}
	return t
}
