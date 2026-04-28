package watchdog

import (
	"errors"
	"testing"
	"time"
)

func TestThresholdTransitionsRequestOperatorAttentionAndEscalation(t *testing.T) {
	now := time.Date(2026, 4, 18, 1, 0, 0, 0, time.UTC)
	monitor := NewMonitor(Thresholds{
		BackendFailureAttention: 2,
		BackendFailureEscalate:  3,
		RepairCooldown:          time.Hour,
	})
	monitor.SetClock(func() time.Time { return now })

	monitor.RecordBackendFailure(errors.New("first"))
	status := monitor.Snapshot()
	if status.OperatorAttentionNeeded {
		t.Fatalf("attention should wait for threshold: %+v", status)
	}

	monitor.RecordBackendFailure(errors.New("second"))
	status = monitor.Snapshot()
	if !status.OperatorAttentionNeeded || status.EscalationRequested {
		t.Fatalf("expected attention without escalation: %+v", status)
	}

	monitor.RecordBackendFailure(errors.New("third"))
	status = monitor.Snapshot()
	if !status.OperatorAttentionNeeded || !status.EscalationRequested {
		t.Fatalf("expected escalation after higher threshold: %+v", status)
	}
}

func TestCooldownPreventsRepairThrashing(t *testing.T) {
	now := time.Date(2026, 4, 18, 1, 0, 0, 0, time.UTC)
	monitor := NewMonitor(Thresholds{
		BackendFailureAttention: 1,
		MaxRepairAttempts:       3,
		RepairCooldown:          10 * time.Minute,
		SummaryInterval:         time.Hour,
	})
	monitor.SetClock(func() time.Time { return now })
	monitor.RecordBackendFailure(errors.New("down"))

	first := monitor.Evaluate()
	if !first.RunSafeRepair || first.Status.RepairAttempts != 1 {
		t.Fatalf("expected first repair: %+v", first)
	}

	second := monitor.Evaluate()
	if second.RunSafeRepair || second.Status.RepairAttempts != 1 {
		t.Fatalf("cooldown should suppress immediate repair: %+v", second)
	}

	now = now.Add(10 * time.Minute)
	third := monitor.Evaluate()
	if !third.RunSafeRepair || third.Status.RepairAttempts != 2 {
		t.Fatalf("expected repair after cooldown: %+v", third)
	}
}

func TestRepairAttemptsAreCappedAndEscalated(t *testing.T) {
	now := time.Date(2026, 4, 18, 1, 0, 0, 0, time.UTC)
	monitor := NewMonitor(Thresholds{
		BackendFailureAttention: 1,
		RepairAttention:         2,
		MaxRepairAttempts:       2,
		RepairCooldown:          time.Minute,
		SummaryInterval:         time.Hour,
	})
	monitor.SetClock(func() time.Time { return now })
	monitor.RecordBackendFailure(errors.New("down"))

	if !monitor.Evaluate().RunSafeRepair {
		t.Fatalf("expected first repair")
	}
	now = now.Add(time.Minute)
	if !monitor.Evaluate().RunSafeRepair {
		t.Fatalf("expected second repair")
	}
	now = now.Add(time.Minute)
	actions := monitor.Evaluate()
	if actions.RunSafeRepair {
		t.Fatalf("repair should be capped: %+v", actions)
	}
	if !actions.Status.OperatorAttentionNeeded || !actions.Status.EscalationRequested {
		t.Fatalf("cap should request escalation: %+v", actions.Status)
	}
}
