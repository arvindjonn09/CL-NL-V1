package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestServiceRecoveryFailureArgs(t *testing.T) {
	got := serviceRecoveryFailureArgs("SetuLinkAgent")
	want := []string{
		"failure",
		"SetuLinkAgent",
		"reset=", "86400",
		"actions=", "restart/60000/restart/60000/restart/60000",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected service recovery args:\n got: %#v\nwant: %#v", got, want)
	}
}

func TestCopyDirectoryContentsCopiesNestedFFmpegFiles(t *testing.T) {
	src := t.TempDir()
	dst := filepath.Join(t.TempDir(), "ffmpeg")
	nested := filepath.Join(src, "licenses")

	if err := os.MkdirAll(nested, 0755); err != nil {
		t.Fatalf("mkdir nested: %v", err)
	}
	if err := os.WriteFile(filepath.Join(src, "ffmpeg.exe"), []byte("exe"), 0755); err != nil {
		t.Fatalf("write ffmpeg: %v", err)
	}
	if err := os.WriteFile(filepath.Join(nested, "notice.txt"), []byte("notice"), 0644); err != nil {
		t.Fatalf("write nested file: %v", err)
	}

	copied, err := copyDirectoryContents(src, dst)
	if err != nil {
		t.Fatalf("copy directory: %v", err)
	}
	if copied != 2 {
		t.Fatalf("unexpected copied file count: got %d want 2", copied)
	}

	if data, err := os.ReadFile(filepath.Join(dst, "ffmpeg.exe")); err != nil || string(data) != "exe" {
		t.Fatalf("unexpected ffmpeg copy data=%q err=%v", string(data), err)
	}
	if data, err := os.ReadFile(filepath.Join(dst, "licenses", "notice.txt")); err != nil || string(data) != "notice" {
		t.Fatalf("unexpected nested copy data=%q err=%v", string(data), err)
	}
}

func TestValidateInstallModePathsRequiresProgramFilesServiceBinary(t *testing.T) {
	ctx := &InstallerContext{
		Options: &InstallerOptions{},
		Paths: InstallPaths{
			InstallDir:      defaultInstallDir(),
			ProgramDataDir:  defaultProgramDataDir(),
			AgentBinaryDest: joinPath(defaultInstallDir(), "setulink-agent.exe"),
			ConfigPath:      joinPath(defaultProgramDataDir(), "config", "agent.json"),
		},
	}

	if err := validateInstallModePaths(ctx); err != nil {
		t.Fatalf("validateInstallModePaths() error = %v", err)
	}

	ctx.Paths.AgentBinaryDest = joinPath(defaultProgramDataDir(), "setulink-agent.exe")
	if err := validateInstallModePaths(ctx); err == nil {
		t.Fatalf("validateInstallModePaths() error = nil, want binary path validation error")
	}
}
