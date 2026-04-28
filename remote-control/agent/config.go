package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/user"

	"setulinkpaths"
)

type Config struct {
	ServerURL       string `json:"serverUrl"`
	BackendURL      string `json:"backendUrl"`
	DeviceID        string `json:"deviceId"`
	Hostname        string `json:"hostname"`
	DisplayName     string `json:"displayName"`
	Username        string `json:"username"`
	Environment     string `json:"environmentLabel"`
	AgentToken      string `json:"agentToken"`
	LogPath         string `json:"logPath"`
	DataPath        string `json:"dataPath"`
	TempPath        string `json:"tempPath"`
	OS              string `json:"os"`
	Version         string `json:"version"`
	ConfigPath      string `json:"-"`
	FilesPath       string `json:"-"`
	DeviceStatePath string `json:"-"`
}

func LoadConfig(path string) (*Config, error) {
	layout, err := setulinkpaths.CurrentLayout()
	if err != nil {
		return nil, fmt.Errorf("resolve runtime layout: %w", err)
	}

	if err := setulinkpaths.EnsureRuntimeDirs(layout); err != nil {
		return nil, fmt.Errorf("ensure runtime directories: %w", err)
	}

	if path == "" {
		path = layout.ConfigPath
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	if cfg.ServerURL == "" && cfg.BackendURL != "" {
		cfg.ServerURL = cfg.BackendURL
	}
	if envURL := os.Getenv("AGENT_BACKEND_URL"); envURL != "" {
		cfg.ServerURL = envURL
		cfg.BackendURL = envURL
	}
	if cfg.AgentToken == "" {
		cfg.AgentToken = os.Getenv("AGENT_SHARED_SECRET")
	}
	if cfg.AgentToken == "" {
		cfg.AgentToken = "setulink-dev-agent-secret"
	}
	if cfg.Environment == "" {
		cfg.Environment = os.Getenv("SETULINK_ENVIRONMENT")
	}
	if cfg.Environment == "" {
		cfg.Environment = "unknown"
	}

	if cfg.ServerURL == "" {
		return nil, fmt.Errorf("serverUrl is required")
	}
	if cfg.OS == "" {
		return nil, fmt.Errorf("os is required")
	}
	if cfg.Version == "" {
		cfg.Version = "0.1.0"
	}

	identity, err := LoadOrCreateDeviceIdentity()
	if err != nil {
		return nil, fmt.Errorf("load device identity: %w", err)
	}

	cfg.DeviceID = identity.DeviceID
	cfg.DisplayName = identity.DisplayName
	if cfg.Hostname == "" {
		if hostname, err := os.Hostname(); err == nil {
			cfg.Hostname = hostname
		}
	}
	if cfg.Username == "" {
		if currentUser, err := user.Current(); err == nil {
			cfg.Username = currentUser.Username
		}
	}
	cfg.ConfigPath = path
	cfg.LogPath = layout.AgentLogPath
	cfg.DataPath = layout.DataDir
	cfg.TempPath = layout.TempDir
	cfg.FilesPath = layout.FilesDir
	cfg.DeviceStatePath = layout.DeviceStatePath

	return &cfg, nil
}
