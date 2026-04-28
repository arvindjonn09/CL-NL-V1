package main

import "fmt"

type CommandResultRequest struct {
	CommandID    string `json:"commandId"`
	DeviceID     string `json:"deviceId"`
	Output       string `json:"output"`
	Status       string `json:"status"`
	ExitCode     int    `json:"exitCode"`
	Stdout       string `json:"stdout"`
	Stderr       string `json:"stderr"`
	ErrorMessage string `json:"errorMessage"`
	DurationMs   int64  `json:"durationMs"`
}

func SendCommandResult(cfg *Config, commandID string, result CommandExecutionResult, status string) error {
	payload := CommandResultRequest{
		CommandID:    commandID,
		DeviceID:     cfg.DeviceID,
		Output:       result.Output,
		Status:       status,
		ExitCode:     result.ExitCode,
		Stdout:       result.Stdout,
		Stderr:       result.Stderr,
		ErrorMessage: result.ErrorMessage,
		DurationMs:   result.DurationMs,
	}

	if err := doAgentRequest(cfg, "POST", agentURL(cfg, "/api/agent/command-result", nil), payload, nil); err != nil {
		return fmt.Errorf("send command result failed: %w", err)
	}

	logger("commands").Info("result-sent", "command result sent", logMetadata("commandId", commandID, "status", status))
	return nil
}
