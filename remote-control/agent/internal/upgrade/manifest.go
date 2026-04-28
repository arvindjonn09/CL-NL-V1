package upgrade

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

type Manifest struct {
	Version                  string `json:"version"`
	DownloadURL              string `json:"downloadUrl"`
	SHA256                   string `json:"sha256"`
	SizeBytes                int64  `json:"sizeBytes"`
	MinimumCompatibleVersion string `json:"minimumCompatibleVersion,omitempty"`
}

func ParseManifest(data []byte) (Manifest, error) {
	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return Manifest{}, fmt.Errorf("parse manifest: %w", err)
	}
	if err := ValidateManifest(manifest); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func ValidateManifest(manifest Manifest) error {
	if strings.TrimSpace(manifest.Version) == "" {
		return fmt.Errorf("manifest version is required")
	}
	if strings.TrimSpace(manifest.DownloadURL) == "" {
		return fmt.Errorf("manifest downloadUrl is required")
	}
	parsed, err := url.Parse(manifest.DownloadURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("manifest downloadUrl is invalid")
	}
	if strings.TrimSpace(manifest.SHA256) == "" {
		return fmt.Errorf("manifest sha256 is required")
	}
	if manifest.SizeBytes <= 0 {
		return fmt.Errorf("manifest sizeBytes must be positive")
	}
	return nil
}
