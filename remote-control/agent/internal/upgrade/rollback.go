package upgrade

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

type State struct {
	Version     string `json:"version"`
	CurrentPath string `json:"currentPath"`
	StagedPath  string `json:"stagedPath"`
	BackupPath  string `json:"backupPath"`
	Status      string `json:"status"`
	Reason      string `json:"reason,omitempty"`
	UpdatedAt   string `json:"updatedAt"`
	StartupOK   bool   `json:"startupOk"`
}

func WriteState(path string, state State) error {
	state.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal upgrade state: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return fmt.Errorf("create state dir: %w", err)
	}
	return os.WriteFile(path, data, 0644)
}

func ReadState(path string) (State, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return State{}, err
	}
	var state State
	if err := json.Unmarshal(data, &state); err != nil {
		return State{}, err
	}
	return state, nil
}

func ShouldRollback(startupOK bool, state State) bool {
	return state.Status == "applied-pending-startup" && !startupOK && state.BackupPath != ""
}

func MarkStartupSuccess(path string, state State) error {
	state.Status = "success"
	state.StartupOK = true
	state.Reason = ""
	return WriteState(path, state)
}

func MarkRollbackRequested(path string, state State, reason string) error {
	state.Status = "rollback-requested"
	state.StartupOK = false
	state.Reason = reason
	return WriteState(path, state)
}
