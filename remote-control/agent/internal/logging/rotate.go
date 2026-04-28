package logging

import (
	"fmt"
	"os"
)

const (
	defaultMaxLogBytes = 5 * 1024 * 1024
	defaultKeepFiles   = 5
)

func rotateIfNeeded(path string, maxBytes int64, keepFiles int) error {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if info.Size() < maxBytes {
		return nil
	}

	for i := keepFiles - 1; i >= 1; i-- {
		src := fmt.Sprintf("%s.%d", path, i)
		dst := fmt.Sprintf("%s.%d", path, i+1)
		if _, err := os.Stat(src); err == nil {
			_ = os.Rename(src, dst)
		}
	}

	return os.Rename(path, fmt.Sprintf("%s.1", path))
}
