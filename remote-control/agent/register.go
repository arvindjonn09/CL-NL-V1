package main

import "fmt"

type RegisterRequest struct {
	ID               string `json:"id"`
	DisplayName      string `json:"displayName"`
	Hostname         string `json:"hostname"`
	Username         string `json:"username"`
	OS               string `json:"os"`
	BackendURL       string `json:"backendUrl"`
	EnvironmentLabel string `json:"environmentLabel"`
}

func RegisterDevice(cfg *Config) error {
	payload := RegisterRequest{
		ID:               cfg.DeviceID,
		DisplayName:      cfg.DisplayName,
		Hostname:         cfg.Hostname,
		Username:         cfg.Username,
		OS:               cfg.OS,
		BackendURL:       cfg.ServerURL,
		EnvironmentLabel: cfg.Environment,
	}

	if err := doAgentRequest(cfg, "POST", agentURL(cfg, "/api/agent/register", nil), payload, nil); err != nil {
		return fmt.Errorf("register request failed: %w", err)
	}

	logger("registration").Info("success", "device registration successful", nil)
	return nil
}
