//go:build !windows

package main

import (
	"context"
	"fmt"
)

type desktopHelperProcess struct{}

func launchDesktopHelper(_ context.Context, _, _ string) (*desktopHelperProcess, error) {
	return nil, fmt.Errorf("remote desktop helper launch is only supported on Windows")
}

func (process *desktopHelperProcess) Kill() error {
	return nil
}

func (process *desktopHelperProcess) Wait() error {
	return nil
}
