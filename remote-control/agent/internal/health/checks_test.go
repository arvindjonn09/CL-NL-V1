package health

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestStartupChecksFailOnMissingRequiredFields(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "agent.json")
	if err := os.WriteFile(configPath, []byte(`{"serverUrl":"","os":""}`), 0644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	summary := RunStartupChecks(context.Background(), ConfigView{
		ConfigPath: configPath,
		LogPath:    filepath.Join(dir, "logs", "agent.log"),
		DataPath:   filepath.Join(dir, "data"),
		TempPath:   filepath.Join(dir, "temp"),
		FilesPath:  filepath.Join(dir, "files"),
	}, nil)

	if !summary.Fatal() {
		t.Fatalf("expected fatal startup summary")
	}
	if len(summary.Failed) == 0 {
		t.Fatalf("expected failed checks")
	}
}

func TestStartupChecksAllowBackendConnectivityWarning(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "agent.json")
	if err := os.WriteFile(configPath, []byte(`{"serverUrl":"http://127.0.0.1:1","os":"linux"}`), 0644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	summary := RunStartupChecks(context.Background(), ConfigView{
		ConfigPath: configPath,
		ServerURL:  "http://127.0.0.1:1",
		DeviceID:   "device-1",
		OS:         "linux",
		LogPath:    filepath.Join(dir, "logs", "agent.log"),
		DataPath:   filepath.Join(dir, "data"),
		TempPath:   filepath.Join(dir, "temp"),
		FilesPath:  filepath.Join(dir, "files"),
		RunMode:    "foreground",
	}, nil)

	if summary.Fatal() {
		t.Fatalf("did not expect fatal summary for connectivity warning")
	}
	if len(summary.Warnings) == 0 {
		t.Fatalf("expected backend connectivity warning")
	}
}
