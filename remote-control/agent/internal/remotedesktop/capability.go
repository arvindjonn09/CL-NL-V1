package remotedesktop

import "runtime"

type Capability struct {
	Supported          bool                `json:"supported"`
	State              string              `json:"state"`
	WebRTC             string              `json:"webrtc"`
	ScreenCapture      string              `json:"screenCapture"`
	Input              string              `json:"input"`
	Reason             string              `json:"reason,omitempty"`
	Platform           string              `json:"platform"`
	FfmpegPath         string              `json:"ffmpegPath,omitempty"`
	FfmpegSource       string              `json:"ffmpegSource,omitempty"`
	CaptureEnvironment *CaptureEnvironment `json:"captureEnvironment,omitempty"`
}

func CurrentCapability() Capability {
	capability := Capability{
		Supported:     false,
		State:         "not_ready",
		WebRTC:        "not_ready",
		ScreenCapture: "not_ready",
		Input:         "not_ready",
		Reason:        "agent remote desktop relay runtime is not implemented on this platform yet",
		Platform:      runtime.GOOS,
		FfmpegSource:  "unsupported",
	}

	if runtime.GOOS == "windows" {
		capability.Supported = true
		capability.WebRTC = "relay"
		capability.FfmpegSource = ""
		capability.Input = "ready"
		captureEnvironment := CurrentCaptureEnvironment()
		capability.CaptureEnvironment = &captureEnvironment
		capability.ScreenCapture = captureEnvironment.State
		if captureEnvironment.CaptureAvailable {
			capability.State = "ready"
			capability.Reason = "Windows native JPEG capture and WebSocket relay runtime ready"
		} else {
			capability.State = "not_ready"
			capability.Reason = captureEnvironment.Reason
		}
	}

	if runtime.GOOS == "linux" {
		ffmpeg, err := ResolveFFmpeg()
		capability.FfmpegPath = ffmpeg.Path
		capability.FfmpegSource = ffmpeg.Source
		if err != nil {
			capability.Reason = err.Error()
			return capability
		}
		capability.Reason = "Linux ffmpeg runtime found; unattended Linux desktop capture is not implemented by this agent"
	}

	return capability
}
