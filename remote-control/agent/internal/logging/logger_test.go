package logging

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoggerWritesStructuredJSONAndMirrorsErrors(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "agent.log")

	logger, err := New(logPath)
	if err != nil {
		t.Fatalf("new logger: %v", err)
	}
	logger = logger.WithComponent("test").WithDevice("device-1").WithRunMode("foreground")

	logger.Info("boot", "started", map[string]any{"k": "v"})
	logger.Error("fail", "failed", os.ErrNotExist, nil)

	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read log: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 log lines, got %d", len(lines))
	}

	var entry Entry
	if err := json.Unmarshal([]byte(lines[0]), &entry); err != nil {
		t.Fatalf("unmarshal entry: %v", err)
	}
	if entry.Component != "test" || entry.DeviceID != "device-1" || entry.RunMode != "foreground" {
		t.Fatalf("unexpected entry context: %+v", entry)
	}

	errorData, err := os.ReadFile(filepath.Join(dir, "agent-error.log"))
	if err != nil {
		t.Fatalf("read error log: %v", err)
	}
	if !strings.Contains(string(errorData), `"level":"error"`) {
		t.Fatalf("expected mirrored error line, got %s", string(errorData))
	}
}
