//go:build windows

package remotedesktop

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
	"setulinkpaths"
)

type FFmpegRuntime struct {
	Path   string
	Source string
}

func CheckCaptureRuntime() error {
	_, err := ResolveFFmpeg()
	return err
}

func ResolveFFmpeg() (FFmpegRuntime, error) {
	layout, layoutErr := setulinkpaths.CurrentLayout()
	if layoutErr == nil {
		if isExecutableFile(layout.FfmpegPath) {
			return FFmpegRuntime{Path: layout.FfmpegPath, Source: "bundled"}, nil
		}
	}

	path, err := exec.LookPath("ffmpeg")
	if err == nil && isExecutableFile(path) {
		return FFmpegRuntime{Path: path, Source: "system"}, nil
	}

	bundledPath := ""
	if layoutErr == nil {
		bundledPath = layout.FfmpegPath
	}
	if bundledPath != "" {
		return FFmpegRuntime{Path: bundledPath, Source: "missing"}, fmt.Errorf("ffmpeg is required for unattended desktop capture; bundled ffmpeg was not found or executable at %s and no system ffmpeg was found in PATH", bundledPath)
	}
	return FFmpegRuntime{Source: "missing"}, fmt.Errorf("ffmpeg is required for unattended desktop capture; bundled ffmpeg path could not be resolved (%v) and no system ffmpeg was found in PATH", layoutErr)
}

func isExecutableFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir() && strings.EqualFold(filepath.Ext(path), ".exe")
}

func StartCapture(ctx context.Context) (CaptureProcess, error) {
	ffmpeg, err := ResolveFFmpeg()
	if err != nil {
		return nil, err
	}

	cmd := exec.CommandContext(ctx, ffmpeg.Path, captureCommandArgs()...)
	return configureCaptureCommandForInteractiveDesktop(ctx, cmd)
}

func configureCaptureCommandForInteractiveDesktop(ctx context.Context, cmd *exec.Cmd) (CaptureProcess, error) {
	process := newExecCaptureProcess(cmd)
	environment := CurrentCaptureEnvironment()
	metadata := captureEnvironmentMetadata(environment)
	if !environment.CaptureAvailable {
		metadata["captureLaunchWarning"] = environment.Reason
		rememberCaptureLaunchState(process, metadata, nil)
		return process, nil
	}

	if environment.LaunchMode == "current-interactive-session" {
		rememberCaptureLaunchState(process, metadata, nil)
		return process, nil
	}

	var token windows.Token
	if err := windows.WTSQueryUserToken(environment.ActiveConsoleSessionID, &token); err != nil {
		metadata["captureLaunchWarning"] = fmt.Sprintf("active console user token lookup failed: %v", err)
		rememberCaptureLaunchState(process, metadata, nil)
		return process, nil
	}

	serviceProcess := newInteractiveDesktopCaptureProcess(ctx, token, cmd.Args)
	metadata["captureDesktop"] = interactiveDesktopName
	rememberCaptureLaunchState(serviceProcess, metadata, func() {
		_ = token.Close()
	})
	return serviceProcess, nil
}

const interactiveDesktopName = "WinSta0\\Default"

type windowsInteractiveDesktopCaptureProcess struct {
	ctx        context.Context
	token      windows.Token
	args       []string
	stdoutRead *os.File
	stdoutW    windows.Handle
	stderrRead *os.File
	stderrW    windows.Handle
	stdin      windows.Handle
	process    windows.Handle
	thread     windows.Handle
	started    bool
	waited     bool
	mu         sync.Mutex
}

func newInteractiveDesktopCaptureProcess(ctx context.Context, token windows.Token, args []string) *windowsInteractiveDesktopCaptureProcess {
	return &windowsInteractiveDesktopCaptureProcess{
		ctx:   ctx,
		token: token,
		args:  append([]string(nil), args...),
	}
}

func (process *windowsInteractiveDesktopCaptureProcess) Args() []string {
	if process == nil {
		return nil
	}
	return append([]string(nil), process.args...)
}

func (process *windowsInteractiveDesktopCaptureProcess) StdoutPipe() (io.ReadCloser, error) {
	process.mu.Lock()
	defer process.mu.Unlock()
	if process.started {
		return nil, fmt.Errorf("stdout pipe requested after process start")
	}
	if process.stdoutRead != nil {
		return nil, fmt.Errorf("stdout pipe already requested")
	}
	read, write, err := createInheritablePipe("ffmpeg-stdout")
	if err != nil {
		return nil, err
	}
	process.stdoutRead = read
	process.stdoutW = write
	return read, nil
}

