//go:build !windows

package main

import (
	"fmt"
	"strings"
)

func maybeRunHelperMode(args []string) (bool, error) {
	for _, arg := range args {
		if arg == "--helper" || arg == "-helper" || strings.HasPrefix(arg, "--helper=") || strings.HasPrefix(arg, "-helper=") {
			return true, fmt.Errorf("remote desktop helper mode is only supported on Windows")
		}
	}
	return false, nil
}
