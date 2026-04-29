//go:build windows

package remotedesktop

import (
	"fmt"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	procOpenClipboard    = user32.NewProc("OpenClipboard")
	procCloseClipboard   = user32.NewProc("CloseClipboard")
	procEmptyClipboard   = user32.NewProc("EmptyClipboard")
	procSetClipboardData = user32.NewProc("SetClipboardData")
	procGetClipboardData = user32.NewProc("GetClipboardData")
	kernel32             = windows.NewLazySystemDLL("kernel32.dll")
	procGlobalAlloc      = kernel32.NewProc("GlobalAlloc")
	procGlobalLock       = kernel32.NewProc("GlobalLock")
	procGlobalUnlock     = kernel32.NewProc("GlobalUnlock")
	procGlobalFree       = kernel32.NewProc("GlobalFree")
)

const (
	cfUnicodeText = 13
	gmemMoveable  = 0x0002
)

func WriteClipboard(text string) error {
	utf16, err := syscall.UTF16FromString(text)
	if err != nil {
		return fmt.Errorf("clipboard encode: %w", err)
	}
	size := uintptr(len(utf16) * 2)

	hMem, _, err := procGlobalAlloc.Call(gmemMoveable, size)
	if hMem == 0 {
		return fmt.Errorf("GlobalAlloc: %w", err)
	}

	ptr, _, err := procGlobalLock.Call(hMem)
	if ptr == 0 {
		procGlobalFree.Call(hMem)
		return fmt.Errorf("GlobalLock: %w", err)
	}
	for i, c := range utf16 {
		*(*uint16)(unsafe.Pointer(ptr + uintptr(i)*2)) = c
	}
	procGlobalUnlock.Call(hMem)

	r, _, err := procOpenClipboard.Call(0)
	if r == 0 {
		procGlobalFree.Call(hMem)
		return fmt.Errorf("OpenClipboard: %w", err)
	}
	defer procCloseClipboard.Call()

	procEmptyClipboard.Call()
	r, _, err = procSetClipboardData.Call(cfUnicodeText, hMem)
	if r == 0 {
		return fmt.Errorf("SetClipboardData: %w", err)
	}
	return nil
}

func ReadClipboard() (string, error) {
	r, _, err := procOpenClipboard.Call(0)
	if r == 0 {
		return "", fmt.Errorf("OpenClipboard: %w", err)
	}
	defer procCloseClipboard.Call()

	hMem, _, err := procGetClipboardData.Call(cfUnicodeText)
	if hMem == 0 {
		return "", fmt.Errorf("GetClipboardData: %w", err)
	}

	ptr, _, err := procGlobalLock.Call(hMem)
	if ptr == 0 {
		return "", fmt.Errorf("GlobalLock: %w", err)
	}
	defer procGlobalUnlock.Call(hMem)

	return syscall.UTF16ToString((*[1 << 20]uint16)(unsafe.Pointer(ptr))[:]), nil
}
