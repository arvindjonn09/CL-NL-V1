package watchdog

import (
	"sort"
	"strings"
	"sync"
	"time"
)

type Monitor struct {
	mu sync.Mutex

	thresholds Thresholds
	now        func() time.Time

	consecutiveBackendFailures int
	consecutiveCommandFailures int
	consecutiveFileFailures    int

	lastBackendFailure string
	lastCommandFailure string
	lastFileFailure    string

	degraded       bool
	degradedSince  *time.Time
	degradedReason string

	repairAttempts int
	lastRepairAt   *time.Time
	lastSummaryAt  *time.Time
	loopHeartbeats map[string]time.Time
}

func NewMonitor(thresholds Thresholds) *Monitor {
	return &Monitor{
		thresholds:     thresholds.withDefaults(),
		now:            func() time.Time { return time.Now().UTC() },
		loopHeartbeats: make(map[string]time.Time),
	}
}

func (m *Monitor) SetClock(now func() time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if now == nil {
		m.now = func() time.Time { return time.Now().UTC() }
		return
	}
	m.now = now
}

func (m *Monitor) RecordBackendSuccess() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.consecutiveBackendFailures = 0
	m.lastBackendFailure = ""
}

func (m *Monitor) RecordBackendFailure(err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.consecutiveBackendFailures++
	m.lastBackendFailure = errorString(err)
}

func (m *Monitor) RecordCommandWorkerSuccess() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.consecutiveCommandFailures = 0
	m.lastCommandFailure = ""
}

func (m *Monitor) RecordCommandWorkerFailure(err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.consecutiveCommandFailures++
	m.lastCommandFailure = errorString(err)
}

func (m *Monitor) RecordFileWorkerSuccess() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.consecutiveFileFailures = 0
	m.lastFileFailure = ""
}

func (m *Monitor) RecordFileWorkerFailure(err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.consecutiveFileFailures++
	m.lastFileFailure = errorString(err)
}

func (m *Monitor) RecordRuntimeLoop(name string) {
	name = strings.TrimSpace(name)
	if name == "" {
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	m.loopHeartbeats[name] = m.now()
}

func (m *Monitor) RecordDegradedState(degraded bool, reason string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := m.now()
	if degraded {
		if !m.degraded || m.degradedSince == nil {
			started := now
			m.degradedSince = &started
		}
		m.degraded = true
		m.degradedReason = reason
		return
	}

	m.degraded = false
	m.degradedSince = nil
	m.degradedReason = ""
}

func (m *Monitor) Evaluate() Actions {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := m.now()
	status := m.statusLocked(now)

	logSummary := false
	if m.lastSummaryAt == nil || now.Sub(*m.lastSummaryAt) >= m.thresholds.SummaryInterval {
		logSummary = true
		summaryAt := now
		m.lastSummaryAt = &summaryAt
		status.LastSummaryAt = cloneTime(m.lastSummaryAt)
	}

	runRepair := false
	repairReason := ""
	if status.OperatorAttentionNeeded && m.repairAttempts < m.thresholds.MaxRepairAttempts && m.repairCooldownElapsedLocked(now) {
		runRepair = true
		repairReason = firstReason(status.Reasons)
		m.repairAttempts++
		lastRepair := now
		m.lastRepairAt = &lastRepair
		status = m.statusLocked(now)
	}

	return Actions{
		LogSummary:        logSummary,
		RunSafeRepair:     runRepair,
		RepairReason:      repairReason,
		RequestEscalation: status.EscalationRequested,
		OperatorAttention: status.OperatorAttentionNeeded,
		OperatorReasons:   append([]string(nil), status.Reasons...),
		Status:            status,
	}
}

func (m *Monitor) Snapshot() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.statusLocked(m.now())
}

