package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	agentupgrade "remote-control-agent/internal/upgrade"
)

type UpgradeRuntimeSummary struct {
	Status  string `json:"status,omitempty"`
	Version string `json:"version,omitempty"`
	Reason  string `json:"reason,omitempty"`
}

func upgradeStagingDir(cfg *Config) string {
	return filepath.Join(cfg.TempPath, "upgrade")
}

func upgradeStatePath(cfg *Config) string {
	return filepath.Join(upgradeStagingDir(cfg), "upgrade-state.json")
}

func updaterHelperPath() string {
	exePath, err := os.Executable()
	if err != nil {
		return "setulink-updater.exe"
	}
	return filepath.Join(filepath.Dir(exePath), "setulink-updater.exe")
}

func upgradeManifestURL(cfg *Config) string {
	return strings.TrimRight(cfg.ServerURL, "/") + "/api/agent/upgrades/manifest?id=" + cfg.DeviceID + "&version=" + cfg.Version
}

func checkAndStageUpgrade(ctx context.Context, cfg *Config) (agentupgrade.StageInfo, error) {
	log := logger("upgrade")
	manifest, err := agentupgrade.FetchManifest(ctx, currentAgentHTTPClient(), upgradeManifestURL(cfg))
	if err != nil {
		if errors.Is(err, agentupgrade.ErrNoApprovedUpgrade) {
			log.Info("manifest", "no approved upgrade manifest available", nil)
		} else {
			log.Warn("manifest", "upgrade manifest fetch failed", err, nil)
		}
		return agentupgrade.StageInfo{}, err
	}
	log.Info("manifest", "approved upgrade manifest fetched", logMetadata("version", manifest.Version, "sizeBytes", manifest.SizeBytes))

	downloaded, err := agentupgrade.Download(ctx, currentAgentHTTPClient(), manifest, upgradeStagingDir(cfg))
	if err != nil {
		log.Warn("download", "upgrade download failed", err, logMetadata("version", manifest.Version))
		return agentupgrade.StageInfo{}, err
	}
	log.Info("verify", "upgrade downloaded; verifying checksum", logMetadata("path", downloaded, "version", manifest.Version))

	currentPath, err := os.Executable()
	if err != nil {
		return agentupgrade.StageInfo{}, fmt.Errorf("resolve current executable: %w", err)
	}
	info, err := agentupgrade.Stage(manifest, downloaded, currentPath, upgradeStagingDir(cfg))
	if err != nil {
		log.Warn("stage", "upgrade staging failed", err, logMetadata("version", manifest.Version))
		return agentupgrade.StageInfo{}, err
	}
	log.Info("stage", "upgrade staged with current binary backup", logMetadata("version", info.Version, "backupPath", info.BackupPath))
	return info, nil
}

func applyStagedUpgrade(cfg *Config) error {
	log := logger("upgrade")
	info, err := agentupgrade.ReadStageInfo(upgradeStagingDir(cfg))
	if err != nil {
		return fmt.Errorf("read staged upgrade: %w", err)
	}

	statePath := upgradeStatePath(cfg)
	if err := agentupgrade.WriteState(statePath, agentupgrade.State{
		Version:     info.Version,
		CurrentPath: info.CurrentPath,
		StagedPath:  info.StagedPath,
		BackupPath:  info.BackupPath,
		Status:      "apply-started",
	}); err != nil {
		return err
	}

	log.Info("apply-start", "starting staged upgrade apply via helper", logMetadata("version", info.Version, "helper", updaterHelperPath()))
	if err := agentupgrade.ApplyWithHelper(agentupgrade.ApplyOptions{
		HelperPath:     updaterHelperPath(),
		ServiceName:    serviceNameForRunMode(normalizeRunMode("windows-service")),
		CurrentPath:    info.CurrentPath,
		StagedPath:     info.StagedPath,
		BackupPath:     info.BackupPath,
		StatePath:      statePath,
		WaitPid:        os.Getpid(),
		RestartService: runtime.GOOS == "windows",
	}); err != nil {
		log.Warn("apply-start", "failed to start updater helper", err, logMetadata("version", info.Version))
		return err
	}
	return nil
}

func handleUpgradeStartupResult(cfg *Config, startupOK bool, reason string) {
	statePath := upgradeStatePath(cfg)
	state, err := agentupgrade.ReadState(statePath)
	if err != nil {
		return
	}
	log := logger("upgrade")
	if agentupgrade.ShouldRollback(startupOK, state) {
		_ = agentupgrade.MarkRollbackRequested(statePath, state, reason)
		log.Warn("rollback", "startup checks failed after upgrade; rollback requested", fmt.Errorf("%s", reason), logMetadata("version", state.Version))
		reportUpgradeStatus(cfg, "rollback-requested", state.Version, reason)
		_ = agentupgrade.ApplyWithHelper(agentupgrade.ApplyOptions{
			HelperPath:     updaterHelperPath(),
			ServiceName:    serviceName,
			CurrentPath:    state.CurrentPath,
			StagedPath:     state.BackupPath,
			BackupPath:     state.StagedPath,
			StatePath:      statePath,
			WaitPid:        os.Getpid(),
			RestartService: runtime.GOOS == "windows",
		})
		return
	}
	if startupOK && state.Status == "applied-pending-startup" {
		if err := agentupgrade.MarkStartupSuccess(statePath, state); err == nil {
			log.Info("success", "upgrade marked successful after startup checks passed", logMetadata("version", state.Version))
			reportUpgradeStatus(cfg, "success", state.Version, "")
		}
	}
}

func upgradeRuntimeSummary(cfg *Config) UpgradeRuntimeSummary {
	state, err := agentupgrade.ReadState(upgradeStatePath(cfg))
	if err != nil {
		return UpgradeRuntimeSummary{}
	}
	return UpgradeRuntimeSummary{
		Status:  state.Status,
		Version: state.Version,
		Reason:  state.Reason,
	}
}

func reportUpgradeStatus(cfg *Config, status, version, reason string) {
	payload := map[string]string{
		"deviceId": cfg.DeviceID,
		"status":   status,
		"version":  version,
		"reason":   reason,
	}
	_ = doAgentRequest(cfg, http.MethodPost, agentURL(cfg, "/api/agent/upgrades/status", nil), payload, nil)
}
