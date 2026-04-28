package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	agenthealth "remote-control-agent/internal/health"
	agentlogging "remote-control-agent/internal/logging"
	"setulinkpaths"
)

type agentOptions struct {
	ConfigPath string
	Portable   bool
}

func main() {
	if runWindowsServiceIfNeeded() {
		return
	}

	if err := runAgent(context.Background(), "console"); err != nil {
		if log := logger("bootstrap"); log != nil {
			log.Error("exit", "agent exited with error", err, nil)
		} else {
			fmt.Println(err)
		}
		os.Exit(1)
	}
}

func runAgent(ctx context.Context, runMode string) error {
	initHealthState(runMode)

	releaseLock, err := acquireSingleInstanceLock()
	if err != nil {
		return fmt.Errorf("agent already running: %w", err)
	}
	defer releaseLock()

	configPath, err := resolveConfigPath()
	if err != nil {
		return fmt.Errorf("config error: %w", err)
	}

	cfg, err := LoadConfig(configPath)
	if err != nil {
		return fmt.Errorf("config error: %w", err)
	}

	rootLogger, err = agentlogging.New(cfg.LogPath)
	if err != nil {
		return fmt.Errorf("logger initialization error: %w", err)
	}
	rootLogger = rootLogger.WithDevice(cfg.DeviceID).WithRunMode(normalizeRunMode(runMode))

	if err := prepareRuntime(cfg); err != nil {
		return fmt.Errorf("runtime preparation error: %w", err)
	}

	bootLog := logger("bootstrap")
	bootLog.Info("boot", "agent boot sequence started", logMetadata(
		"runMode", normalizeRunMode(runMode),
		"server", cfg.ServerURL,
		"deviceId", cfg.DeviceID,
		"displayName", cfg.DisplayName,
		"hostname", cfg.Hostname,
		"os", cfg.OS,
	))
	if runMode == "windows-service" {
		bootLog.Info("service-mode", "agent running as Windows service", logMetadata("serviceName", serviceName))
	}

	startupSummary := agenthealth.RunStartupChecks(ctx, healthConfigView(cfg, runMode), logger("startup"))
	recordStartupChecks(startupSummary)
	if startupSummary.Fatal() {
		err := fmt.Errorf("critical startup checks failed: %d", len(startupSummary.Failed))
		handleUpgradeStartupResult(cfg, false, err.Error())
		bootLog.Error("startup-gate", "agent startup blocked by critical health checks", err, logMetadata(
			"failedChecks", startupCheckNames(startupSummary.Failed),
			"warningChecks", startupCheckNames(startupSummary.Warnings),
		))
		return err
	}
	handleUpgradeStartupResult(cfg, true, "")
	bootLog.Info("startup-gate", "startup checks passed", logMetadata(
		"warnings", startupCheckNames(startupSummary.Warnings),
	))

	initRecoveryState(cfg)

	waitForRegistration(ctx, cfg)

	if err := SendHeartbeat(cfg); err != nil {
		recordAgentError("heartbeat", err)
		logger("heartbeat").Warn("initial-heartbeat", "initial heartbeat failed", err, nil)
	} else {
		logger("heartbeat").Info("initial-heartbeat", "initial heartbeat succeeded", nil)
	}

	go StartWebSocket(cfg)
	go pollFiles(*cfg)

	heartbeatTicker := time.NewTicker(30 * time.Second)
	commandTicker := time.NewTicker(5 * time.Second)
	actionTicker := time.NewTicker(5 * time.Second)
	remoteDesktopTicker := time.NewTicker(5 * time.Second)
	watchdogTicker := time.NewTicker(30 * time.Second)
	defer heartbeatTicker.Stop()
	defer commandTicker.Stop()
	defer actionTicker.Stop()
	defer remoteDesktopTicker.Stop()
	defer watchdogTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			bootLog.Info("shutdown", "agent shutdown requested", logMetadata("reason", ctx.Err().Error()))
			return nil

		case <-heartbeatTicker.C:
			recordWatchdogLoop("heartbeat")
			if err := SendHeartbeat(cfg); err != nil {
				recordAgentError("heartbeat", err)
				logger("heartbeat").Warn("heartbeat", "heartbeat failed", err, nil)
			}

		case <-commandTicker.C:
			recordWatchdogLoop("command-worker")
			logger("commands").Debug("poll", "command polling started", nil)
			cmd, err := FetchNextCommand(cfg)
			if err != nil {
				recordWatchdogCommandFailure(err)
				recordAgentError("command-poll", err)
				logger("commands").Warn("poll", "command poll failed", err, nil)
			} else if cmd != nil {
				logger("commands").Info("received", "command received", logMetadata("commandId", cmd.ID, "command", cmd.Command))

				if err := markCommandStarted(cfg, cmd.ID); err != nil {
					recordWatchdogCommandFailure(err)
					recordAgentError("command-started", err)
					logger("commands").Warn("started", "command running status update failed", err, logMetadata("commandId", cmd.ID))
				} else {
					recordWatchdogCommandSuccess()
					logger("commands").Info("started", "command marked running", logMetadata("commandId", cmd.ID))
				}

				logger("commands").Info("execute-start", "command execution started", logMetadata("commandId", cmd.ID))

				result := ExecuteCommandDetailed(cmd.Command)
				status := "completed"
				if result.Err != nil {
					status = "failed"
				}
				logger("commands").Info("execute-end", "command execution finished", logMetadata("commandId", cmd.ID, "exitCode", result.ExitCode, "status", status))

				recordCommandSummary(OperationSummary{
					ID:           cmd.ID,
					Command:      cmd.Command,
					Status:       status,
					ExitCode:     result.ExitCode,
					ErrorMessage: result.ErrorMessage,
					DurationMs:   result.DurationMs,
				})

				if err := SendCommandResult(cfg, cmd.ID, result, status); err != nil {
					recordWatchdogCommandFailure(err)
					recordAgentError("command-result", err)
					logger("commands").Warn("result-post", "command result post failed", err, logMetadata("commandId", cmd.ID))
				} else {
					recordWatchdogCommandSuccess()
					logger("commands").Info("result-post", "command result posted", logMetadata("commandId", cmd.ID, "status", status))
				}
			} else {
				recordWatchdogCommandSuccess()
			}

		case <-actionTicker.C:
			recordWatchdogLoop("action-worker")
			action, err := FetchNextAction(cfg)
			if err != nil {
				recordAgentError("action-poll", err)
				logger("actions").Warn("poll", "action poll failed", err, nil)
			} else if action != nil {
				logger("actions").Info("received", "action received", logMetadata("actionId", action.ID, "actionType", action.ActionType))
				ProcessAction(cfg, *action)
			}

		case <-remoteDesktopTicker.C:
			recordWatchdogLoop("remote-desktop-worker")
			ProcessRemoteDesktopPending(cfg)

		case <-watchdogTicker.C:
			recordWatchdogLoop("main")
			recordWatchdogDegradedState(recoverySnapshot())
			handleWatchdogActions(cfg, evaluateWatchdog())
		}
	}
}

