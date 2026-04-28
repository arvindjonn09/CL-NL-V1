package main

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"os/user"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"setulinkpaths"
)

type DeviceIdentity struct {
	DeviceID    string `json:"deviceId"`
	DisplayName string `json:"displayName"`
	Hostname    string `json:"hostname,omitempty"`
}

func getDeviceIdentityPath() (string, error) {
	layout, err := setulinkpaths.CurrentLayout()
	if err != nil {
		return "", err
	}
	return layout.DeviceStatePath, nil
}

func LoadOrCreateDeviceIdentity() (*DeviceIdentity, error) {
	path, err := getDeviceIdentityPath()
	if err != nil {
		return nil, err
	}

	if err := migrateLegacyDeviceIdentity(path); err != nil {
		return nil, err
	}

	if _, err := os.Stat(path); err == nil {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read device identity: %w", err)
		}

		var identity DeviceIdentity
		if err := json.Unmarshal(data, &identity); err != nil {
			return replaceInvalidDeviceIdentity(path, fmt.Errorf("parse device identity: %w", err))
		}

		if identity.DisplayName == "" {
			identity.DisplayName = identity.Hostname
		}

		if identity.DeviceID == "" || identity.DisplayName == "" || !isValidDeviceID(identity.DeviceID) {
			return replaceInvalidDeviceIdentity(path, fmt.Errorf("device identity file is incomplete or invalid"))
		}

		return &identity, nil
	}

	identity, err := createDeviceIdentity()
	if err != nil {
		return nil, err
	}

	data, err := json.MarshalIndent(identity, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal device identity: %w", err)
	}

	if err := os.WriteFile(path, data, 0644); err != nil {
		return nil, fmt.Errorf("write device identity: %w", err)
	}

	return identity, nil
}

func replaceInvalidDeviceIdentity(path string, cause error) (*DeviceIdentity, error) {
	backupPath := fmt.Sprintf("%s.invalid-%s", path, time.Now().UTC().Format("20060102T150405Z"))
	if err := os.Rename(path, backupPath); err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("%w; backup invalid device identity: %v", cause, err)
	}

	identity, err := createDeviceIdentity()
	if err != nil {
		return nil, fmt.Errorf("%w; create replacement device identity: %v", cause, err)
	}

	data, err := json.MarshalIndent(identity, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal replacement device identity: %w", err)
	}

	if err := os.WriteFile(path, data, 0644); err != nil {
		return nil, fmt.Errorf("write replacement device identity: %w", err)
	}

	return identity, nil
}

func isValidDeviceID(value string) bool {
	_, err := uuid.Parse(value)
	return err == nil
}

func migrateLegacyDeviceIdentity(targetPath string) error {
	layout, err := setulinkpaths.CurrentLayout()
	if err != nil {
		return err
	}

	legacyCandidates := []string{
		filepath.Join(layout.ProgramDataDir, "device"),
		filepath.Join(layout.ProgramDataDir, "device", "device.json"),
	}

	if _, err := os.Stat(targetPath); err == nil {
		return nil
	}

	for _, legacyPath := range legacyCandidates {
		info, err := os.Stat(legacyPath)
		if err != nil || info.IsDir() {
			continue
		}

		data, readErr := os.ReadFile(legacyPath)
		if readErr != nil {
			return fmt.Errorf("read legacy device identity %s: %w", legacyPath, readErr)
		}

		if err := os.WriteFile(targetPath, data, 0644); err != nil {
			return fmt.Errorf("migrate device identity to %s: %w", targetPath, err)
		}

		return nil
	}

	return nil
}

func createDeviceIdentity() (*DeviceIdentity, error) {
	realHostname, err := os.Hostname()
	if err != nil || strings.TrimSpace(realHostname) == "" {
		realHostname = "unknown-host"
	}

	currentUser, err := user.Current()
	username := "unknown-user"
	if err == nil && currentUser.Username != "" {
		username = currentUser.Username
		if strings.Contains(username, `\`) {
			parts := strings.Split(username, `\`)
			username = parts[len(parts)-1]
		}
		if strings.Contains(username, "/") {
			parts := strings.Split(username, "/")
			username = parts[len(parts)-1]
		}
	}

	suffix, err := randomFiveDigits()
	if err != nil {
		return nil, fmt.Errorf("generate random suffix: %w", err)
	}

	displayName := fmt.Sprintf("%s-%s-%s",
		sanitizeName(realHostname),
		sanitizeName(username),
		suffix,
	)

	return &DeviceIdentity{
		DeviceID:    uuid.New().String(),
		DisplayName: displayName,
	}, nil
}

func randomFiveDigits() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(90000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%05d", n.Int64()+10000), nil
}

func sanitizeName(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "unknown"
	}

	replacer := strings.NewReplacer(
		" ", "-",
		`\\`, "-",
		`\`, "-",
		"/", "-",
		":", "-",
		"*", "-",
		"?", "-",
		`"`, "-",
		"<", "-",
		">", "-",
		"|", "-",
	)
	s = replacer.Replace(s)
	return s
}
