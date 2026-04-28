package recovery

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type FileResult struct {
	DestinationPath  string
	BytesTransferred int64
}

func DownloadFile(ctx context.Context, policy Policy, client *http.Client, sourceURL string, destinationDir string, tempDir string, filename string) (FileResult, error) {
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}

	var result FileResult
	err := Do(ctx, policy, func(ctx context.Context) error {
		current, err := downloadFileOnce(ctx, client, sourceURL, destinationDir, tempDir, filename)
		if err != nil {
			return err
		}
		result = current
		return nil
	})
	if err != nil {
		return FileResult{}, err
	}
	return result, nil
}

func downloadFileOnce(ctx context.Context, client *http.Client, sourceURL string, destinationDir string, tempDir string, filename string) (FileResult, error) {
	if err := os.MkdirAll(destinationDir, 0755); err != nil {
		return FileResult{}, fmt.Errorf("mkdir destination: %w", err)
	}
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		return FileResult{}, fmt.Errorf("mkdir temp: %w", err)
	}

	safeName := filepath.Base(strings.TrimSpace(filename))
	if safeName == "." || safeName == string(filepath.Separator) || safeName == "" {
		return FileResult{}, fmt.Errorf("invalid filename")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return FileResult{}, fmt.Errorf("build download request: %w", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		return FileResult{}, fmt.Errorf("HTTP download error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return FileResult{}, &HTTPStatusError{StatusCode: resp.StatusCode}
	}

	tempFile, err := os.CreateTemp(tempDir, ".download-*")
	if err != nil {
		return FileResult{}, fmt.Errorf("create temp download: %w", err)
	}
	tempPath := tempFile.Name()
	success := false
	defer func() {
		_ = tempFile.Close()
		if !success {
			_ = os.Remove(tempPath)
		}
	}()

	bytesTransferred, err := io.Copy(tempFile, resp.Body)
	if err != nil {
		return FileResult{}, fmt.Errorf("copy download: %w", err)
	}
	if err := tempFile.Close(); err != nil {
		return FileResult{}, fmt.Errorf("close temp download: %w", err)
	}

	destinationPath := filepath.Join(destinationDir, safeName)
	if err := os.Rename(tempPath, destinationPath); err != nil {
		return FileResult{}, fmt.Errorf("commit download: %w", err)
	}

	success = true
	return FileResult{
		DestinationPath:  destinationPath,
		BytesTransferred: bytesTransferred,
	}, nil
}
