//go:build !windows && !linux

package remotedesktop

import (
	"context"
	"fmt"
)

type FFmpegRuntime struct {
	Path   string
	Source string
}

func CheckCaptureRuntime() error {
	return fmt.Errorf("Windows desktop capture is required for Phase 10B and this agent is running on a non-Windows platform")
}

func ResolveFFmpeg() (FFmpegRuntime, error) {
	return FFmpegRuntime{Source: "unsupported"}, CheckCaptureRuntime()
}

func StartCapture(_ context.Context) (CaptureProcess, error) {
	return nil, CheckCaptureRuntime()
}

func CurrentCaptureEnvironment() CaptureEnvironment {
	return CaptureEnvironment{
		State:            "not_ready",
		CaptureAvailable: false,
		LaunchMode:       "unsupported",
		Reason:           "desktop capture is only supported on Windows",
	}
}
