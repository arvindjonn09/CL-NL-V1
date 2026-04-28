package upgrade

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

type StageInfo struct {
	Version        string `json:"version"`
	StagedPath     string `json:"stagedPath"`
	BackupPath     string `json:"backupPath"`
	CurrentPath    string `json:"currentPath"`
	ChecksumSHA256 string `json:"checksumSha256"`
	SizeBytes      int64  `json:"sizeBytes"`
	CreatedAt      string `json:"createdAt"`
}

func Stage(manifest Manifest, downloadedPath string, currentBinaryPath string, stagingDir string) (StageInfo, error) {
	if err := VerifyFile(downloadedPath, manifest); err != nil {
		return StageInfo{}, err
	}
	if err := os.MkdirAll(stagingDir, 0755); err != nil {
		return StageInfo{}, fmt.Errorf("create staging dir: %w", err)
	}
	if _, err := os.Stat(currentBinaryPath); err != nil {
		return StageInfo{}, fmt.Errorf("stat current binary: %w", err)
	}

	backupPath := filepath.Join(stagingDir, "setulink-agent.backup.exe")
	if err := copyFile(currentBinaryPath, backupPath); err != nil {
		return StageInfo{}, fmt.Errorf("backup current binary: %w", err)
	}

	info := StageInfo{
		Version:        manifest.Version,
		StagedPath:     downloadedPath,
		BackupPath:     backupPath,
		CurrentPath:    currentBinaryPath,
		ChecksumSHA256: manifest.SHA256,
		SizeBytes:      manifest.SizeBytes,
		CreatedAt:      time.Now().UTC().Format(time.RFC3339),
	}
	return info, WriteStageInfo(stagingDir, info)
}

func WriteStageInfo(stagingDir string, info StageInfo) error {
	data, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal stage info: %w", err)
	}
	return os.WriteFile(filepath.Join(stagingDir, "pending-upgrade.json"), data, 0644)
}

func ReadStageInfo(stagingDir string) (StageInfo, error) {
	data, err := os.ReadFile(filepath.Join(stagingDir, "pending-upgrade.json"))
	if err != nil {
		return StageInfo{}, err
	}
	var info StageInfo
	if err := json.Unmarshal(data, &info); err != nil {
		return StageInfo{}, err
	}
	return info, nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}
