package main

import "fmt"

func markCommandStarted(cfg *Config, commandID string) error {
	payload := map[string]string{
		"commandId": commandID,
		"deviceId":  cfg.DeviceID,
	}

	if err := doAgentRequest(cfg, "POST", agentURL(cfg, "/api/agent/command-started", nil), payload, nil); err != nil {
		return fmt.Errorf("mark running request failed: %w", err)
	}

	return nil
}
