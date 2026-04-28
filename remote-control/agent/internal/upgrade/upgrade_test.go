package upgrade

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestValidateManifestRequiresCoreFields(t *testing.T) {
	err := ValidateManifest(Manifest{
		Version:     "0.2.0",
		DownloadURL: "https://example.com/setulink-agent.exe",
		SHA256:      "abc",
		SizeBytes:   42,
	})
	if err != nil {
		t.Fatalf("expected valid manifest: %v", err)
	}

	if err := ValidateManifest(Manifest{}); err == nil {
		t.Fatalf("expected invalid manifest error")
	}
}

func TestVerifyFileChecksumAndSize(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "agent.exe")
	content := []byte("new binary")
	if err := os.WriteFile(path, content, 0644); err != nil {
		t.Fatalf("write file: %v", err)
	}
	sum := sha256.Sum256(content)

	manifest := Manifest{
		Version:     "0.2.0",
		DownloadURL: "https://example.com/setulink-agent.exe",
		SHA256:      hex.EncodeToString(sum[:]),
		SizeBytes:   int64(len(content)),
	}
	if err := VerifyFile(path, manifest); err != nil {
		t.Fatalf("verify file: %v", err)
	}

	manifest.SHA256 = "bad"
	if err := VerifyFile(path, manifest); err == nil {
		t.Fatalf("expected checksum failure")
	}
}

func TestStageCreatesBackupAndPendingInfo(t *testing.T) {
	dir := t.TempDir()
	current := filepath.Join(dir, "setulink-agent.exe")
	downloaded := filepath.Join(dir, "downloaded.exe")
	if err := os.WriteFile(current, []byte("old binary"), 0755); err != nil {
		t.Fatalf("write current: %v", err)
	}
	content := []byte("new binary")
	if err := os.WriteFile(downloaded, content, 0755); err != nil {
		t.Fatalf("write downloaded: %v", err)
	}
	sum := sha256.Sum256(content)
	staging := filepath.Join(dir, "stage")

	info, err := Stage(Manifest{
		Version:     "0.2.0",
		DownloadURL: "https://example.com/setulink-agent.exe",
		SHA256:      hex.EncodeToString(sum[:]),
		SizeBytes:   int64(len(content)),
	}, downloaded, current, staging)
	if err != nil {
		t.Fatalf("stage: %v", err)
	}

	if _, err := os.Stat(info.BackupPath); err != nil {
		t.Fatalf("expected backup: %v", err)
	}
	read, err := ReadStageInfo(staging)
	if err != nil {
		t.Fatalf("read stage info: %v", err)
	}
	if read.Version != "0.2.0" || read.BackupPath == "" {
		t.Fatalf("unexpected stage info: %+v", read)
	}
}

func TestShouldRollbackUsesStartupTruth(t *testing.T) {
	state := State{Status: "applied-pending-startup", BackupPath: "backup.exe"}
	if !ShouldRollback(false, state) {
		t.Fatalf("expected rollback when startup failed")
	}
	if ShouldRollback(true, state) {
		t.Fatalf("did not expect rollback after startup success")
	}
	if ShouldRollback(false, State{Status: "success", BackupPath: "backup.exe"}) {
		t.Fatalf("did not expect rollback after success")
	}
}
