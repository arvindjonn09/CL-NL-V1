package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"setulinkpaths"
)

type InstallerOptions struct {
	InstallDir          string
	ProgramDataDir      string
	BackendURL          string
	DefaultBackendURL   string
	Version             string
	AgentBinarySource   string
	UpdaterBinarySource string
	FfmpegSourceDir     string
	TemplatePath        string
	SkipLaunch          bool
	PortableMode        bool
}

type InstallState struct {
	ExistingInstall  bool
	ExistingBinary   bool
	ExistingConfig   bool
	ExistingIdentity bool
}

type InstallPaths struct {
	InstallDir        string
	ProgramDataDir    string
	ConfigDir         string
	LogsDir           string
	FilesDir          string
	DataDir           string
	TempDir           string
	DeviceStatePath   string
	AgentBinaryDest   string
	UpdaterBinaryDest string
	FfmpegDir         string
	FfmpegBinaryDest  string
	ConfigPath        string
	InstallerLogPath  string
	AgentLogPath      string
}

type InstallerContext struct {
	Options *InstallerOptions
	Paths   InstallPaths
	State   InstallState
	logFile *os.File
}

type InstallerConfig struct {
	BackendURL         string `json:"backendUrl"`
	ServerURL          string `json:"serverUrl"`
	DeviceID           string `json:"deviceId"`
	DeviceIdentityMode string `json:"deviceIdentityMode"`
	InstallID          string `json:"installId"`
	LogPath            string `json:"logPath"`
	DataPath           string `json:"dataPath"`
	TempPath           string `json:"tempPath"`
	FirstRunAt         string `json:"firstRunAt"`
	Version            string `json:"version"`
	AgentToken         string `json:"agentToken"`
	EnvironmentLabel   string `json:"environmentLabel"`
	OS                 string `json:"os"`
}

type launchedAgent struct {
	cmd    *exec.Cmd
	exitCh chan error
}

const (
	serviceName                = "SetuLinkAgent"
	serviceDisplayName         = "SetuLink Agent"
	serviceDescription         = "Runs the SetuLink remote-control agent in the background."
	serviceRestartDelayMs      = 60000
	serviceFailureResetSeconds = 86400
	publicAPIExample           = "https://netraapi.shivomsangha.com"
	frontendHost               = "netralink.shivomsangha.com"
)

func newInstallerContext(opts *InstallerOptions) (*InstallerContext, error) {
	layout := setulinkpaths.LayoutForBase(opts.InstallDir, opts.ProgramDataDir)
	paths := InstallPaths{
		InstallDir:        layout.InstallDir,
		ProgramDataDir:    layout.ProgramDataDir,
		ConfigDir:         layout.ConfigDir,
		LogsDir:           layout.LogsDir,
		FilesDir:          layout.FilesDir,
		DataDir:           layout.DataDir,
		TempDir:           layout.TempDir,
		DeviceStatePath:   layout.DeviceStatePath,
		AgentBinaryDest:   joinPath(layout.InstallDir, "setulink-agent.exe"),
		UpdaterBinaryDest: joinPath(layout.InstallDir, "setulink-updater.exe"),
		FfmpegDir:         layout.FfmpegDir,
		FfmpegBinaryDest:  layout.FfmpegPath,
		ConfigPath:        layout.ConfigPath,
		InstallerLogPath:  layout.InstallerLogPath,
		AgentLogPath:      layout.AgentLogPath,
	}
	state := detectInstallState(paths)

	if err := ensureDirectory(paths.LogsDir); err != nil {
		return nil, fmt.Errorf("create installer log directory: %w", err)
	}

	logFile, err := os.OpenFile(paths.InstallerLogPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return nil, fmt.Errorf("open installer log: %w", err)
	}

	ctx := &InstallerContext{
		Options: opts,
		Paths:   paths,
		State:   state,
		logFile: logFile,
	}
	ctx.writeInstallerLog("INFO", "installer context initialized")
	if opts.PortableMode {
		ctx.writeInstallerLog("INFO", "effective install mode: portable/debug")
	} else {
		ctx.writeInstallerLog("INFO", "effective install mode: normal")
	}
	ctx.writeInstallerLog("INFO", "install path chosen: "+paths.InstallDir)
	ctx.writeInstallerLog("INFO", "runtime path chosen: "+paths.ProgramDataDir)
	ctx.writeInstallerLog("INFO", "binary source path: "+opts.AgentBinarySource)
	ctx.writeInstallerLog("INFO", "updater source path: "+opts.UpdaterBinarySource)
	ctx.writeInstallerLog("INFO", "ffmpeg source path: "+opts.FfmpegSourceDir)
	ctx.writeInstallerLog("INFO", "binary destination path: "+paths.AgentBinaryDest)
	ctx.writeInstallerLog("INFO", "updater destination path: "+paths.UpdaterBinaryDest)
	ctx.writeInstallerLog("INFO", "ffmpeg destination path: "+paths.FfmpegDir)
	ctx.writeInstallerLog("INFO", "config destination path: "+paths.ConfigPath)
	if state.ExistingInstall {
		ctx.writeInstallerLog("INFO", "reinstall/repair mode: existing install detected")
	} else {
		ctx.writeInstallerLog("INFO", "reinstall/repair mode: fresh install")
	}
	if state.ExistingConfig {
		ctx.writeInstallerLog("INFO", "existing config detected: "+paths.ConfigPath)
	} else {
		ctx.writeInstallerLog("INFO", "no existing config detected: "+paths.ConfigPath)
	}
	if state.ExistingIdentity {
		ctx.writeInstallerLog("INFO", "existing device identity detected: "+paths.DeviceStatePath)
	} else {
		ctx.writeInstallerLog("INFO", "no existing device identity detected: "+paths.DeviceStatePath)
	}
	return ctx, nil
}

