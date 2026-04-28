package recovery

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type RuntimeDirs struct {
	LogDir   string
	DataDir  string
	TempDir  string
	FilesDir string
}

func RecreateMissingDirs(dirs RuntimeDirs) error {
	for _, dir := range []string{dirs.LogDir, dirs.DataDir, dirs.TempDir, dirs.FilesDir} {
		if strings.TrimSpace(dir) == "" {
			continue
		}
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("create runtime dir %s: %w", dir, err)
		}
	}
	return nil
}

func RebuildHTTPClient(timeout time.Duration) *http.Client {
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	return &http.Client{Timeout: timeout}
}

func ClearStaleTempDownloads(tempDir string, olderThan time.Duration) (int, error) {
	if strings.TrimSpace(tempDir) == "" || olderThan <= 0 {
		return 0, nil
	}

	entries, err := os.ReadDir(tempDir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}

	cutoff := time.Now().Add(-olderThan)
	removed := 0
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), ".download-") {
			continue
		}

		path := filepath.Join(tempDir, entry.Name())
		info, err := entry.Info()
		if err != nil || info.ModTime().After(cutoff) {
			continue
		}
		if err := os.Remove(path); err == nil {
			removed++
		}
	}
	return removed, nil
}
