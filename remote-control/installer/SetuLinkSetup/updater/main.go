package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"time"
)

type updateState struct {
	Version     string `json:"version,omitempty"`
	Status      string `json:"status"`
	Reason      string `json:"reason,omitempty"`
	UpdatedAt   string `json:"updatedAt"`
	CurrentPath string `json:"currentPath,omitempty"`
	StagedPath  string `json:"stagedPath,omitempty"`
	BackupPath  string `json:"backupPath,omitempty"`
}

func main() {
	current := flag.String("current", "", "current agent executable path")
	staged := flag.String("staged", "", "staged replacement executable path")
	backup := flag.String("backup", "", "backup executable path")
	service := flag.String("service", "SetuLinkAgent", "Windows service name")
	statePath := flag.String("state", "", "upgrade state path")
	waitPID := flag.Int("wait-pid", 0, "process id to wait for before replacing")
	restartService := flag.Bool("restart-service", false, "restart Windows service after replacement")
	nonWindows := flag.Bool("non-windows", false, "allow non-Windows dry flow")
	flag.Parse()

	if *current == "" || *staged == "" || *backup == "" || *statePath == "" {
		writeState(*statePath, updateState{Status: "failed", Reason: "missing required path arguments"})
		os.Exit(2)
	}
	if runtime.GOOS != "windows" && !*nonWindows {
		writeState(*statePath, updateState{Status: "failed", Reason: "updater helper is intended for Windows"})
		os.Exit(3)
	}

	writeState(*statePath, updateState{Status: "helper-started", CurrentPath: *current, StagedPath: *staged, BackupPath: *backup})

	if *waitPID > 0 {
		waitForPIDExit(*waitPID, 60*time.Second)
	}
	if *restartService && runtime.GOOS == "windows" {
		_ = runSC("stop", *service)
		time.Sleep(2 * time.Second)
	}

	if err := preserveBackup(*current, *backup); err != nil {
		writeState(*statePath, updateState{Status: "failed", Reason: err.Error(), CurrentPath: *current, StagedPath: *staged, BackupPath: *backup})
		os.Exit(10)
	}

	if err := replaceFile(*staged, *current); err != nil {
		writeState(*statePath, updateState{Status: "failed", Reason: err.Error(), CurrentPath: *current, StagedPath: *staged, BackupPath: *backup})
		os.Exit(11)
	}

	writeState(*statePath, updateState{Status: "applied-pending-startup", CurrentPath: *current, StagedPath: *staged, BackupPath: *backup})

	if *restartService && runtime.GOOS == "windows" {
		if err := runSC("start", *service); err != nil {
			writeState(*statePath, updateState{Status: "failed", Reason: err.Error(), CurrentPath: *current, StagedPath: *staged, BackupPath: *backup})
			os.Exit(12)
		}
	}
}

func waitForPIDExit(pid int, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !processExists(pid) {
			return
		}
		time.Sleep(500 * time.Millisecond)
	}
}

func processExists(pid int) bool {
	if runtime.GOOS == "windows" {
		output, err := exec.Command("tasklist", "/FI", fmt.Sprintf("PID eq %d", pid)).CombinedOutput()
		return err == nil && contains(string(output), fmt.Sprint(pid))
	}
	err := exec.Command("kill", "-0", fmt.Sprint(pid)).Run()
	return err == nil
}

func contains(value, needle string) bool {
	for i := 0; i+len(needle) <= len(value); i++ {
		if value[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}

func preserveBackup(current, backup string) error {
	if _, err := os.Stat(backup); err == nil {
		return nil
	}
	return copyFile(current, backup)
}

func replaceFile(src, dst string) error {
	tmp := dst + ".updating"
	_ = os.Remove(tmp)
	if err := copyFile(src, tmp); err != nil {
		return fmt.Errorf("copy staged binary: %w", err)
	}
	if err := os.Remove(dst); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove current binary: %w", err)
	}
	if err := os.Rename(tmp, dst); err != nil {
		return fmt.Errorf("replace current binary: %w", err)
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}

func runSC(action, service string) error {
	return exec.Command("sc.exe", action, service).Run()
}

func writeState(path string, state updateState) {
	if path == "" {
		return
	}
	if existing, err := readState(path); err == nil {
		if state.Version == "" {
			state.Version = existing.Version
		}
		if state.CurrentPath == "" {
			state.CurrentPath = existing.CurrentPath
		}
		if state.StagedPath == "" {
			state.StagedPath = existing.StagedPath
		}
		if state.BackupPath == "" {
			state.BackupPath = existing.BackupPath
		}
	}
	state.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	data, _ := json.MarshalIndent(state, "", "  ")
	_ = os.WriteFile(path, data, 0644)
}

func readState(path string) (updateState, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return updateState{}, err
	}
	var state updateState
	if err := json.Unmarshal(data, &state); err != nil {
		return updateState{}, err
	}
	return state, nil
}
