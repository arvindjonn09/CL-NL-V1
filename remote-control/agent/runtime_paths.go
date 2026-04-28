package main

import (
	"fmt"
	"os"
	"time"

	agentremotedesktop "remote-control-agent/internal/remotedesktop"
	"setulinkpaths"
)

func prepareRuntime(cfg *Config) error {
	layout, err := setulinkpaths.CurrentLayout()
	if err != nil {
		return fmt.Errorf("resolve runtime layout: %w", err)
	}

	if err := setulinkpaths.EnsureRuntimeDirs(layout); err != nil {
		return fmt.Errorf("ensure runtime directories: %w", err)
	}

	exePath, err := os.Executable()
	if err != nil {
		exePath = "unknown"
	}

	if log := logger("runtime"); log != nil {
		size, modifiedAt := executableFileDetails(exePath)
		log.Info("binary-identity", "agent binary identity", logMetadata(
			"executablePath", exePath,
			"buildVersion", cfg.Version,
			"binarySizeBytes", size,
			"binaryModifiedAt", modifiedAt,
		))

		log.Info("runtime-prepared", "runtime directories prepared", logMetadata(
			"executablePath", exePath,
			"configPath", cfg.ConfigPath,
			"logPath", cfg.LogPath,
			"filesPath", cfg.FilesPath,
			"dataPath", cfg.DataPath,
			"tempPath", cfg.TempPath,
			"deviceStatePath", cfg.DeviceStatePath,
		))

		capability := agentremotedesktop.CurrentCapability()
		log.Info("remote-desktop-capability", "remote desktop capability summary", logMetadata(
			"remoteDesktopCapabilityState", capability.State,
			"state", capability.State,
			"screenCapture", capability.ScreenCapture,
			"input", capability.Input,
			"ffmpegPath", capability.FfmpegPath,
			"ffmpegSource", capability.FfmpegSource,
			"reason", capability.Reason,
		))
	}

	return nil
}

func executableFileDetails(path string) (int64, string) {
	info, err := os.Stat(path)
	if err != nil {
		return 0, "unknown"
	}
	return info.Size(), info.ModTime().UTC().Format(time.RFC3339)
}
