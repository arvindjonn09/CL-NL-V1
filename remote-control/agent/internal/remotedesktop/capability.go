package remotedesktop

import "runtime"

type Capability struct {
	Supported     bool   `json:"supported"`
	State         string `json:"state"`
	Relay         string `json:"relay"`
	ScreenCapture string `json:"screenCapture"`
	Input         string `json:"input"`
	Reason        string `json:"reason,omitempty"`
	Platform      string `json:"platform"`
}

func CurrentCapability() Capability {
	capability := Capability{
		Supported:     false,
		State:         "not_ready",
		Relay:         "websocket-relay",
		ScreenCapture: "not_ready",
		Input:         "not_ready",
		Reason:        "agent remote desktop relay runtime is not implemented on this platform yet",
		Platform:      runtime.GOOS,
	}

	if runtime.GOOS == "windows" {
		capability.Supported = true
		capability.Input = "ready"
		capability.ScreenCapture = "ready"
		capability.State = "ready"
		capability.Reason = "Windows native JPEG capture and WebSocket relay runtime ready"
	}

	return capability
}
