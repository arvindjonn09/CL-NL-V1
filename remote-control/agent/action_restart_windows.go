//go:build windows

package main

import (
	"fmt"
	"os/exec"
)

func requestServiceRestart(cfg *Config) (string, map[string]interface{}, error) {
	runtimeInfo, _, _, _ := snapshotHealth()
	if runtimeInfo.RunMode != "windows-service" {
		return "", nil, fmt.Errorf("restart-service requires windows-service mode, current mode is %s", runtimeInfo.RunMode)
	}

	script := "Start-Sleep -Seconds 2; Restart-Service -Name 'SetuLinkAgent' -Force"
	cmd := exec.Command("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", script)
	if err := cmd.Start(); err != nil {
		return "", nil, fmt.Errorf("start service restart helper: %w", err)
	}

	payload := runtimeSnapshotPayload(cfg)
	payload["restartMode"] = "windows-service"
	payload["serviceName"] = "SetuLinkAgent"
	payload["helperPid"] = cmd.Process.Pid

	return "service restart requested; a brief disconnect is expected", payload, nil
}
