//go:build !windows

package main

import "fmt"

func requestServiceRestart(_ *Config) (string, map[string]interface{}, error) {
	return "", nil, fmt.Errorf("restart-service is only supported for Windows service mode")
}
