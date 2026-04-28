//go:build windows

package main

import (
	"fmt"

	"golang.org/x/sys/windows"
)

func acquireSingleInstanceLock() (func(), error) {
	name, err := windows.UTF16PtrFromString(`SetuLinkAgent`)
	if err != nil {
		return nil, fmt.Errorf("prepare mutex name: %w", err)
	}

	handle, err := windows.CreateMutex(nil, true, name)
	if err != nil {
		return nil, fmt.Errorf("create mutex: %w", err)
	}

	if err == windows.ERROR_ALREADY_EXISTS {
		windows.CloseHandle(handle)
		return nil, fmt.Errorf("another setulink-agent.exe process is already running")
	}

	release := func() {
		windows.ReleaseMutex(handle)
		windows.CloseHandle(handle)
	}

	return release, nil
}
