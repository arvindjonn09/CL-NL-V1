package remotedesktop

import (
	"os/exec"
	"strings"
	"testing"
)

func TestCaptureCommandArgsConvertGdigrabToVP8IVF(t *testing.T) {
	args := captureCommandArgs()

	assertArgPair(t, args, "-f", "gdigrab")
	assertArgPair(t, args, "-loglevel", "warning")
	assertArgPair(t, args, "-i", "desktop")
	assertArgPair(t, args, "-vf", "format=yuv420p")
	assertArgPair(t, args, "-c:v", "libvpx")
	assertArgPair(t, args, "-pix_fmt", "yuv420p")
	assertArgPair(t, args, "-auto-alt-ref", "0")
	assertArgPair(t, args, "-f", "ivf")

	if args[len(args)-1] != "pipe:1" {
		t.Fatalf("expected IVF output to go to stdout pipe, got %q", args[len(args)-1])
	}
}

func TestCaptureCommandLineQuotesExecutablePath(t *testing.T) {
	cmd := exec.Command(`C:\Program Files\SetuLink\ffmpeg\ffmpeg.exe`, captureCommandArgs()...)
	line := CaptureCommandLine(cmd)

	if !strings.Contains(line, strconvQuote(`C:\Program Files\SetuLink\ffmpeg\ffmpeg.exe`)) {
		t.Fatalf("expected executable path with spaces to be quoted, got %s", line)
	}
	if !strings.Contains(line, "-vf format=yuv420p") {
		t.Fatalf("expected command line to include pixel-format filter, got %s", line)
	}
}

func assertArgPair(t *testing.T, args []string, flag string, value string) {
	t.Helper()

	for index := range args {
		if args[index] == flag && index+1 < len(args) && args[index+1] == value {
			return
		}
	}
	t.Fatalf("expected %s %s in %v", flag, value, args)
}

func strconvQuote(value string) string {
	return `"` + strings.ReplaceAll(value, `\`, `\\`) + `"`
}
