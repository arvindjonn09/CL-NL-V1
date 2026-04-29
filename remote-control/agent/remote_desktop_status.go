package main

import (
	"context"
	"sync"
)

type RemoteDesktopStatusRequest struct {
	DeviceID string `json:"deviceId"`
	Status   string `json:"status"`
	Reason   string `json:"reason,omitempty"`
}

type activeRemoteDesktopRuntime struct {
	cancel context.CancelFunc
	pipe   desktopPipeConn
}

var remoteDesktopRuntimes = struct {
	sync.Mutex
	active map[string]activeRemoteDesktopRuntime
}{
	active: make(map[string]activeRemoteDesktopRuntime),
}

func SendRemoteDesktopStatus(cfg *Config, sessionID, status, reason string) error {
	body := RemoteDesktopStatusRequest{
		DeviceID: cfg.DeviceID,
		Status:   status,
		Reason:   reason,
	}
	return doAgentRequest(cfg, "POST", agentURL(cfg, "/api/agent/remote-desktop/sessions/"+sessionID+"/status", nil), body, nil)
}

func isRemoteDesktopRuntimeActive(sessionID string) bool {
	remoteDesktopRuntimes.Lock()
	defer remoteDesktopRuntimes.Unlock()
	_, ok := remoteDesktopRuntimes.active[sessionID]
	return ok
}

func cancelActiveRemoteDesktopRuntime(sessionID string) {
	remoteDesktopRuntimes.Lock()
	runtime, ok := remoteDesktopRuntimes.active[sessionID]
	remoteDesktopRuntimes.Unlock()
	if ok && runtime.cancel != nil {
		runtime.cancel()
	}
}
