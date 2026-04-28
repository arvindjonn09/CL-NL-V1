package remotedesktop

import (
	"io"
	"os/exec"
	"sync"
)

type CaptureEnvironment struct {
	State                  string         `json:"state"`
	CaptureAvailable       bool           `json:"captureAvailable"`
	LaunchMode             string         `json:"launchMode"`
	ProcessSessionID       uint32         `json:"processSessionId,omitempty"`
	ActiveConsoleSessionID uint32         `json:"activeConsoleSessionId,omitempty"`
	Reason                 string         `json:"reason,omitempty"`
	Metadata               map[string]any `json:"metadata,omitempty"`
}

type captureLaunchState struct {
	metadata map[string]any
	release  func()
}

type CaptureProcess interface {
	Args() []string
	StdoutPipe() (io.ReadCloser, error)
	StderrPipe() (io.ReadCloser, error)
	Start() error
	Kill() error
	Wait() error
}

type execCaptureProcess struct {
	cmd *exec.Cmd
}

func newExecCaptureProcess(cmd *exec.Cmd) *execCaptureProcess {
	return &execCaptureProcess{cmd: cmd}
}

func (process *execCaptureProcess) Args() []string {
	if process == nil || process.cmd == nil {
		return nil
	}
	return process.cmd.Args
}

func (process *execCaptureProcess) StdoutPipe() (io.ReadCloser, error) {
	return process.cmd.StdoutPipe()
}

func (process *execCaptureProcess) StderrPipe() (io.ReadCloser, error) {
	return process.cmd.StderrPipe()
}

func (process *execCaptureProcess) Start() error {
	return process.cmd.Start()
}

func (process *execCaptureProcess) Kill() error {
	if process.cmd.Process == nil {
		return nil
	}
	return process.cmd.Process.Kill()
}

func (process *execCaptureProcess) Wait() error {
	return process.cmd.Wait()
}

var captureLaunchStates sync.Map

func rememberCaptureLaunchState(process CaptureProcess, metadata map[string]any, release func()) {
	if process == nil {
		if release != nil {
			release()
		}
		return
	}
	captureLaunchStates.Store(process, captureLaunchState{
		metadata: metadata,
		release:  release,
	})
}

func CaptureLaunchMetadata(process CaptureProcess) map[string]any {
	if process == nil {
		return nil
	}
	value, ok := captureLaunchStates.Load(process)
	if !ok {
		return nil
	}
	state := value.(captureLaunchState)
	return state.metadata
}

func ReleaseCaptureResources(process CaptureProcess) {
	if process == nil {
		return
	}
	value, ok := captureLaunchStates.LoadAndDelete(process)
	if !ok {
		return
	}
	state := value.(captureLaunchState)
	if state.release != nil {
		state.release()
	}
}
