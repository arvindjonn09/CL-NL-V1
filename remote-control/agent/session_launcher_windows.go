//go:build windows

package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

const helperInteractiveDesktopName = "WinSta0\\Default"

var (
	userenv                     = windows.NewLazySystemDLL("userenv.dll")
	procCreateEnvironmentBlock  = userenv.NewProc("CreateEnvironmentBlock")
	procDestroyEnvironmentBlock = userenv.NewProc("DestroyEnvironmentBlock")

	wtsapi32             = windows.NewLazySystemDLL("wtsapi32.dll")
	procEnumerateSessions = wtsapi32.NewProc("WTSEnumerateSessionsW")
	procWTSFreeMemory    = wtsapi32.NewProc("WTSFreeMemory")
)

// wtsSessionInfo mirrors WTS_SESSION_INFOW
type wtsSessionInfo struct {
	SessionID      uint32
	WinStationName *uint16
	State          uint32
}

const wtsStateActive = 0 // WTSActive — user is logged on and has the desktop

// findActiveUserSessionID returns the session ID of the first active logged-on
// user session (state == WTSActive, session != 0). It finds both console and
// RDP sessions, so it works regardless of how the user connected.
func findActiveUserSessionID() (uint32, error) {
	var info *wtsSessionInfo
	var count uint32
	ret, _, err := procEnumerateSessions.Call(
		0, 0, 1,
		uintptr(unsafe.Pointer(&info)),
		uintptr(unsafe.Pointer(&count)),
	)
	if ret == 0 {
		return 0, fmt.Errorf("WTSEnumerateSessionsW: %w", err)
	}
	defer procWTSFreeMemory.Call(uintptr(unsafe.Pointer(info)))

	stride := unsafe.Sizeof(wtsSessionInfo{})
	for i := uint32(0); i < count; i++ {
		s := (*wtsSessionInfo)(unsafe.Pointer(uintptr(unsafe.Pointer(info)) + uintptr(i)*stride))
		if s.SessionID != 0 && s.State == wtsStateActive {
			return s.SessionID, nil
		}
	}
	return 0, fmt.Errorf("no active user session found (enumerated %d sessions)", count)
}

type desktopHelperProcess struct {
	cmd     *exec.Cmd
	process windows.Handle
	thread  windows.Handle
}

