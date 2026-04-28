package main

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"
)

type PendingAction struct {
	ID         string `json:"id"`
	DeviceID   string `json:"deviceId"`
	ActionType string `json:"actionType"`
}

type ActionResultRequest struct {
	ActionID      string                 `json:"actionId"`
	DeviceID      string                 `json:"deviceId"`
	Status        string                 `json:"status"`
	ResultSummary string                 `json:"resultSummary,omitempty"`
	ErrorSummary  string                 `json:"errorSummary,omitempty"`
	ResultPayload map[string]interface{} `json:"resultPayload,omitempty"`
}

func FetchNextAction(cfg *Config) (*PendingAction, error) {
	query := url.Values{}
	query.Set("id", cfg.DeviceID)

	var data struct {
		Action *PendingAction `json:"action"`
	}
	if err := doAgentRequest(cfg, "GET", agentURL(cfg, "/api/agent/next-action", query), nil, &data); err != nil {
		return nil, fmt.Errorf("fetch next action failed: %w", err)
	}

	return data.Action, nil
}

func ProcessAction(cfg *Config, action PendingAction) {
	if action.DeviceID != "" && action.DeviceID != cfg.DeviceID {
		_ = SendActionResult(cfg, action.ID, "failed", "", "action was not addressed to this device", nil)
		return
	}

	summary, payload, err := executeAction(cfg, action.ActionType)
	status := "success"
	errorSummary := ""
	if err != nil {
		status = "failed"
		errorSummary = err.Error()
		recordAgentError("action:"+action.ActionType, err)
	}

	if sendErr := SendActionResult(cfg, action.ID, status, summary, errorSummary, payload); sendErr != nil {
		recordAgentError("action-result", sendErr)
		logger("actions").Warn("result-post", "action result post failed", sendErr, logMetadata("actionId", action.ID, "actionType", action.ActionType))
	}
}

func SendActionResult(cfg *Config, actionID, status, summary, errorSummary string, payload map[string]interface{}) error {
	body := ActionResultRequest{
		ActionID:      actionID,
		DeviceID:      cfg.DeviceID,
		Status:        status,
		ResultSummary: summary,
		ErrorSummary:  errorSummary,
		ResultPayload: payload,
	}

	return doAgentRequest(cfg, "POST", agentURL(cfg, "/api/agent/action-result", nil), body, nil)
}

func executeAction(cfg *Config, actionType string) (string, map[string]interface{}, error) {
	switch actionType {
	case "force-heartbeat":
		if err := SendHeartbeat(cfg); err != nil {
			return "", nil, err
		}
		return "heartbeat sent", runtimeSnapshotPayload(cfg), nil

	case "refresh-metadata":
		if err := SendHeartbeat(cfg); err != nil {
			return "", nil, err
		}
		return "metadata refreshed", runtimeSnapshotPayload(cfg), nil

	case "runtime-log-snapshot":
		payload := runtimeSnapshotPayload(cfg)
		payload["recentLog"] = tailFile(cfg.LogPath, 80)
		return "runtime/log snapshot captured", payload, nil

	case "restart-service":
		return requestServiceRestart(cfg)

	case "check-upgrade":
		info, err := checkAndStageUpgrade(context.Background(), cfg)
		if err != nil {
			return "", nil, err
		}
		return "upgrade staged", map[string]interface{}{
			"version":    info.Version,
			"stagedPath": info.StagedPath,
			"backupPath": info.BackupPath,
		}, nil

	case "apply-staged-upgrade":
		if err := applyStagedUpgrade(cfg); err != nil {
			return "", nil, err
		}
		return "upgrade helper started; service restart is expected", runtimeSnapshotPayload(cfg), nil

	default:
		return "", nil, fmt.Errorf("unsupported action type: %s", actionType)
	}
}

func runtimeSnapshotPayload(cfg *Config) map[string]interface{} {
	runtimeInfo, lastCommand, lastFile, lastError := snapshotHealth()
	startupChecks := snapshotStartupChecks()
	recoverySummary := snapshotRecoverySummary()
	watchdogSummary := snapshotWatchdogSummary()
	diagnosticsSnapshot := buildDiagnosticSnapshot(cfg)
	return map[string]interface{}{
		"deviceId":       cfg.DeviceID,
		"displayName":    cfg.DisplayName,
		"hostname":       cfg.Hostname,
		"username":       cfg.Username,
		"environment":    cfg.Environment,
		"runMode":        runtimeInfo.RunMode,
		"startupAt":      runtimeInfo.StartupAt.Format(time.RFC3339),
		"executablePath": runtimeInfo.ExecutablePath,
		"configPath":     cfg.ConfigPath,
		"logPath":        cfg.LogPath,
		"dataPath":       cfg.DataPath,
		"filesPath":      cfg.FilesPath,
		"tempPath":       cfg.TempPath,
		"processId":      os.Getpid(),
		"backendUrl":     cfg.ServerURL,
		"lastCommand":    lastCommand,
		"lastFile":       lastFile,
		"lastError":      lastError,
		"startupChecks":  startupChecks,
		"recovery":       recoverySummary,
		"watchdog":       watchdogSummary,
		"diagnostics":    diagnosticsSnapshot,
	}
}

func tailFile(path string, maxLines int) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Sprintf("unable to read log: %s", err)
	}

	text := sanitizeSensitiveText(string(data))
	lines := strings.Split(text, "\n")
	if len(lines) > maxLines {
		lines = lines[len(lines)-maxLines:]
	}
	return strings.Join(lines, "\n")
}

func sanitizeSensitiveText(value string) string {
	sensitive := []string{"agentToken", "AGENT_SHARED_SECRET", "enrollmentToken", "Authorization"}
	result := value
	for _, marker := range sensitive {
		result = strings.ReplaceAll(result, marker, marker+": [redacted]")
	}
	return result
}
