//go:build linux

package remotedesktop

import (
	"context"
	"fmt"
	"os"
	"os/exec"
)

const (
	linuxBundledFFmpegPath = "/opt/setulink/ffmpeg/ffmpeg"
	linuxSystemFFmpegPath  = "/usr/bin/ffmpeg"
)

type FFmpegRuntime struct {
	Path   string
	Source string
}

func CheckCaptureRuntime() error {
	_, err := ResolveFFmpeg()
	if err != nil {
		return err
	}
	return fmt.Errorf("Linux ffmpeg is available, but unattended Linux desktop capture is not implemented by this agent")
}

func ResolveFFmpeg() (FFmpegRuntime, error) {
	if isExecutableFile(linuxBundledFFmpegPath) {
		return FFmpegRuntime{Path: linuxBundledFFmpegPath, Source: "bundled"}, nil
	}

	if isExecutableFile(linuxSystemFFmpegPath) {
		return FFmpegRuntime{Path: linuxSystemFFmpegPath, Source: "system"}, nil
	}

	path, err := exec.LookPath("ffmpeg")
	if err == nil && isExecutableFile(path) {
		return FFmpegRuntime{Path: path, Source: "path"}, nil
	}

	return FFmpegRuntime{Path: linuxBundledFFmpegPath, Source: "missing"}, fmt.Errorf("ffmpeg is required for remote desktop capture; checked bundled %s, system %s, and PATH lookup", linuxBundledFFmpegPath, linuxSystemFFmpegPath)
}

func isExecutableFile(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	return info.Mode()&0111 != 0
}

func StartCapture(_ context.Context) (CaptureProcess, error) {
	return nil, CheckCaptureRuntime()
}

func CurrentCaptureEnvironment() CaptureEnvironment {
	return CaptureEnvironment{
		State:            "not_ready",
		CaptureAvailable: false,
		LaunchMode:       "unsupported",
		Reason:           "Linux unattended desktop capture is not implemented by this agent",
		Metadata:         map[string]any{"platform": "linux"},
	}
}
