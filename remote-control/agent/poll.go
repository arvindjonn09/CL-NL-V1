package main

import (
	"fmt"
	"net/url"
)

type PendingCommand struct {
	ID      string `json:"id"`
	Command string `json:"command"`
}

func FetchNextCommand(cfg *Config) (*PendingCommand, error) {
	query := url.Values{}
	query.Set("id", cfg.DeviceID)

	var cmd PendingCommand
	if err := doAgentRequest(cfg, "GET", agentURL(cfg, "/api/agent/next-command", query), nil, &cmd); err != nil {
		return nil, fmt.Errorf("fetch next command failed: %w", err)
	}

	if cmd.Command == "" {
		return nil, nil
	}

	return &cmd, nil
}