func waitForRegistration(ctx context.Context, cfg *Config) {
	backoff := time.Duration(0)
	for {
		if err := RegisterDevice(cfg); err != nil {
			recordAgentError("registration", err)
			backoff = nextBackoff(backoff)
			logger("registration").Warn("register", "device registration failed", err, logMetadata("retryIn", backoff.String()))

			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
				continue
			}
		}

		clearAgentError()
		logger("registration").Info("register", "device registration completed", nil)
		return
	}
}

func healthConfigView(cfg *Config, runMode string) agenthealth.ConfigView {
	return agenthealth.ConfigView{
		ConfigPath:  cfg.ConfigPath,
		ServerURL:   cfg.ServerURL,
		DeviceID:    cfg.DeviceID,
		OS:          cfg.OS,
		LogPath:     cfg.LogPath,
		DataPath:    cfg.DataPath,
		TempPath:    cfg.TempPath,
		FilesPath:   cfg.FilesPath,
		AgentToken:  cfg.AgentToken,
		ServiceName: serviceName,
		RunMode:     normalizeRunMode(runMode),
	}
}

func startupCheckNames(results []agenthealth.CheckResult) []string {
	names := make([]string, 0, len(results))
	for _, result := range results {
		names = append(names, result.Name)
	}
	return names
}

func resolveConfigPath() (string, error) {
	opts, err := parseAgentOptions(os.Args[1:])
	if err != nil {
		return "", err
	}

	layout, err := setulinkpaths.CurrentLayout()
	if err != nil {
		return "", fmt.Errorf("resolve runtime layout: %w", err)
	}

	if !opts.Portable {
		configPath := layout.ConfigPath
		if opts.ConfigPath != "" {
			if !samePath(opts.ConfigPath, layout.ConfigPath) {
				return "", fmt.Errorf(
					"normal install mode only allows config at %s. For debug/portable runs use: setulink-agent.exe -portable -config C:\\path\\to\\config.json",
					layout.ConfigPath,
				)
			}
			configPath = opts.ConfigPath
		}

		if !fileExists(configPath) {
			return "", fmt.Errorf("missing normal install config at %s. Run SetuLinkSetup.exe to generate it", configPath)
		}
		return configPath, nil
	}

	if opts.ConfigPath != "" {
		return opts.ConfigPath, nil
	}

	for _, candidate := range localConfigCandidates() {
		if fileExists(candidate) {
			return candidate, nil
		}
	}

	return "", fmt.Errorf("portable mode requires config.json beside the agent/current directory or an explicit -config path")
}

func parseAgentOptions(args []string) (agentOptions, error) {
	fs := flag.NewFlagSet("setulink-agent", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)

	var opts agentOptions
	fs.StringVar(&opts.ConfigPath, "config", "", "config path")
	fs.BoolVar(&opts.Portable, "portable", false, "enable debug/portable local config lookup")

	if err := fs.Parse(args); err != nil {
		return opts, err
	}

	if fs.NArg() > 0 {
		if fs.NArg() == 1 && opts.ConfigPath == "" {
			opts.ConfigPath = fs.Arg(0)
		} else {
			return opts, fmt.Errorf("unexpected arguments: %s", strings.Join(fs.Args(), " "))
		}
	}

	return opts, nil
}

func localConfigCandidates() []string {
	candidates := []string{}

	if exePath, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(exePath), "config.json"))
	}

	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(cwd, "config.json"))
	}

	return candidates
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func samePath(a, b string) bool {
	a = filepath.Clean(a)
	b = filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}