func (ctx *InstallerContext) Close() {
	if ctx.logFile != nil {
		_ = ctx.logFile.Close()
	}
}

func (ctx *InstallerContext) writeInstallerLog(level, message string) {
	line := fmt.Sprintf("%s [%s] %s\n", time.Now().Format(time.RFC3339), level, message)
	fmt.Print(line)
	if ctx.logFile != nil {
		_, _ = ctx.logFile.WriteString(line)
	}
}

func detectInstallState(paths InstallPaths) InstallState {
	state := InstallState{
		ExistingBinary:   fileExists(paths.AgentBinaryDest),
		ExistingConfig:   fileExists(paths.ConfigPath),
		ExistingIdentity: fileExists(paths.DeviceStatePath),
	}
	state.ExistingInstall = state.ExistingBinary || state.ExistingConfig || state.ExistingIdentity
	return state
}

func runInstall(ctx *InstallerContext) error {
	ctx.writeInstallerLog("INFO", "starting SetuLink Phase 2 install: Windows service mode")

	if err := validateInstallModePaths(ctx); err != nil {
		return err
	}

	for _, dir := range []string{
		ctx.Paths.InstallDir,
		ctx.Paths.ProgramDataDir,
		ctx.Paths.ConfigDir,
		ctx.Paths.LogsDir,
		ctx.Paths.FilesDir,
		ctx.Paths.DataDir,
		ctx.Paths.TempDir,
		ctx.Paths.FfmpegDir,
	} {
		if err := ensureDirectory(dir); err != nil {
			return fmt.Errorf("ensure directory %s: %w", dir, err)
		}
		ctx.writeInstallerLog("INFO", "ensured directory: "+dir)
	}

	if _, err := selectAndValidateBackendURL(ctx); err != nil {
		return err
	}

	serviceStopped, err := stopServiceForInstall(ctx)
	if err != nil {
		return err
	}

	if err := stopExistingAgent(ctx); err != nil {
		return err
	}

	ctx.writeInstallerLog("INFO", fmt.Sprintf("binary copy start: source=%s dest=%s", ctx.Options.AgentBinarySource, ctx.Paths.AgentBinaryDest))
	if err := copyFileSafe(ctx.Options.AgentBinarySource, ctx.Paths.AgentBinaryDest); err != nil {
		ctx.writeInstallerLog("ERROR", "binary copy failure: "+err.Error())
		return rollbackRestartAfterFailure(ctx, serviceStopped, fmt.Errorf("copy agent binary: %w", err))
	}
	ctx.writeInstallerLog("INFO", "binary copy success: "+ctx.Paths.AgentBinaryDest)
	if !fileExists(ctx.Paths.AgentBinaryDest) {
		return fmt.Errorf("Program Files binary missing after copy: %s", ctx.Paths.AgentBinaryDest)
	}
	ctx.writeInstallerLog("INFO", "Program Files binary verified after copy: "+ctx.Paths.AgentBinaryDest)

	ctx.writeInstallerLog("INFO", fmt.Sprintf("updater copy start: source=%s dest=%s", ctx.Options.UpdaterBinarySource, ctx.Paths.UpdaterBinaryDest))
	if err := copyFileSafe(ctx.Options.UpdaterBinarySource, ctx.Paths.UpdaterBinaryDest); err != nil {
		ctx.writeInstallerLog("ERROR", "updater copy failure: "+err.Error())
		return rollbackRestartAfterFailure(ctx, serviceStopped, fmt.Errorf("copy updater helper: %w", err))
	}
	ctx.writeInstallerLog("INFO", "updater copy success: "+ctx.Paths.UpdaterBinaryDest)
	if !fileExists(ctx.Paths.UpdaterBinaryDest) {
		return fmt.Errorf("Program Files updater helper missing after copy: %s", ctx.Paths.UpdaterBinaryDest)
	}

	ctx.writeInstallerLog("INFO", "ffmpeg source path: "+ctx.Options.FfmpegSourceDir)
	ctx.writeInstallerLog("INFO", "ffmpeg destination path: "+ctx.Paths.FfmpegDir)
	ctx.writeInstallerLog("INFO", fmt.Sprintf("ffmpeg source exists: %t", directoryExists(ctx.Options.FfmpegSourceDir)))
	ctx.writeInstallerLog("INFO", fmt.Sprintf("ffmpeg copy start: source=%s dest=%s", ctx.Options.FfmpegSourceDir, ctx.Paths.FfmpegDir))
	ffmpegFilesCopied, err := copyDirectoryContents(ctx.Options.FfmpegSourceDir, ctx.Paths.FfmpegDir)
	if err != nil {
		ctx.writeInstallerLog("ERROR", "ffmpeg copy failure: "+err.Error())
		return rollbackRestartAfterFailure(ctx, serviceStopped, fmt.Errorf("copy bundled ffmpeg: %w", err))
	}
	ctx.writeInstallerLog("INFO", fmt.Sprintf("number of ffmpeg files copied: %d", ffmpegFilesCopied))
	ctx.writeInstallerLog("INFO", "ffmpeg copy success: "+ctx.Paths.FfmpegDir)
	ctx.writeInstallerLog("INFO", "post-copy ffmpeg verification path: "+ctx.Paths.FfmpegBinaryDest)
	if err := validateInstalledFfmpeg(ctx); err != nil {
		ctx.writeInstallerLog("ERROR", "post-copy ffmpeg verification failed: "+err.Error())
		return rollbackRestartAfterFailure(ctx, serviceStopped, err)
	}
	ctx.writeInstallerLog("INFO", "Program Files ffmpeg verified after copy: "+ctx.Paths.FfmpegBinaryDest)

	config, err := writeConfig(ctx)
	if err != nil {
		return rollbackRestartAfterFailure(ctx, serviceStopped, err)
	}
	ctx.writeInstallerLog("INFO", "wrote config to "+ctx.Paths.ConfigPath)

	if err := installOrUpdateService(ctx); err != nil {
		return rollbackRestartAfterFailure(ctx, serviceStopped, err)
	}

	if ctx.Options.SkipLaunch {
		ctx.writeInstallerLog("INFO", "skip-launch enabled; service installed but not started")
		return nil
	}

	logOffset := fileSize(ctx.Paths.AgentLogPath)
	action := "service start"
	if serviceStopped {
		action = "service restart"
	}
	if err := startService(ctx, action); err != nil {
		return err
	}

	if err := validateServiceInstall(ctx, config, logOffset); err != nil {
		return err
	}

	return nil
}

