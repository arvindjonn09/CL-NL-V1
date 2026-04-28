package recovery

import (
	"errors"
	"testing"
)

func TestTrackerDegradedRecoveringNormalTransitions(t *testing.T) {
	tracker := NewTracker()
	err := errors.New("backend unavailable")

	tracker.RecordBackendFailure(err)
	tracker.RecordBackendFailure(err)
	event := tracker.RecordBackendFailure(err)

	if event.To != StateDegraded {
		t.Fatalf("expected degraded transition, got %s", event.To)
	}
	snapshot := tracker.Snapshot()
	if !snapshot.Degraded || snapshot.ConsecutiveBackendFailures != 3 || snapshot.DegradedReason == "" {
		t.Fatalf("unexpected degraded snapshot: %+v", snapshot)
	}

	event = tracker.RecordBackendSuccess()
	if event.To != StateRecovering {
		t.Fatalf("expected recovering transition, got %s", event.To)
	}
	if tracker.Snapshot().Degraded {
		t.Fatalf("recovering should clear degraded flag")
	}

	event = tracker.RecordBackendSuccess()
	if event.To != StateNormal {
		t.Fatalf("expected normal transition, got %s", event.To)
	}
	snapshot = tracker.Snapshot()
	if snapshot.Degraded || snapshot.ConsecutiveBackendFailures != 0 || snapshot.DegradedReason != "" {
		t.Fatalf("unexpected recovered snapshot: %+v", snapshot)
	}
}
