package setulinkpaths

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

type Layout struct {
	InstallDir       string
	ProgramDataDir   string
	ConfigDir        string
	ConfigPath       string
	LogsDir          string
	InstallerLogPath string
	AgentLogPath     string
	FilesDir         string
	DataDir          string
	TempDir          string
	DeviceStatePath  string
	FfmpegDir        string
	FfmpegPath       string
}

func CurrentLayout() (Layout, error) {
	if runtime.GOOS == "windows" {
		programFiles := os.Getenv("ProgramFiles")
		if programFiles == "" {
			programFiles = `C:\Program Files`
		}

		programData := os.Getenv("ProgramData")
		if programData == "" {
			programData = `C:\ProgramData`
		}

		return LayoutForBase(
			filepath.Join(programFiles, "SetuLink"),
			filepath.Join(programData, "SetuLink"),
		), nil
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return Layout{}, fmt.Errorf("get home dir: %w", err)
	}

	base := filepath.Join(home, "setulink")
	return LayoutForBase(base, base), nil
}

func LayoutForBase(installDir, programDataDir string) Layout {
	return Layout{
		InstallDir:       filepath.Clean(installDir),
		ProgramDataDir:   filepath.Clean(programDataDir),
		ConfigDir:        filepath.Join(programDataDir, "config"),
		ConfigPath:       filepath.Join(programDataDir, "config", "agent.json"),
		LogsDir:          filepath.Join(programDataDir, "logs"),
		InstallerLogPath: filepath.Join(programDataDir, "logs", "installer.log"),
		AgentLogPath:     filepath.Join(programDataDir, "logs", "agent.log"),
		FilesDir:         filepath.Join(programDataDir, "files"),
		DataDir:          filepath.Join(programDataDir, "data"),
		TempDir:          filepath.Join(programDataDir, "temp"),
		DeviceStatePath:  filepath.Join(programDataDir, "device.json"),
		FfmpegDir:        filepath.Join(installDir, "ffmpeg"),
		FfmpegPath:       filepath.Join(installDir, "ffmpeg", "ffmpeg.exe"),
	}
}

func EnsureRuntimeDirs(layout Layout) error {
	for _, dir := range []string{
		layout.ProgramDataDir,
		layout.ConfigDir,
		layout.LogsDir,
		layout.FilesDir,
		layout.DataDir,
		layout.TempDir,
	} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("create runtime dir %s: %w", dir, err)
		}
	}

	return nil
}