func (process *windowsInteractiveDesktopCaptureProcess) StderrPipe() (io.ReadCloser, error) {
	process.mu.Lock()
	defer process.mu.Unlock()
	if process.started {
		return nil, fmt.Errorf("stderr pipe requested after process start")
	}
	if process.stderrRead != nil {
		return nil, fmt.Errorf("stderr pipe already requested")
	}
	read, write, err := createInheritablePipe("ffmpeg-stderr")
	if err != nil {
		return nil, err
	}
	process.stderrRead = read
	process.stderrW = write
	return read, nil
}

func (process *windowsInteractiveDesktopCaptureProcess) Start() error {
	process.mu.Lock()
	defer process.mu.Unlock()
	if process.started {
		return fmt.Errorf("capture process already started")
	}
	if len(process.args) == 0 {
		return fmt.Errorf("capture process has no command")
	}

	if process.stdoutW == 0 {
		read, write, err := createInheritablePipe("ffmpeg-stdout")
		if err != nil {
			return err
		}
		_ = read.Close()
		process.stdoutW = write
	}
	if process.stderrW == 0 {
		read, write, err := createInheritablePipe("ffmpeg-stderr")
		if err != nil {
			process.closeChildPipeHandlesLocked()
			return err
		}
		_ = read.Close()
		process.stderrW = write
	}

	stdin, err := openInheritableNUL()
	if err != nil {
		process.closeChildPipeHandlesLocked()
		return fmt.Errorf("open capture stdin: %w", err)
	}
	process.stdin = stdin

	desktop, err := windows.UTF16PtrFromString(interactiveDesktopName)
	if err != nil {
		process.closeChildPipeHandlesLocked()
		return err
	}
	commandLine, err := windows.UTF16PtrFromString(windows.ComposeCommandLine(process.args))
	if err != nil {
		process.closeChildPipeHandlesLocked()
		return err
	}
	application, err := windows.UTF16PtrFromString(process.args[0])
	if err != nil {
		process.closeChildPipeHandlesLocked()
		return err
	}
	currentDir, err := windows.UTF16PtrFromString(filepath.Dir(process.args[0]))
	if err != nil {
		process.closeChildPipeHandlesLocked()
		return err
	}

	startupInfo := windows.StartupInfo{
		Cb:         uint32(unsafe.Sizeof(windows.StartupInfo{})),
		Desktop:    desktop,
		Flags:      windows.STARTF_USESTDHANDLES | windows.STARTF_USESHOWWINDOW,
		ShowWindow: windows.SW_HIDE,
		StdInput:   process.stdin,
		StdOutput:  process.stdoutW,
		StdErr:     process.stderrW,
	}
	var processInfo windows.ProcessInformation
	flags := uint32(windows.CREATE_DEFAULT_ERROR_MODE | windows.CREATE_UNICODE_ENVIRONMENT | windows.CREATE_NO_WINDOW)
	if err := windows.CreateProcessAsUser(process.token, application, commandLine, nil, nil, true, flags, nil, currentDir, &startupInfo, &processInfo); err != nil {
		process.closeChildPipeHandlesLocked()
		return err
	}

	process.process = processInfo.Process
	process.thread = processInfo.Thread
	process.started = true
	process.closeChildPipeHandlesLocked()
	go process.killOnContextDone()
	return nil
}

func (process *windowsInteractiveDesktopCaptureProcess) Kill() error {
	process.mu.Lock()
	defer process.mu.Unlock()
	if process.process == 0 || process.waited {
		return nil
	}
	return windows.TerminateProcess(process.process, 1)
}

func (process *windowsInteractiveDesktopCaptureProcess) Wait() error {
	process.mu.Lock()
	if !process.started {
		process.mu.Unlock()
		return fmt.Errorf("capture process has not started")
	}
	if process.waited {
		process.mu.Unlock()
		return nil
	}
	handle := process.process
	process.mu.Unlock()

	_, waitErr := windows.WaitForSingleObject(handle, windows.INFINITE)

	process.mu.Lock()
	defer process.mu.Unlock()
	process.waited = true
	if process.thread != 0 {
		_ = windows.CloseHandle(process.thread)
		process.thread = 0
	}
	if process.process != 0 {
		defer func() {
			_ = windows.CloseHandle(process.process)
			process.process = 0
		}()
	}
	if waitErr != nil {
		return waitErr
	}
	var exitCode uint32
	if err := windows.GetExitCodeProcess(handle, &exitCode); err != nil {
		return err
	}
	if exitCode != 0 {
		return fmt.Errorf("capture process exited with code %d", exitCode)
	}
	return nil
}