func launchDesktopHelper(ctx context.Context, sessionID, pipeName string) (*desktopHelperProcess, error) {
	exePath, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("resolve helper executable: %w", err)
	}

	args := []string{
		exePath,
		"--helper",
		"--pipe=" + pipeName,
		"--session-id=" + sessionID,
	}

	activeSessionID, err := findActiveUserSessionID()
	if err != nil {
		return nil, fmt.Errorf("find active user session: %w", err)
	}

	var processSessionID uint32
	_ = windows.ProcessIdToSessionId(windows.GetCurrentProcessId(), &processSessionID)

	logger("remote-desktop").Info("helper-launch", "launching desktop helper process",
		logMetadata("activeSessionId", activeSessionID, "serviceSessionId", processSessionID, "pipe", pipeName))

	if processSessionID == activeSessionID {
		logger("remote-desktop").Info("helper-launch-path", "using fast path: service is already in active session",
			logMetadata("sessionId", sessionID, "windowsSessionId", activeSessionID))
		cmd := exec.CommandContext(ctx, exePath, args[1:]...)
		cmd.Dir = filepath.Dir(exePath)
		if err := cmd.Start(); err != nil {
			return nil, err
		}
		logger("remote-desktop").Info("helper-launched", "helper launched via fast path",
			logMetadata("sessionId", sessionID, "pid", cmd.Process.Pid))
		return &desktopHelperProcess{cmd: cmd}, nil
	}

	logger("remote-desktop").Info("helper-launch-path", "using CreateProcessAsUser path",
		logMetadata("sessionId", sessionID, "targetWindowsSessionId", activeSessionID))

	var token windows.Token
	if err := windows.WTSQueryUserToken(activeSessionID, &token); err != nil {
		return nil, fmt.Errorf("query active user token for session %d: %w", activeSessionID, err)
	}
	defer token.Close()

	environment, err := createUserEnvironmentBlock(token)
	if err != nil {
		return nil, fmt.Errorf("create helper user environment: %w", err)
	}
	defer destroyUserEnvironmentBlock(environment)

	desktop, err := windows.UTF16PtrFromString(helperInteractiveDesktopName)
	if err != nil {
		return nil, err
	}
	commandLine, err := windows.UTF16PtrFromString(windows.ComposeCommandLine(args))
	if err != nil {
		return nil, err
	}
	application, err := windows.UTF16PtrFromString(exePath)
	if err != nil {
		return nil, err
	}
	currentDir, err := windows.UTF16PtrFromString(filepath.Dir(exePath))
	if err != nil {
		return nil, err
	}

	startupInfo := windows.StartupInfo{
		Cb:         uint32(unsafe.Sizeof(windows.StartupInfo{})),
		Desktop:    desktop,
		Flags:      windows.STARTF_USESHOWWINDOW,
		ShowWindow: windows.SW_HIDE,
	}
	var processInfo windows.ProcessInformation
	flags := uint32(windows.CREATE_DEFAULT_ERROR_MODE | windows.CREATE_UNICODE_ENVIRONMENT | windows.CREATE_NO_WINDOW)
	if err := windows.CreateProcessAsUser(token, application, commandLine, nil, nil, false, flags, environment, currentDir, &startupInfo, &processInfo); err != nil {
		return nil, fmt.Errorf("create helper process as active user: %w", err)
	}

	logger("remote-desktop").Info("helper-launched", "helper launched via CreateProcessAsUser",
		logMetadata("sessionId", sessionID, "pid", processInfo.ProcessId, "targetWindowsSessionId", activeSessionID))

	helper := &desktopHelperProcess{
		process: processInfo.Process,
		thread:  processInfo.Thread,
	}
	go func() {
		<-ctx.Done()
		_ = helper.Kill()
	}()
	return helper, nil
}

func createUserEnvironmentBlock(token windows.Token) (*uint16, error) {
	var environment uintptr
	result, _, err := procCreateEnvironmentBlock.Call(
		uintptr(unsafe.Pointer(&environment)),
		uintptr(token),
		0,
	)
	if result == 0 {
		return nil, launcherWindowsAPICallError(err)
	}
	return (*uint16)(unsafe.Pointer(environment)), nil
}

func destroyUserEnvironmentBlock(environment *uint16) {
	if environment == nil {
		return
	}
	procDestroyEnvironmentBlock.Call(uintptr(unsafe.Pointer(environment)))
}

func launcherWindowsAPICallError(err error) error {
	if err == nil || err == windows.ERROR_SUCCESS {
		return fmt.Errorf("api returned failure without extended error")
	}
	return err
}

func (process *desktopHelperProcess) Kill() error {
	if process == nil {
		return nil
	}
	if process.cmd != nil && process.cmd.Process != nil {
		return process.cmd.Process.Kill()
	}
	if process.process != 0 {
		return windows.TerminateProcess(process.process, 1)
	}
	return nil
}

func (process *desktopHelperProcess) Wait() error {
	if process == nil {
		return nil
	}
	if process.cmd != nil {
		return process.cmd.Wait()
	}
	if process.process == 0 {
		return nil
	}
	_, waitErr := windows.WaitForSingleObject(process.process, windows.INFINITE)
	if process.thread != 0 {
		_ = windows.CloseHandle(process.thread)
		process.thread = 0
	}
	handle := process.process
	process.process = 0
	defer windows.CloseHandle(handle)
	if waitErr != nil {
		return waitErr
	}
	var exitCode uint32
	if err := windows.GetExitCodeProcess(handle, &exitCode); err != nil {
		return err
	}
	if exitCode != 0 {
		return fmt.Errorf("desktop helper exited with code %d", exitCode)
	}
	return nil
}
