package upgrade

import (
	"fmt"
	"os/exec"
	"runtime"
	"strconv"
)

type ApplyOptions struct {
	HelperPath     string
	ServiceName    string
	CurrentPath    string
	StagedPath     string
	BackupPath     string
	StatePath      string
	WaitPid        int
	RestartService bool
}

func ApplyWithHelper(opts ApplyOptions) error {
	if opts.HelperPath == "" {
		return fmt.Errorf("updater helper path is required")
	}
	if opts.CurrentPath == "" || opts.StagedPath == "" || opts.BackupPath == "" || opts.StatePath == "" {
		return fmt.Errorf("apply paths are incomplete")
	}
	args := []string{
		"-current", opts.CurrentPath,
		"-staged", opts.StagedPath,
		"-backup", opts.BackupPath,
		"-state", opts.StatePath,
	}
	if opts.ServiceName != "" {
		args = append(args, "-service", opts.ServiceName)
	}
	if opts.WaitPid > 0 {
		args = append(args, "-wait-pid", strconv.Itoa(opts.WaitPid))
	}
	if opts.RestartService {
		args = append(args, "-restart-service")
	}
	if runtime.GOOS != "windows" {
		args = append(args, "-non-windows")
	}

	cmd := exec.Command(opts.HelperPath, args...)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start updater helper: %w", err)
	}
	return nil
}
