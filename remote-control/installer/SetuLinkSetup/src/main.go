package main

import (
	"flag"
	"fmt"
	"os"
)

func main() {
	opts, err := parseInstallerOptions()
	if err != nil {
		fmt.Fprintln(os.Stderr, "installer options error:", err)
		os.Exit(1)
	}

	ctx, err := newInstallerContext(opts)
	if err != nil {
		fmt.Fprintln(os.Stderr, "installer setup error:", err)
		os.Exit(1)
	}
	defer ctx.Close()

	if err := runInstall(ctx); err != nil {
		ctx.writeInstallerLog("ERROR", err.Error())
		fmt.Fprintln(os.Stderr, "install failed:", err)
		fmt.Fprintln(os.Stderr, "see installer log:", ctx.Paths.InstallerLogPath)
		os.Exit(1)
	}

	ctx.writeInstallerLog("INFO", "installation completed successfully")
	fmt.Println("SetuLink installation completed")
	fmt.Println("Installer log:", ctx.Paths.InstallerLogPath)
	fmt.Println("Agent log:", ctx.Paths.AgentLogPath)
}

func parseInstallerOptions() (*InstallerOptions, error) {
	exeDir, err := executableDir()
	if err != nil {
		return nil, err
	}

	defaultInstallDir := defaultInstallDir()
	defaultDataDir := defaultProgramDataDir()

	opts := &InstallerOptions{}

	flag.StringVar(&opts.InstallDir, "install-dir", defaultInstallDir, "install directory for the SetuLink agent binary")
	flag.StringVar(&opts.ProgramDataDir, "data-dir", defaultDataDir, "ProgramData directory for SetuLink config, logs, data, and temp")
	flag.StringVar(&opts.BackendURL, "backend-url", "", "explicit backend URL override used by the agent")
	flag.StringVar(&opts.DefaultBackendURL, "default-backend-url", "", "default backend URL used only when no existing config or explicit override exists")
	flag.StringVar(&opts.Version, "version", "0.1.0", "installer version to write into agent config")
	flag.StringVar(&opts.AgentBinarySource, "agent-binary", joinPath(exeDir, "assets", "setulink-agent.exe"), "path to source setulink-agent.exe")
	flag.StringVar(&opts.UpdaterBinarySource, "updater-binary", joinPath(exeDir, "assets", "setulink-updater.exe"), "path to source setulink-updater.exe")
	flag.StringVar(&opts.FfmpegSourceDir, "ffmpeg-dir", joinPath(exeDir, "assets", "ffmpeg"), "path to bundled ffmpeg directory")
	flag.StringVar(&opts.TemplatePath, "config-template", joinPath(exeDir, "config.template.json"), "path to installer config template")
	flag.BoolVar(&opts.SkipLaunch, "skip-launch", false, "write files but do not launch the agent")
	flag.BoolVar(&opts.PortableMode, "portable", false, "debug only: allow non-canonical install/data directories")
	flag.Parse()

	if !opts.PortableMode {
		opts.InstallDir = defaultInstallDir
		opts.ProgramDataDir = defaultDataDir
	}

	return opts, nil
}