func (process *windowsInteractiveDesktopCaptureProcess) killOnContextDone() {
	if process.ctx == nil {
		return
	}
	<-process.ctx.Done()
	_ = process.Kill()
}

func (process *windowsInteractiveDesktopCaptureProcess) closeChildPipeHandlesLocked() {
	if process.stdoutW != 0 {
		_ = windows.CloseHandle(process.stdoutW)
		process.stdoutW = 0
	}
	if process.stderrW != 0 {
		_ = windows.CloseHandle(process.stderrW)
		process.stderrW = 0
	}
	if process.stdin != 0 {
		_ = windows.CloseHandle(process.stdin)
		process.stdin = 0
	}
}

func createInheritablePipe(name string) (*os.File, windows.Handle, error) {
	securityAttributes := inheritableSecurityAttributes()
	var readHandle windows.Handle
	var writeHandle windows.Handle
	if err := windows.CreatePipe(&readHandle, &writeHandle, securityAttributes, 0); err != nil {
		return nil, 0, err
	}
	if err := windows.SetHandleInformation(readHandle, windows.HANDLE_FLAG_INHERIT, 0); err != nil {
		_ = windows.CloseHandle(readHandle)
		_ = windows.CloseHandle(writeHandle)
		return nil, 0, err
	}
	return os.NewFile(uintptr(readHandle), name), writeHandle, nil
}

func openInheritableNUL() (windows.Handle, error) {
	securityAttributes := inheritableSecurityAttributes()
	return windows.CreateFile(
		windows.StringToUTF16Ptr("NUL"),
		windows.GENERIC_READ,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE,
		securityAttributes,
		windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL,
		0,
	)
}

func inheritableSecurityAttributes() *windows.SecurityAttributes {
	return &windows.SecurityAttributes{
		Length:        uint32(unsafe.Sizeof(windows.SecurityAttributes{})),
		InheritHandle: 1,
	}
}

func CurrentCaptureEnvironment() CaptureEnvironment {
	environment := CaptureEnvironment{
		State:                  "not_ready",
		CaptureAvailable:       false,
		LaunchMode:             "unavailable",
		Metadata:               map[string]any{},
		ActiveConsoleSessionID: windows.WTSGetActiveConsoleSessionId(),
	}

	var processSessionID uint32
	if err := windows.ProcessIdToSessionId(windows.GetCurrentProcessId(), &processSessionID); err == nil {
		environment.ProcessSessionID = processSessionID
		environment.Metadata["processSessionId"] = processSessionID
	}
	environment.Metadata["activeConsoleSessionId"] = environment.ActiveConsoleSessionID

	if environment.ActiveConsoleSessionID == 0xffffffff {
		environment.Reason = "no active Windows console session is available for desktop capture"
		return environment
	}

	if processSessionID == environment.ActiveConsoleSessionID {
		environment.State = "ready"
		environment.CaptureAvailable = true
		environment.LaunchMode = "current-interactive-session"
		environment.Reason = "agent is already running in the active interactive desktop session"
		environment.Metadata["captureLaunchMode"] = environment.LaunchMode
		return environment
	}

	var token windows.Token
	if err := windows.WTSQueryUserToken(environment.ActiveConsoleSessionID, &token); err != nil {
		environment.Reason = fmt.Sprintf("active console user token lookup failed: %v", err)
		environment.Metadata["captureLaunchMode"] = "service-session-token-unavailable"
		environment.Metadata["captureLaunchWarning"] = environment.Reason
		return environment
	}
	_ = token.Close()

	environment.State = "ready"
	environment.CaptureAvailable = true
	environment.LaunchMode = "active-console-user-session"
	environment.Reason = "active Windows console session is available for desktop capture"
	environment.Metadata["captureLaunchMode"] = environment.LaunchMode
	return environment
}

func captureEnvironmentMetadata(environment CaptureEnvironment) map[string]any {
	metadata := map[string]any{
		"captureLaunchMode": environment.LaunchMode,
		"captureState":      environment.State,
	}
	if environment.ProcessSessionID != 0 {
		metadata["processSessionId"] = environment.ProcessSessionID
	}
	if environment.ActiveConsoleSessionID != 0 {
		metadata["activeConsoleSessionId"] = environment.ActiveConsoleSessionID
	}
	if environment.Reason != "" {
		metadata["captureEnvironmentReason"] = environment.Reason
	}
	for key, value := range environment.Metadata {
		metadata[key] = value
	}
	return metadata
}