func rollbackRestartAfterFailure(ctx *InstallerContext, serviceStopped bool, cause error) error {
	if serviceStopped {
		ctx.writeInstallerLog("WARN", "install failed after an existing service was stopped; attempting rollback restart")
		if restartErr := startService(ctx, "rollback restart"); restartErr != nil {
			ctx.writeInstallerLog("ERROR", "rollback restart failed: "+restartErr.Error())
		}
	}
	return cause
}

func ensureDirectory(path string) error {
	return os.MkdirAll(path, 0755)
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func directoryExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func validateInstallModePaths(ctx *InstallerContext) error {
	if ctx.Options.PortableMode {
		return nil
	}

	expectedInstallDir := defaultInstallDir()
	expectedProgramDataDir := defaultProgramDataDir()
	expectedBinary := joinPath(expectedInstallDir, "setulink-agent.exe")
	expectedConfig := joinPath(expectedProgramDataDir, "config", "agent.json")

	if !samePath(ctx.Paths.InstallDir, expectedInstallDir) {
		return fmt.Errorf("normal install mode requires install dir %s, got %s", expectedInstallDir, ctx.Paths.InstallDir)
	}
	if !samePath(ctx.Paths.ProgramDataDir, expectedProgramDataDir) {
		return fmt.Errorf("normal install mode requires ProgramData dir %s, got %s", expectedProgramDataDir, ctx.Paths.ProgramDataDir)
	}
	if !samePath(ctx.Paths.AgentBinaryDest, expectedBinary) {
		return fmt.Errorf("normal install mode requires binary destination %s, got %s", expectedBinary, ctx.Paths.AgentBinaryDest)
	}
	if !samePath(ctx.Paths.ConfigPath, expectedConfig) {
		return fmt.Errorf("normal install mode requires config destination %s, got %s", expectedConfig, ctx.Paths.ConfigPath)
	}

	return nil
}

func copyFileSafe(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("open source file %s: %w", src, err)
	}
	defer in.Close()

	if err := ensureDirectory(filepath.Dir(dst)); err != nil {
		return err
	}

	tmpDst := dst + ".tmp"
	out, err := os.OpenFile(tmpDst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		return fmt.Errorf("open destination file %s: %w", tmpDst, err)
	}

	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return fmt.Errorf("copy file contents: %w", err)
	}

	if err := out.Close(); err != nil {
		return fmt.Errorf("close destination file: %w", err)
	}

	if _, err := os.Stat(dst); err == nil {
		if err := os.Remove(dst); err != nil {
			return fmt.Errorf("remove existing destination file %s: %w", dst, err)
		}
	}

	if err := os.Rename(tmpDst, dst); err != nil {
		return fmt.Errorf("replace destination file: %w", err)
	}

	return nil
}

