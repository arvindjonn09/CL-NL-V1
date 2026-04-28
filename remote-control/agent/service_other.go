//go:build !windows

package main

func runWindowsServiceIfNeeded() bool {
	return false
}