func (m *Monitor) statusLocked(now time.Time) Status {
	reasons := make([]string, 0, 5)
	escalation := false

	if m.consecutiveBackendFailures >= m.thresholds.BackendFailureAttention {
		reasons = append(reasons, "repeated backend/heartbeat failures")
	}
	if m.consecutiveBackendFailures >= m.thresholds.BackendFailureEscalate {
		escalation = true
	}

	if m.consecutiveCommandFailures >= m.thresholds.CommandFailureAttention {
		reasons = append(reasons, "repeated command worker failures")
	}
	if m.consecutiveCommandFailures >= m.thresholds.CommandFailureEscalate {
		escalation = true
	}

	if m.consecutiveFileFailures >= m.thresholds.FileFailureAttention {
		reasons = append(reasons, "repeated file worker failures")
	}
	if m.consecutiveFileFailures >= m.thresholds.FileFailureEscalate {
		escalation = true
	}

	degradedSeconds := int64(0)
	if m.degraded && m.degradedSince != nil {
		degradedSeconds = int64(now.Sub(*m.degradedSince).Seconds())
		if degradedSeconds < 0 {
			degradedSeconds = 0
		}
		if now.Sub(*m.degradedSince) >= m.thresholds.DegradedAttentionAfter {
			reasons = append(reasons, "prolonged degraded state")
		}
	}

	staleLoops := m.staleLoopsLocked(now)
	if len(staleLoops) > 0 {
		reasons = append(reasons, "stuck or unhealthy runtime loops")
		escalation = true
	}

	if m.repairAttempts >= m.thresholds.RepairAttention {
		reasons = append(reasons, "excessive repair attempts")
	}
	if m.repairAttempts >= m.thresholds.MaxRepairAttempts {
		escalation = true
	}

	nextRepairAfter := cloneTime(m.lastRepairAt)
	if nextRepairAfter != nil {
		next := nextRepairAfter.Add(m.thresholds.RepairCooldown)
		nextRepairAfter = &next
	}

	state := "normal"
	if len(reasons) > 0 {
		state = "operator-attention-needed"
	}
	if escalation {
		state = "escalation-requested"
	}

	return Status{
		State:                      state,
		OperatorAttentionNeeded:    len(reasons) > 0,
		EscalationRequested:        escalation,
		Reasons:                    reasons,
		ConsecutiveBackendFailures: m.consecutiveBackendFailures,
		ConsecutiveCommandFailures: m.consecutiveCommandFailures,
		ConsecutiveFileFailures:    m.consecutiveFileFailures,
		RepairAttempts:             m.repairAttempts,
		MaxRepairAttempts:          m.thresholds.MaxRepairAttempts,
		LastRepairAt:               cloneTime(m.lastRepairAt),
		NextRepairAfter:            nextRepairAfter,
		DegradedSince:              cloneTime(m.degradedSince),
		DegradedDurationSeconds:    degradedSeconds,
		UnhealthyRuntimeLoops:      staleLoops,
		LastSummaryAt:              cloneTime(m.lastSummaryAt),
		LastObservedBackendFailure: m.lastBackendFailure,
		LastObservedCommandFailure: m.lastCommandFailure,
		LastObservedFileFailure:    m.lastFileFailure,
		LastObservedDegradedReason: m.degradedReason,
	}
}

func (m *Monitor) repairCooldownElapsedLocked(now time.Time) bool {
	if m.lastRepairAt == nil {
		return true
	}
	return now.Sub(*m.lastRepairAt) >= m.thresholds.RepairCooldown
}

func (m *Monitor) staleLoopsLocked(now time.Time) []string {
	var stale []string
	for name, lastSeen := range m.loopHeartbeats {
		if now.Sub(lastSeen) >= m.thresholds.LoopStaleAfter {
			stale = append(stale, name)
		}
	}
	sort.Strings(stale)
	return stale
}

func errorString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func cloneTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	copyValue := *value
	return &copyValue
}

func firstReason(reasons []string) string {
	if len(reasons) == 0 {
		return "watchdog threshold exceeded"
	}
	return reasons[0]
}