func copyDirectoryContents(srcDir, dstDir string) (int, error) {
	info, err := os.Stat(srcDir)
	if err != nil {
		return 0, fmt.Errorf("open source directory %s: %w", srcDir, err)
	}
	if !info.IsDir() {
		return 0, fmt.Errorf("source path is not a directory: %s", srcDir)
	}
	if err := ensureDirectory(dstDir); err != nil {
		return 0, err
	}

	copied := 0
	err = filepath.WalkDir(srcDir, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}

		dst := filepath.Join(dstDir, rel)
		if entry.IsDir() {
			return ensureDirectory(dst)
		}
		if err := copyFileSafe(path, dst); err != nil {
			return err
		}
		copied++
		return nil
	})
	if err != nil {
		return copied, err
	}
	return copied, nil
}

func stopExistingAgent(ctx *InstallerContext) error {
	ctx.writeInstallerLog("INFO", "existing agent process stop check: setulink-agent.exe")

	if runtime.GOOS != "windows" {
		ctx.writeInstallerLog("INFO", "existing agent process stop result: skipped on non-Windows runtime")
		return nil
	}

	script := `
$procs = Get-CimInstance Win32_Process -Filter "name = 'setulink-agent.exe'"
if (-not $procs) {
  Write-Output "no setulink-agent.exe process found"
  exit 0
}
foreach ($proc in $procs) {
  Write-Output ("stopping pid=" + $proc.ProcessId + " path=" + $proc.ExecutablePath)
  Stop-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 1500
$alive = Get-CimInstance Win32_Process -Filter "name = 'setulink-agent.exe'"
if ($alive) {
  foreach ($proc in $alive) {
    Write-Output ("force stopping pid=" + $proc.ProcessId + " path=" + $proc.ExecutablePath)
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
  }
}
`

	cmd := exec.Command("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script)
	output, err := cmd.CombinedOutput()
	for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			ctx.writeInstallerLog("INFO", "existing agent process stop detail: "+line)
		}
	}
	if err != nil {
		ctx.writeInstallerLog("ERROR", "existing agent process stop result: "+err.Error())
		return fmt.Errorf("stop existing agent process: %w", err)
	}

	ctx.writeInstallerLog("INFO", "existing agent process stop result: completed")
	return nil
}

func stopServiceForInstall(ctx *InstallerContext) (bool, error) {
	ctx.writeInstallerLog("INFO", "service stop check: "+serviceName)

	info, err := queryService(ctx)
	if err != nil {
		return false, err
	}
	if !info.Exists {
		ctx.writeInstallerLog("INFO", "existing service detected: no")
		return false, nil
	}

	ctx.writeInstallerLog("INFO", "existing service detected: yes")
	if info.State == "STOPPED" {
		ctx.writeInstallerLog("INFO", "service stop not needed; already stopped")
		return false, nil
	}

	ctx.writeInstallerLog("INFO", "service stop start: "+serviceName)
	if _, err := runSC(ctx, "service stop", "stop", serviceName); err != nil && !strings.Contains(strings.ToLower(err.Error()), "service has not been started") {
		ctx.writeInstallerLog("ERROR", "service stop failure: "+err.Error())
		return false, fmt.Errorf("stop service %s: %w", serviceName, err)
	}

	if err := waitForServiceState(ctx, "STOPPED", 30*time.Second); err != nil {
		ctx.writeInstallerLog("ERROR", "service stop failure: "+err.Error())
		return false, err
	}

	ctx.writeInstallerLog("INFO", "service stop success: "+serviceName)
	return true, nil
}

