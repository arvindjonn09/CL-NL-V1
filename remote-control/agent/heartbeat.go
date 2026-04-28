package main

import (
	"fmt"
	"os"
	"time"

	agentremotedesktop "remote-control-agent/internal/remotedesktop"
)

type HeartbeatRequest struct {
	ID                 string               `json:"id"`
	DisplayName        string               `json:"displayName,omitempty"`
	Hostname           string               `json:"hostname,omitempty"`
	Username           string               `json:"username,omitempty"`
	RunMode            string               `json:"runMode,omitempty"`
	AgentVersion       string               `json:"agentVersion,omitempty"`
	ServiceName        string               `json:"serviceName,omitempty"`
	StartupAt          string               `json:"startupAt,omitempty"`
	ExecutablePath     string               `json:"executablePath,omitempty"`
	ConfigPath         string               `json:"configPath,omitempty"`
	ProcessID          int                  `json:"processId,omitempty"`
	BackendURL         string               `json:"backendUrl,omitempty"`
	EnvironmentLabel   string               `json:"environmentLabel,omitempty"`
	LastCommand        *OperationSummary    `json:"lastCommand,omitempty"`
	LastFile           *OperationSummary    `json:"lastFile,omitempty"`
	LastError          *AgentErrorSummary   `json:"lastError,omitempty"`
	StartupChecks      *StartupCheckSummary `json:"startupChecks,omitempty"`
	Recovery           AgentRecoverySummary `json:"recovery,omitempty"`
	Watchdog           AgentWatchdogSummary `json:"watchdog,omitempty"`
	Diagnostics        any                  `json:"diagnostics,omitempty"`
	RemoteDesktop      any                  `json:"remoteDesktop,omitempty"`
	RuntimeDirectories map[string]string    `json:"runtimeDirectories,omitempty"`
}

func SendHeartbeat(cfg *Config) error {
	runtimeInfo, lastCommand, lastFile, lastError := snapshotHealth()
	startupChecks := snapshotStartupChecks()
	recoverySummary := snapshotRecoverySummary()
	watchdogSummary := snapshotWatchdogSummary()
	diagnosticsSnapshot := buildDiagnosticSnapshot(cfg)
	remoteDesktopCapability := agentremotedesktop.CurrentCapability()
	service := ""
	if runtimeInfo.RunMode == "windows-service" {
		service = serviceName
	}

	payload := HeartbeatRequest{
		ID:               cfg.DeviceID,
		DisplayName:      cfg.DisplayName,
		Hostname:         cfg.Hostname,
		Username:         cfg.Username,
		RunMode:          runtimeInfo.RunMode,
		AgentVersion:     cfg.Version,
		ServiceName:      service,
		StartupAt:        runtimeInfo.StartupAt.Format(time.RFC3339),
		ExecutablePath:   runtimeInfo.ExecutablePath,
		ConfigPath:       cfg.ConfigPath,
		ProcessID:        os.Getpid(),
		BackendURL:       cfg.ServerURL,
		EnvironmentLabel: cfg.Environment,
		LastCommand:      lastCommand,
		LastFile:         lastFile,
		LastError:        lastError,
		StartupChecks:    startupChecks,
		Recovery:         recoverySummary,
		Watchdog:         watchdogSummary,
		Diagnostics:      diagnosticsSnapshot,
		RemoteDesktop:    remoteDesktopCapability,
		RuntimeDirectories: map[string]string{
			"dataPath":        cfg.DataPath,
			"logPath":         cfg.LogPath,
			"tempPath":        cfg.TempPath,
			"filesPath":       cfg.FilesPath,
			"deviceStatePath": cfg.DeviceStatePath,
			"ffmpegPath":      remoteDesktopCapability.FfmpegPath,
		},
	}

	if err := doAgentRequest(cfg, "POST", agentURL(cfg, "/api/agent/heartbeat", nil), payload, nil); err != nil {
		return fmt.Errorf("heartbeat request failed: %w", err)
	}

	clearAgentError()
	logger("heartbeat").Info("sent", "heartbeat sent", logMetadata("at", time.Now().Format(time.RFC3339)))
	return nil
}

func StartHeartbeatLoop(cfg *Config, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		if err := SendHeartbeat(cfg); err != nil {
			logger("heartbeat").Warn("loop", "heartbeat loop send failed", err, nil)
		}
		<-ticker.C
	}
}
