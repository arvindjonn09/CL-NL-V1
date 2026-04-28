package upgrade

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func Download(ctx context.Context, client *http.Client, manifest Manifest, stagingDir string) (string, error) {
	if err := ValidateManifest(manifest); err != nil {
		return "", err
	}
	if client == nil {
		client = &http.Client{Timeout: 2 * time.Minute}
	}
	if err := os.MkdirAll(stagingDir, 0755); err != nil {
		return "", fmt.Errorf("create upgrade staging dir: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, manifest.DownloadURL, nil)
	if err != nil {
		return "", fmt.Errorf("build upgrade download request: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("download upgrade: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download upgrade status %d", resp.StatusCode)
	}

	tmp, err := os.CreateTemp(stagingDir, ".upgrade-download-*")
	if err != nil {
		return "", fmt.Errorf("create upgrade temp file: %w", err)
	}
	tmpPath := tmp.Name()
	success := false
	defer func() {
		_ = tmp.Close()
		if !success {
			_ = os.Remove(tmpPath)
		}
	}()

	written, err := io.Copy(tmp, resp.Body)
	if err != nil {
		return "", fmt.Errorf("write upgrade download: %w", err)
	}
	if written != manifest.SizeBytes {
		return "", fmt.Errorf("upgrade size mismatch: got %d want %d", written, manifest.SizeBytes)
	}
	if err := tmp.Close(); err != nil {
		return "", fmt.Errorf("close upgrade download: %w", err)
	}

	finalPath := filepath.Join(stagingDir, "setulink-agent-"+manifest.Version+".exe")
	if err := os.Rename(tmpPath, finalPath); err != nil {
		return "", fmt.Errorf("stage upgrade download: %w", err)
	}
	success = true
	return finalPath, nil
}

func FetchManifest(ctx context.Context, client *http.Client, manifestURL string) (Manifest, error) {
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, manifestURL, nil)
	if err != nil {
		return Manifest{}, fmt.Errorf("build manifest request: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return Manifest{}, fmt.Errorf("fetch manifest: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNoContent || resp.StatusCode == http.StatusNotFound {
		return Manifest{}, ErrNoApprovedUpgrade
	}
	if resp.StatusCode != http.StatusOK {
		return Manifest{}, fmt.Errorf("fetch manifest status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
	if err != nil {
		return Manifest{}, fmt.Errorf("read manifest: %w", err)
	}
	return ParseManifest(data)
}
