package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReplaceFileSwapsStagedBinary(t *testing.T) {
	dir := t.TempDir()
	current := filepath.Join(dir, "setulink-agent.exe")
	staged := filepath.Join(dir, "staged.exe")
	if err := os.WriteFile(current, []byte("old"), 0755); err != nil {
		t.Fatalf("write current: %v", err)
	}
	if err := os.WriteFile(staged, []byte("new"), 0755); err != nil {
		t.Fatalf("write staged: %v", err)
	}

	if err := replaceFile(staged, current); err != nil {
		t.Fatalf("replace file: %v", err)
	}

	data, err := os.ReadFile(current)
	if err != nil {
		t.Fatalf("read current: %v", err)
	}
	if string(data) != "new" {
		t.Fatalf("expected new binary, got %q", string(data))
	}
}

func TestWriteStatePreservesExistingVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "upgrade-state.json")
	writeState(path, updateState{Version: "0.2.0", Status: "apply-started"})
	writeState(path, updateState{Status: "applied-pending-startup"})

	state, err := readState(path)
	if err != nil {
		t.Fatalf("read state: %v", err)
	}
	if state.Version != "0.2.0" || state.Status != "applied-pending-startup" {
		t.Fatalf("unexpected state: %+v", state)
	}
}