func installOrUpdateService(ctx *InstallerContext) error {
	ctx.writeInstallerLog("INFO", "service install start: "+serviceName)
	if runtime.GOOS != "windows" {
		ctx.writeInstallerLog("INFO", "service install skipped on non-Windows runtime")
		return nil
	}

	info, err := queryService(ctx)
	if err != nil {
		ctx.writeInstallerLog("ERROR", "service install failure: "+err.Error())
		return err
	}

	binPath := quoteWindowsArg(ctx.Paths.AgentBinaryDest)
	if info.Exists {
		ctx.writeInstallerLog("INFO", "existing service detected during install: yes")
		if _, err := runSC(ctx, "service config", "config", serviceName, "binPath=", binPath, "start=", "auto", "DisplayName=", serviceDisplayName); err != nil {
			ctx.writeInstallerLog("ERROR", "service install failure: "+err.Error())
			return fmt.Errorf("configure existing service %s: %w", serviceName, err)
		}
	} else {
		ctx.writeInstallerLog("INFO", "existing service detected during install: no")
		if _, err := runSC(ctx, "service create", "create", serviceName, "binPath=", binPath, "start=", "auto", "DisplayName=", serviceDisplayName); err != nil {
			ctx.writeInstallerLog("ERROR", "service install failure: "+err.Error())
			return fmt.Errorf("create service %s: %w", serviceName, err)
		}
	}

	if _, err := runSC(ctx, "service description", "description", serviceName, serviceDescription); err != nil {
		ctx.writeInstallerLog("WARN", "service description update failed: "+err.Error())
	}

	if err := configureServiceRecovery(ctx); err != nil {
		ctx.writeInstallerLog("ERROR", "service recovery configuration failure: "+err.Error())
		return err
	}

	ctx.writeInstallerLog("INFO", "service install success: "+serviceName)
	return nil
}

func configureServiceRecovery(ctx *InstallerContext) error {
	ctx.writeInstallerLog("INFO", "service recovery configuration start: "+serviceName)
	if _, err := runSC(ctx, "service recovery config", serviceRecoveryFailureArgs(serviceName)...); err != nil {
		return fmt.Errorf("configure service recovery for %s: %w", serviceName, err)
	}
	if _, err := runSC(ctx, "service recovery failureflag", "failureflag", serviceName, "1"); err != nil {
		ctx.writeInstallerLog("WARN", "service recovery failureflag update failed: "+err.Error())
	}
	ctx.writeInstallerLog("INFO", "service recovery configuration success: "+serviceName)
	return nil
}

func serviceRecoveryFailureArgs(name string) []string {
	delay := fmt.Sprintf("%d", serviceRestartDelayMs)
	actions := strings.Join([]string{
		"restart", delay,
		"restart", delay,
		"restart", delay,
	}, "/")
	return []string{
		"failure",
		name,
		"reset=", fmt.Sprintf("%d", serviceFailureResetSeconds),
		"actions=", actions,
	}
}

func startService(ctx *InstallerContext, action string) error {
	ctx.writeInstallerLog("INFO", action+" start: "+serviceName)
	if runtime.GOOS != "windows" {
		ctx.writeInstallerLog("INFO", action+" skipped on non-Windows runtime")
		return nil
	}

	info, err := queryService(ctx)
	if err != nil {
		ctx.writeInstallerLog("ERROR", action+" failure: "+err.Error())
		return err
	}
	if !info.Exists {
		err := fmt.Errorf("service %s does not exist", serviceName)
		ctx.writeInstallerLog("ERROR", action+" failure: "+err.Error())
		return err
	}
	if info.State == "RUNNING" {
		ctx.writeInstallerLog("INFO", action+" success: already running")
		return nil
	}

	if _, err := runSC(ctx, action, "start", serviceName); err != nil {
		ctx.writeInstallerLog("ERROR", action+" failure: "+err.Error())
		return fmt.Errorf("start service %s: %w", serviceName, err)
	}
	if err := waitForServiceState(ctx, "RUNNING", 30*time.Second); err != nil {
		ctx.writeInstallerLog("ERROR", action+" failure: "+err.Error())
		return err
	}

	ctx.writeInstallerLog("INFO", action+" success: "+serviceName)
	return nil
}

type serviceInfo struct {
	Exists bool
	State  string
}

