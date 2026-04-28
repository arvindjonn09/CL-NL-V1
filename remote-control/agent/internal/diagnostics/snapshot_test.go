package diagnostics

import (
	"testing"
	"time"
)

func TestBuildSnapshotAssemblesCompactRuntimeView(t *testing.T) {
	lastSuccess := time.Date(2026, 4, 18, 1, 2, 3, 0, time.UTC)
	startup := time.Date(2026, 4, 18, 1, 0, 0, 0, time.UTC)
	now := startup.Add(90 * time.Second)

	snapshot := BuildSnapshot(RuntimeInput{
		DeviceID:       "device-1",
		Hostname:       "host",
		Username:       "user",
		RunMode:        "foreground",
		Version:        "0.1.0",
		ExecutablePath: "/agent",
		ConfigPath:     "/config",
		LogPath:        "/logs/agent.log",
		BackendURL:     "http://localhost:3000",
		ServiceName:    "SetuLinkAgent",
		StartupAt:      startup,
		StartupChecks:  &StartupSummary{Passed: true, Warnings: []string{"backend-connectivity"}},
		Recovery: RecoverySummary{
			State:                        "degraded",
			Degraded:                     true,
			ConsecutiveBackendFailures:   4,
			LastSuccessfulBackendContact: &lastSuccess,
			DegradedReason:               "request failed",
		},
		Watchdog:    WatchdogSummary{State: "normal", MaxRepairAttempts: 3},
		LastCommand: &OperationView{Status: "completed"},
		LastFile:    &OperationView{Status: "failed"},
		Now:         now,
	})

	if snapshot.DeviceID != "device-1" || !snapshot.StartupOK || !snapshot.Degraded {
		t.Fatalf("unexpected snapshot basics: %+v", snapshot)
	}
	if snapshot.HeartbeatFailureCount != 4 || snapshot.LastCommandStatus != "completed" || snapshot.LastFileStatus != "failed" {
		t.Fatalf("unexpected operational fields: %+v", snapshot)
	}
	if snapshot.UptimeSeconds != 90 {
		t.Fatalf("expected uptime 90, got %d", snapshot.UptimeSeconds)
	}
}

func TestBuildSnapshotSurfacesWatchdogOperatorAttention(t *testing.T) {
	snapshot := BuildSnapshot(RuntimeInput{
		DeviceID: "device-1",
		Recovery: RecoverySummary{
			State: "normal",
		},
		Watchdog: WatchdogSummary{
			State:                   "operator-attention-needed",
			OperatorAttentionNeeded: true,
			Reasons:                 []string{"repeated command worker failures"},
			RepairAttempts:          2,
			MaxRepairAttempts:       3,
		},
	})

	if !snapshot.Degraded || !snapshot.OperatorAttentionNeeded {
		t.Fatalf("expected watchdog attention to degrade snapshot: %+v", snapshot)
	}
	if snapshot.DegradedReason != "operator attention needed: repeated command worker failures" {
		t.Fatalf("unexpected degraded reason: %s", snapshot.DegradedReason)
	}
}
