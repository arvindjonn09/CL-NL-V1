package logging

import (
	"os"
	"path/filepath"
	"sync"
)

type Writer struct {
	mu        sync.Mutex
	path      string
	errorPath string
	maxBytes  int64
	keepFiles int
}

func NewWriter(logPath string) (*Writer, error) {
	if err := os.MkdirAll(filepath.Dir(logPath), 0755); err != nil {
		return nil, err
	}

	return &Writer{
		path:      logPath,
		errorPath: filepath.Join(filepath.Dir(logPath), "agent-error.log"),
		maxBytes:  defaultMaxLogBytes,
		keepFiles: defaultKeepFiles,
	}, nil
}

func (w *Writer) WriteLine(line []byte, mirrorError bool) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if err := w.writeTo(w.path, line); err != nil {
		return err
	}
	if mirrorError {
		return w.writeTo(w.errorPath, line)
	}
	return nil
}

func (w *Writer) writeTo(path string, line []byte) error {
	if err := rotateIfNeeded(path, w.maxBytes, w.keepFiles); err != nil {
		return err
	}

	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return err
	}
	defer file.Close()

	if _, err := file.Write(line); err != nil {
		return err
	}
	_, err = file.Write([]byte("\n"))
	return err
}