func queryService(ctx *InstallerContext) (serviceInfo, error) {
	if runtime.GOOS != "windows" {
		return serviceInfo{Exists: false}, nil
	}

	output, err := runSC(ctx, "service query", "query", serviceName)
	if err != nil {
		lowerOutput := strings.ToLower(output)
		lowerError := strings.ToLower(err.Error())
		if strings.Contains(lowerOutput, "1060") ||
			strings.Contains(lowerOutput, "does not exist") ||
			strings.Contains(lowerError, "does not exist") {
			return serviceInfo{Exists: false}, nil
		}
		return serviceInfo{}, fmt.Errorf("query service %s: %w", serviceName, err)
	}

	return serviceInfo{Exists: true, State: parseServiceState(output)}, nil
}

func parseServiceState(output string) string {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "STATE") {
			fields := strings.Fields(line)
			if len(fields) > 3 {
				return strings.ToUpper(fields[3])
			}
		}
	}
	return "UNKNOWN"
}

func waitForServiceState(ctx *InstallerContext, desired string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	desired = strings.ToUpper(desired)
	for {
		info, err := queryService(ctx)
		if err != nil {
			return err
		}
		if !info.Exists {
			return fmt.Errorf("service %s disappeared while waiting for %s", serviceName, desired)
		}
		if info.State == desired {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("timed out waiting for service %s to reach %s; last state: %s", serviceName, desired, info.State)
		}
		time.Sleep(1 * time.Second)
	}
}

func runSC(ctx *InstallerContext, action string, args ...string) (string, error) {
	cmd := exec.Command("sc.exe", args...)
	output, err := cmd.CombinedOutput()
	text := strings.TrimSpace(string(output))
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			ctx.writeInstallerLog("INFO", action+" detail: "+line)
		}
	}
	if err != nil {
		return text, fmt.Errorf("%s: %w", text, err)
	}
	return text, nil
}

func quoteWindowsArg(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `\"`) + `"`
}

func writeConfig(ctx *InstallerContext) (*InstallerConfig, error) {
	data, err := os.ReadFile(ctx.Options.TemplatePath)
	if err != nil {
		return nil, fmt.Errorf("read config template: %w", err)
	}

	var cfg InstallerConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config template: %w", err)
	}

	existing, hasExisting, err := readExistingConfig(ctx.Paths.ConfigPath)
	if err != nil {
		if ctx.Options.BackendURL == "" {
			return nil, err
		}
		ctx.writeInstallerLog("WARN", "existing config is invalid but explicit backend override was provided; replacing config: "+err.Error())
	}

	selectedBackendURL, err := selectAndValidateBackendURL(ctx)
	if err != nil {
		return nil, err
	}
	cfg.BackendURL = selectedBackendURL
	cfg.ServerURL = selectedBackendURL
	ctx.writeInstallerLog("INFO", "backend URL written to config: "+selectedBackendURL)

	cfg.DeviceID = ""
	cfg.DeviceIdentityMode = "auto"
	if hasExisting && existing.InstallID != "" {
		cfg.InstallID = existing.InstallID
	} else {
		cfg.InstallID = newInstallID()
	}
	cfg.LogPath = ctx.Paths.AgentLogPath
	cfg.DataPath = ctx.Paths.DataDir
	cfg.TempPath = ctx.Paths.TempDir
	if hasExisting && existing.FirstRunAt != "" {
		cfg.FirstRunAt = existing.FirstRunAt
	} else {
		cfg.FirstRunAt = time.Now().UTC().Format(time.RFC3339)
	}
	cfg.Version = ctx.Options.Version
	cfg.OS = "windows"

	output, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal agent config: %w", err)
	}

	if err := os.WriteFile(ctx.Paths.ConfigPath, output, 0644); err != nil {
		return nil, fmt.Errorf("write agent config: %w", err)
	}

	return &cfg, nil
}

