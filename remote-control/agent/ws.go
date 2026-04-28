package main

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type WSCommand struct {
	Type       string `json:"type"`
	CommandID  string `json:"commandId"`
	Command    string `json:"command"`
	ActionID   string `json:"actionId"`
	ActionType string `json:"actionType"`
	DeviceID   string `json:"deviceId"`
	SessionID  string `json:"sessionId"`
}

func StartWebSocket(cfg *Config) {
	backoff := time.Duration(0)
	for {
		err := connectAndListen(cfg)
		if err != nil {
			logger("websocket").Warn("listen", "websocket connection failed", err, nil)
		}

		backoff = nextBackoff(backoff)
		logger("websocket").Info("reconnect", "websocket reconnect scheduled", logMetadata("retryIn", backoff.String()))
		time.Sleep(backoff)
	}
}

func connectAndListen(cfg *Config) error {
	url, err := websocketURL(cfg.ServerURL)
	if err != nil {
		return err
	}

	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		return fmt.Errorf("dial error: %w", err)
	}
	defer conn.Close()

	logger("websocket").Info("connected", "websocket connected", nil)

	registerMsg := map[string]string{
		"type":       "register",
		"deviceId":   cfg.DeviceID,
		"agentToken": cfg.AgentToken,
	}

	if err := conn.WriteJSON(registerMsg); err != nil {
		return fmt.Errorf("register send failed: %w", err)
	}

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("read error: %w", err)
		}

		var cmd WSCommand
		if err := json.Unmarshal(message, &cmd); err != nil {
			logger("websocket").Warn("invalid-message", "invalid websocket message", err, nil)
			continue
		}

		if cmd.Type == "action" {
			ProcessAction(cfg, PendingAction{
				ID:         cmd.ActionID,
				DeviceID:   cmd.DeviceID,
				ActionType: cmd.ActionType,
			})
			continue
		}

		if cmd.Type == "remote-desktop-pending" {
			logger("websocket").Info("remote-desktop-push", "remote desktop pending session received via websocket", logMetadata("sessionId", cmd.SessionID))
			go ProcessRemoteDesktopPending(cfg)
			continue
		}

		if cmd.Type == "command" {
			logger("websocket").Info("command-received", "websocket command received", logMetadata("commandId", cmd.CommandID, "command", cmd.Command))

			// notify backend: command started
			if err := markCommandStarted(cfg, cmd.CommandID); err != nil {
				logger("commands").Warn("started", "command running status update failed", err, logMetadata("commandId", cmd.CommandID))
			} else {
				logger("commands").Info("started", "command marked running", logMetadata("commandId", cmd.CommandID))
			}

			logger("commands").Info("execute-start", "websocket command execution started", logMetadata("commandId", cmd.CommandID))

			started := time.Now()
			output, err := ExecuteCommandStreaming(cmd.Command, func(chunk string) {
				_ = conn.WriteJSON(map[string]interface{}{
					"type":      "output",
					"commandId": cmd.CommandID,
					"chunk":     chunk,
				})
			})
			exitCode := commandExitCode(err)
			errorMessage := ""
			status := "completed"
			if err != nil {
				status = "failed"
				errorMessage = err.Error()
				output = output + "\n" + errorMessage
			}
			logger("commands").Info("execute-end", "websocket command execution finished", logMetadata("commandId", cmd.CommandID, "exitCode", exitCode, "status", status))

			result := CommandExecutionResult{
				Stdout:       output,
				Stderr:       "",
				Output:       output,
				ExitCode:     exitCode,
				ErrorMessage: errorMessage,
				DurationMs:   time.Since(started).Milliseconds(),
				Err:          err,
			}

			recordCommandSummary(OperationSummary{
				ID:           cmd.CommandID,
				Command:      cmd.Command,
				Status:       status,
				ExitCode:     exitCode,
				ErrorMessage: errorMessage,
				DurationMs:   result.DurationMs,
			})

			if err := SendCommandResult(cfg, cmd.CommandID, result, status); err != nil {
				recordAgentError("command-result", err)
				logger("commands").Warn("result-post", "command result post failed", err, logMetadata("commandId", cmd.CommandID))
			} else {
				logger("commands").Info("result-post", "command result posted", logMetadata("commandId", cmd.CommandID, "status", status))
			}
		}
	}
}

func websocketURL(serverURL string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(serverURL))
	if err != nil {
		return "", fmt.Errorf("parse server URL: %w", err)
	}

	switch parsed.Scheme {
	case "http":
		parsed.Scheme = "ws"
	case "https":
		parsed.Scheme = "wss"
	default:
		return "", fmt.Errorf("unsupported server URL scheme for websocket: %s", parsed.Scheme)
	}

	parsed.Path = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""

	return parsed.String(), nil
}
