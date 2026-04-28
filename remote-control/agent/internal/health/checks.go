package health

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type ConfigView struct {
	ConfigPath  string
	ServerURL   string
	DeviceID    string
	OS          string
	LogPath     string
	DataPath    string
	TempPath    string
	FilesPath   string
	AgentToken  string
	ServiceName string
	RunMode     string
}

func CheckConfigFileExists(cfg ConfigView) CheckResult {
	info, err := os.Stat(cfg.ConfigPath)
	if err != nil {
		return failed("config-file-exists", SeverityCritical, "config file is not readable", err)
	}
	if info.IsDir() {
		return failed("config-file-exists", SeverityCritical, "config path points to a directory", nil)
	}
	return ok("config-file-exists", "config file exists")
}

func CheckConfigParses(cfg ConfigView) CheckResult {
	data, err := os.ReadFile(cfg.ConfigPath)
	if err != nil {
		return failed("config-parses", SeverityCritical, "config file cannot be read", err)
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return failed("config-parses", SeverityCritical, "config file is not valid JSON", err)
	}
	return ok("config-parses", "config JSON parses")
}

func CheckRequiredFields(cfg ConfigView) CheckResult {
	var missing []string
	if strings.TrimSpace(cfg.ServerURL) == "" {
		missing = append(missing, "serverUrl")
	}
	if strings.TrimSpace(cfg.DeviceID) == "" {
		missing = append(missing, "deviceId")
	}
	if strings.TrimSpace(cfg.OS) == "" {
		missing = append(missing, "os")
	}
	if len(missing) > 0 {
		return failed("required-fields", SeverityCritical, "required config fields are missing: "+strings.Join(missing, ", "), nil)
	}
	return ok("required-fields", "required config fields are present")
}

func CheckBackendURL(cfg ConfigView) CheckResult {
	parsed, err := url.Parse(strings.TrimSpace(cfg.ServerURL))
	if err != nil {
		return failed("backend-url", SeverityCritical, "backend URL is invalid", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return failed("backend-url", SeverityCritical, "backend URL must use http or https", nil)
	}
	if parsed.Host == "" {
		return failed("backend-url", SeverityCritical, "backend URL must include a host", nil)
	}
	return ok("backend-url", "backend URL is valid")
}

func CheckDeviceID(cfg ConfigView) CheckResult {
	if strings.TrimSpace(cfg.DeviceID) == "" {
		return failed("device-id", SeverityCritical, "device identity is missing", nil)
	}
	return ok("device-id", "device identity is available")
}

func CheckWritableDirs(cfg ConfigView) CheckResult {
	for _, dir := range []string{filepath.Dir(cfg.LogPath), cfg.DataPath, cfg.TempPath, cfg.FilesPath} {
		if strings.TrimSpace(dir) == "" {
			return failed("writable-dirs", SeverityCritical, "runtime directory path is empty", nil)
		}
		if err := os.MkdirAll(dir, 0755); err != nil {
			return failed("writable-dirs", SeverityCritical, "runtime directory cannot be created", fmt.Errorf("%s: %w", dir, err))
		}
		testFile, err := os.CreateTemp(dir, ".setulink-write-check-*")
		if err != nil {
			return failed("writable-dirs", SeverityCritical, "runtime directory is not writable", fmt.Errorf("%s: %w", dir, err))
		}
		name := testFile.Name()
		_ = testFile.Close()
		_ = os.Remove(name)
	}
	return ok("writable-dirs", "runtime directories are writable")
}

func CheckBackendConnectivity(ctx context.Context, cfg ConfigView) CheckResult {
	requestURL := strings.TrimRight(cfg.ServerURL, "/") + "/health"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return failed("backend-connectivity", SeverityWarning, "backend health request could not be built", err)
	}
	if cfg.AgentToken != "" {
		req.Header.Set("X-SetuLink-Agent-Token", cfg.AgentToken)
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return failed("backend-connectivity", SeverityWarning, "backend is not reachable during startup", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 500 {
		return failed("backend-connectivity", SeverityWarning, fmt.Sprintf("backend health returned status %d", resp.StatusCode), nil)
	}

	return ok("backend-connectivity", "backend is reachable")
}

func CheckServiceContext(cfg ConfigView) CheckResult {
	if cfg.RunMode != "windows-service" {
		return ok("service-context", "service context check skipped outside service mode")
	}
	if runtime.GOOS != "windows" {
		return failed("service-context", SeverityCritical, "windows-service run mode is only valid on Windows", nil)
	}
	if strings.TrimSpace(cfg.ServiceName) == "" {
		return failed("service-context", SeverityWarning, "service name is empty", nil)
	}
	return ok("service-context", "service context is valid")
}

func ok(name, message string) CheckResult {
	return CheckResult{Name: name, OK: true, Severity: SeverityWarning, Message: message}
}

func failed(name, severity, message string, err error) CheckResult {
	return CheckResult{Name: name, OK: false, Severity: severity, Message: message, Err: err}
}