func selectAndValidateBackendURL(ctx *InstallerContext) (string, error) {
	data, err := os.ReadFile(ctx.Options.TemplatePath)
	if err != nil {
		return "", fmt.Errorf("read config template: %w", err)
	}

	var templateCfg InstallerConfig
	if err := json.Unmarshal(data, &templateCfg); err != nil {
		return "", fmt.Errorf("parse config template: %w", err)
	}

	existing, hasExisting, err := readExistingConfig(ctx.Paths.ConfigPath)
	if err != nil {
		if ctx.Options.BackendURL == "" {
			return "", err
		}
		ctx.writeInstallerLog("WARN", "ignoring invalid existing config because explicit backend override is present: "+err.Error())
		hasExisting = false
	}

	source := ""
	candidate := ""
	if ctx.Options.BackendURL != "" {
		source = "explicit backend override"
		candidate = ctx.Options.BackendURL
	} else if hasExisting && configBackendURL(existing) != "" {
		source = "existing config"
		candidate = configBackendURL(existing)
	} else if ctx.Options.DefaultBackendURL != "" {
		source = "default backend URL"
		candidate = ctx.Options.DefaultBackendURL
	} else {
		source = "config template"
		candidate = configBackendURL(templateCfg)
	}

	normalized, err := normalizeBackendURL(candidate)
	if err != nil {
		return "", err
	}

	ctx.writeInstallerLog("INFO", fmt.Sprintf("backend URL selected from %s: %s", source, normalized))

	if err := probeBackendURL(normalized); err != nil {
		return "", err
	}

	ctx.writeInstallerLog("INFO", "backend URL health probe succeeded: "+normalized+"/health")
	return normalized, nil
}

func normalizeBackendURL(rawValue string) (string, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(rawValue), "/")
	if trimmed == "" {
		return "", errors.New("backendUrl/serverUrl must be set in the template or via -backend-url")
	}

	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("Backend URL must point to the API host, e.g. %s", publicAPIExample)
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return "", fmt.Errorf("Backend URL must point to the API host, e.g. %s", publicAPIExample)
	}
	if strings.EqualFold(parsed.Hostname(), frontendHost) {
		return "", fmt.Errorf("Backend URL must point to the API host, e.g. %s", publicAPIExample)
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("Backend URL must point to the API host, e.g. %s", publicAPIExample)
	}

	return trimmed, nil
}

func probeBackendURL(backendURL string) error {
	healthURL := strings.TrimRight(backendURL, "/") + "/health"
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(healthURL)
	if err != nil {
		return fmt.Errorf("backend health probe failed for %s: %w", healthURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("backend health probe failed for %s: status %d", healthURL, resp.StatusCode)
	}

	return nil
}

func readExistingConfig(path string) (InstallerConfig, bool, error) {
	var cfg InstallerConfig
	if !fileExists(path) {
		return cfg, false, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return cfg, false, fmt.Errorf("read existing config: %w", err)
	}

	if err := json.Unmarshal(data, &cfg); err != nil {
		return cfg, false, fmt.Errorf("parse existing config: %w", err)
	}

	return cfg, true, nil
}

func configBackendURL(cfg InstallerConfig) string {
	if cfg.ServerURL != "" {
		return cfg.ServerURL
	}
	return cfg.BackendURL
}

func launchAgent(ctx *InstallerContext) (*launchedAgent, error) {
	if !fileExists(ctx.Paths.AgentBinaryDest) {
		return nil, fmt.Errorf("launch aborted; Program Files binary does not exist: %s", ctx.Paths.AgentBinaryDest)
	}
	ctx.writeInstallerLog("INFO", fmt.Sprintf("Program Files target exists before launch: %t", true))
	ctx.writeInstallerLog("INFO", "launch target path: "+ctx.Paths.AgentBinaryDest)

	logFile, err := os.OpenFile(ctx.Paths.AgentLogPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return nil, fmt.Errorf("open agent log: %w", err)
	}

	cmd := exec.Command(ctx.Paths.AgentBinaryDest, "-config", ctx.Paths.ConfigPath)
	cmd.Dir = ctx.Paths.InstallDir
	cmd.Stdout = logFile
	cmd.Stderr = logFile

	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		return nil, fmt.Errorf("start agent: %w", err)
	}

	exitCh := make(chan error, 1)
	go func() {
		exitCh <- cmd.Wait()
		_ = logFile.Close()
	}()

	return &launchedAgent{
		cmd:    cmd,
		exitCh: exitCh,
	}, nil
}

func validateInstall(ctx *InstallerContext, agent *launchedAgent, cfg *InstallerConfig) error {
	ctx.writeInstallerLog("INFO", "validating agent launch and first-run behavior")

	timeout := time.NewTimer(20 * time.Second)
	defer timeout.Stop()

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	successMarkers := []string{
		"device registration successful",
		"initial heartbeat successful",
		"device registration completed",
		"initial heartbeat succeeded",
	}

	for {
		select {
		case err := <-agent.exitCh:
			if err != nil {
				return fmt.Errorf("agent exited during validation: %w", err)
			}
			return fmt.Errorf("agent exited before validation completed; inspect %s", ctx.Paths.AgentLogPath)
		case <-ticker.C:
			logData, readErr := os.ReadFile(ctx.Paths.AgentLogPath)
			if readErr != nil {
				ctx.writeInstallerLog("WARN", "agent log not ready yet: "+readErr.Error())
				continue
			}

			logText := string(logData)
			for _, marker := range successMarkers {
				if strings.Contains(logText, marker) {
					ctx.writeInstallerLog("INFO", "validation succeeded; agent reached registration/heartbeat")
					return nil
				}
			}
		case <-timeout.C:
			return fmt.Errorf(
				"agent launched but registration/heartbeat was not confirmed within 20s (backend: %s, agent log: %s)",
				cfg.ServerURL,
				ctx.Paths.AgentLogPath,
			)
		}
	}
}

