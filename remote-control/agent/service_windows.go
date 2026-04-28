//go:build windows

package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime/debug"
	"time"

	"golang.org/x/sys/windows/svc"
	agentlogging "remote-control-agent/internal/logging"
	"setulinkpaths"
)

const windowsServiceName = "SetuLinkAgent"

type setuLinkService struct{}

func runWindowsServiceIfNeeded() bool {
	isService, err := svc.IsWindowsService()
	if err != nil || !isService {
		return false
	}

	if err := svc.Run(windowsServiceName, setuLinkService{}); err != nil {
		fmt.Fprintln(os.Stderr, "service run error:", err)
	}
	return true
}

func (setuLinkService) Execute(args []string, requests <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	errCh := make(chan error, 1)
	status <- svc.Status{State: svc.StartPending, WaitHint: 10000}

	go func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				errCh <- fmt.Errorf("panic: %v\n%s", recovered, debug.Stack())
			}
		}()
		errCh <- runAgent(ctx, "windows-service")
	}()

	status <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}

	for {
		select {
		case err := <-errCh:
			if err != nil {
				writeWindowsServiceFailureLog(err)
				return true, 1
			}
			status <- svc.Status{State: svc.StopPending, WaitHint: 5000}
			return false, 0

		case request := <-requests:
			switch request.Cmd {
			case svc.Interrogate:
				status <- request.CurrentStatus
			case svc.Stop, svc.Shutdown:
				status <- svc.Status{State: svc.StopPending, WaitHint: 10000}
				cancel()
				err := <-errCh
				if err != nil {
					writeWindowsServiceFailureLog(err)
					return true, 1
				}
				return false, 0
			default:
				status <- request.CurrentStatus
			}
		}
	}
}

func writeWindowsServiceFailureLog(err error) {
	layout, layoutErr := setulinkpaths.CurrentLayout()
	if layoutErr != nil {
		fmt.Fprintln(os.Stderr, "service runAgent error:", err)
		fmt.Fprintln(os.Stderr, "service log path error:", layoutErr)
		return
	}

	_ = os.MkdirAll(layout.LogsDir, 0755)
	logPath := layout.AgentLogPath
	log, openErr := agentlogging.New(logPath)
	if openErr != nil {
		fmt.Fprintln(os.Stderr, "service runAgent error:", err)
		fmt.Fprintln(os.Stderr, "open service log error:", openErr, filepath.Clean(logPath))
		return
	}

	log.WithComponent("service").WithRunMode("windows-service").Error("run-agent", "service runAgent error", err, map[string]any{
		"at": time.Now().Format(time.RFC3339),
	})
}
