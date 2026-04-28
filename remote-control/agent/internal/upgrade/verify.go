package upgrade

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"strings"
)

var ErrNoApprovedUpgrade = fmt.Errorf("no approved upgrade manifest")

func VerifyFile(path string, manifest Manifest) error {
	if err := ValidateManifest(manifest); err != nil {
		return err
	}
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("stat upgrade file: %w", err)
	}
	if info.IsDir() {
		return fmt.Errorf("upgrade file path is a directory")
	}
	if info.Size() != manifest.SizeBytes {
		return fmt.Errorf("upgrade file size mismatch: got %d want %d", info.Size(), manifest.SizeBytes)
	}

	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open upgrade file: %w", err)
	}
	defer file.Close()

	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return fmt.Errorf("hash upgrade file: %w", err)
	}
	actual := hex.EncodeToString(hasher.Sum(nil))
	if !strings.EqualFold(actual, manifest.SHA256) {
		return fmt.Errorf("upgrade checksum mismatch: got %s want %s", actual, manifest.SHA256)
	}
	return nil
}