func validateServiceInstall(ctx *InstallerContext, cfg *InstallerConfig, logOffset int64) error {
	ctx.writeInstallerLog("INFO", "validating service startup and first-run behavior")
	if err := validateInstalledFfmpeg(ctx); err != nil {
		return err
	}
	ctx.writeInstallerLog("INFO", "validation ffmpeg exists: "+ctx.Paths.FfmpegBinaryDest)

	if runtime.GOOS != "windows" {
		ctx.writeInstallerLog("INFO", "service validation skipped on non-Windows runtime")
		return nil
	}

	timeout := time.NewTimer(30 * time.Second)
	defer timeout.Stop()

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			info, err := queryService(ctx)
			if err != nil {
				ctx.writeInstallerLog("WARN", "service validation query failed: "+err.Error())
				continue
			}
			ctx.writeInstallerLog("INFO", fmt.Sprintf("validation service installed: %t", info.Exists))
			ctx.writeInstallerLog("INFO", "validation service state: "+info.State)
			if !info.Exists || info.State != "RUNNING" {
				logText, readErr := readTextFromOffset(ctx.Paths.AgentLogPath, logOffset)
				if readErr != nil {
					return fmt.Errorf(
						"service %s is not running after start; state=%s; agent log unavailable: %v",
						serviceName,
						info.State,
						readErr,
					)
				}
				return fmt.Errorf(
					"service %s is not running after start; state=%s; recent agent log: %s",
					serviceName,
					info.State,
					strings.TrimSpace(logText),
				)
			}

			logText, readErr := readTextFromOffset(ctx.Paths.AgentLogPath, logOffset)
			if readErr != nil {
				ctx.writeInstallerLog("WARN", "agent log not ready yet: "+readErr.Error())
				continue
			}

			hasServiceMarker := strings.Contains(logText, "agent service mode: running as Windows service SetuLinkAgent")
			if !hasServiceMarker {
				hasServiceMarker = strings.Contains(logText, `"action":"service-mode"`)
			}
			hasFirstRunMarker := strings.Contains(logText, "device registration successful") ||
				strings.Contains(logText, "initial heartbeat successful") ||
				strings.Contains(logText, "device registration completed") ||
				strings.Contains(logText, "initial heartbeat succeeded")
			if hasServiceMarker && hasFirstRunMarker {
				ctx.writeInstallerLog("INFO", "validation succeeded; service reached service-mode startup and registration/heartbeat")
				return nil
			}
		case <-timeout.C:
			return fmt.Errorf(
				"service started but service-mode registration/heartbeat was not confirmed within 30s (backend: %s, agent log: %s)",
				cfg.ServerURL,
				ctx.Paths.AgentLogPath,
			)
		}
	}
}

func validateInstalledFfmpeg(ctx *InstallerContext) error {
	if !fileExists(ctx.Paths.FfmpegBinaryDest) {
		return fmt.Errorf("bundled ffmpeg missing after install: %s", ctx.Paths.FfmpegBinaryDest)
	}
	return nil
}

func readTextFromOffset(path string, offset int64) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if offset < 0 || offset > int64(len(data)) {
		offset = 0
	}
	return string(data[offset:]), nil
}

func fileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}

func executableDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("resolve executable path: %w", err)
	}
	return filepath.Dir(exe), nil
}

func defaultInstallDir() string {
	base := os.Getenv("ProgramFiles")
	if base == "" {
		base = `C:\Program Files`
	}
	return joinPath(base, "SetuLink")
}

func defaultProgramDataDir() string {
	base := os.Getenv("ProgramData")
	if base == "" {
		base = `C:\ProgramData`
	}
	return joinPath(base, "SetuLink")
}

func joinPath(parts ...string) string {
	return filepath.Clean(filepath.Join(parts...))
}

func samePath(a, b string) bool {
	a = filepath.Clean(a)
	b = filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

func newInstallID() string {
	return fmt.Sprintf("install-%d", time.Now().UTC().UnixNano())
}

var _ = runtime.GOOS
