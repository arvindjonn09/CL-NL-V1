package remotedesktop

import (
	"os/exec"
	"strconv"
	"strings"
)

func captureCommandArgs() []string {
	return []string{
		"-hide_banner",
		"-loglevel", "warning",
		"-f", "gdigrab",
		"-framerate", "24",
		"-i", "desktop",
		"-an",
		"-vf", "format=yuv420p",
		"-c:v", "libvpx",
		"-pix_fmt", "yuv420p",
		"-deadline", "realtime",
		"-cpu-used", "8",
		"-b:v", "1200k",
		"-auto-alt-ref", "0",
		"-f", "ivf",
		"pipe:1",
	}
}

func CaptureCommandLine(cmd *exec.Cmd) string {
	if cmd == nil {
		return ""
	}
	return CaptureCommandLineFromArgs(cmd.Args)
}

func CaptureCommandLineFromArgs(args []string) string {
	if len(args) == 0 {
		return ""
	}
	parts := make([]string, 0, len(args))
	for _, arg := range args {
		parts = append(parts, quoteCommandArg(arg))
	}
	return strings.Join(parts, " ")
}

func quoteCommandArg(arg string) string {
	if arg == "" || strings.ContainsAny(arg, " \t\r\n\"") {
		return strconv.Quote(arg)
	}
	return arg
}
