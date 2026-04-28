package recovery

import (
	"sync"
	"time"
)

type State string

const (
	StateNormal     State = "normal"
	StateDegraded   State = "degraded"
	StateRecovering State = "recovering"
)

type Snapshot struct {
	State                        State      `json:"state"`
	Degraded                     bool       `json:"degraded"`
	ConsecutiveBackendFailures   int        `json:"consecutiveBackendFailures"`
	LastSuccessfulBackendContact *time.Time `json:"lastSuccessfulBackendContact,omitempty"`
	DegradedReason               string     `json:"degradedReason,omitempty"`
}

type TransitionEvent struct {
	From   State
	To     State
	Reason string
}

type Tracker struct {
	mu                           sync.Mutex
	state                        State
	degradeAfterFailures         int
	consecutiveBackendFailures   int
	lastSuccessfulBackendContact *time.Time
	degradedReason               string
}

func NewTracker() *Tracker {
	return &Tracker{
		state:                StateNormal,
		degradeAfterFailures: 3,
	}
}

func (t *Tracker) RecordBackendFailure(err error) TransitionEvent {
	t.mu.Lock()
	defer t.mu.Unlock()

	from := t.state
	t.consecutiveBackendFailures++
	if err != nil {
		t.degradedReason = err.Error()
	}
	if t.consecutiveBackendFailures >= t.degradeAfterFailures {
		t.state = StateDegraded
	}

	return TransitionEvent{From: from, To: t.state, Reason: t.degradedReason}
}

func (t *Tracker) RecordBackendSuccess() TransitionEvent {
	t.mu.Lock()
	defer t.mu.Unlock()

	from := t.state
	now := time.Now().UTC()
	t.lastSuccessfulBackendContact = &now
	t.consecutiveBackendFailures = 0

	switch t.state {
	case StateDegraded:
		t.state = StateRecovering
	case StateRecovering:
		t.state = StateNormal
		t.degradedReason = ""
	default:
		t.state = StateNormal
		t.degradedReason = ""
	}

	return TransitionEvent{From: from, To: t.state, Reason: t.degradedReason}
}

func (t *Tracker) Snapshot() Snapshot {
	t.mu.Lock()
	defer t.mu.Unlock()

	var lastSuccess *time.Time
	if t.lastSuccessfulBackendContact != nil {
		copyValue := *t.lastSuccessfulBackendContact
		lastSuccess = &copyValue
	}

	return Snapshot{
		State:                        t.state,
		Degraded:                     t.state == StateDegraded,
		ConsecutiveBackendFailures:   t.consecutiveBackendFailures,
		LastSuccessfulBackendContact: lastSuccess,
		DegradedReason:               t.degradedReason,
	}
}
