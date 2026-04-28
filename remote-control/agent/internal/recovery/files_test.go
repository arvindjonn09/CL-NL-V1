package recovery

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDownloadFileDoesNotCommitPartialFile(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", "12")
		_, _ = w.Write([]byte("partial"))
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		hijacker, ok := w.(http.Hijacker)
		if !ok {
			return
		}
		conn, _, err := hijacker.Hijack()
		if err == nil {
			_ = conn.Close()
		}
	}))
	defer server.Close()

	dir := t.TempDir()
	destinationDir := filepath.Join(dir, "files")
	tempDir := filepath.Join(dir, "temp")
	policy := Policy{
		MaxAttempts:   1,
		InitialDelay:  time.Millisecond,
		JitterPercent: 0,
	}

	_, err := DownloadFile(context.Background(), policy, server.Client(), server.URL, destinationDir, tempDir, "payload.txt")
	if err == nil {
		t.Fatalf("expected partial download error")
	}

	if _, statErr := os.Stat(filepath.Join(destinationDir, "payload.txt")); !os.IsNotExist(statErr) {
		t.Fatalf("partial destination file should not exist, stat err: %v", statErr)
	}

	entries, readErr := os.ReadDir(tempDir)
	if readErr != nil {
		t.Fatalf("read temp dir: %v", readErr)
	}
	for _, entry := range entries {
		if entry.Name() != "" {
			t.Fatalf("expected partial temp files to be cleaned up, found %s", entry.Name())
		}
	}
}

func TestDownloadFileRetriesStatusAndCommitsOnSuccess(t *testing.T) {
	var attempts int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		attempts++
		if attempts == 1 {
			http.Error(w, "busy", http.StatusServiceUnavailable)
			return
		}
		_, _ = fmt.Fprint(w, "complete")
	}))
	defer server.Close()

	dir := t.TempDir()
	result, err := DownloadFile(context.Background(), Policy{
		MaxAttempts:   2,
		InitialDelay:  time.Millisecond,
		JitterPercent: 0,
		Sleep:         func(context.Context, time.Duration) error { return nil },
	}, server.Client(), server.URL, filepath.Join(dir, "files"), filepath.Join(dir, "temp"), "payload.txt")
	if err != nil {
		t.Fatalf("download failed: %v", err)
	}

	data, err := os.ReadFile(result.DestinationPath)
	if err != nil {
		t.Fatalf("read destination: %v", err)
	}
	if string(data) != "complete" || result.BytesTransferred != int64(len("complete")) {
		t.Fatalf("unexpected download result: %q %+v", string(data), result)
	}
	if attempts != 2 {
		t.Fatalf("expected retry, got %d attempts", attempts)
	}
}
