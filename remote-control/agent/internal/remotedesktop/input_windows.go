//go:build windows

package remotedesktop

import (
	"fmt"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	inputMouse    = 0
	inputKeyboard = 1

	mouseEventFMove       = 0x0001
	mouseEventFLeftDown   = 0x0002
	mouseEventFLeftUp     = 0x0004
	mouseEventFRightDown  = 0x0008
	mouseEventFRightUp    = 0x0010
	mouseEventFMiddleDown = 0x0020
	mouseEventFMiddleUp   = 0x0040

	keyEventFKeyUp = 0x0002
)

var (
	user32               = windows.NewLazySystemDLL("user32.dll")
	procSendInput        = user32.NewProc("SendInput")
	procSetCursorPos     = user32.NewProc("SetCursorPos")
	procGetSystemMetrics = user32.NewProc("GetSystemMetrics")
)

type mouseInput struct {
	Dx          int32
	Dy          int32
	MouseData   uint32
	DwFlags     uint32
	Time        uint32
	DwExtraInfo uintptr
}

type keyboardInput struct {
	WVk         uint16
	WScan       uint16
	DwFlags     uint32
	Time        uint32
	DwExtraInfo uintptr
}

type input struct {
	Type uint32
	Ki   keyboardInput
}

type mouseEventInput struct {
	Type uint32
	Mi   mouseInput
}

func InjectInput(message ControlMessage) error {
	switch message.Type {
	case "mouse_move":
		return moveCursor(message)
	case "mouse_down":
		if err := moveCursor(message); err != nil {
			return err
		}
		return sendMouse(buttonFlag(message.Button, true))
	case "mouse_up":
		if err := moveCursor(message); err != nil {
			return err
		}
		return sendMouse(buttonFlag(message.Button, false))
	case "key_down":
		return sendKey(virtualKey(message), false)
	case "key_up":
		return sendKey(virtualKey(message), true)
	default:
		return nil
	}
}

func screenCoordinates(message ControlMessage) (int, int) {
	if message.XRatio > 0 || message.YRatio > 0 {
		width, _, _ := procGetSystemMetrics.Call(0)
		height, _, _ := procGetSystemMetrics.Call(1)
		return int(clampRatio(message.XRatio) * float64(width)), int(clampRatio(message.YRatio) * float64(height))
	}
	return message.X, message.Y
}

func clampRatio(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}

func moveCursor(message ControlMessage) error {
	x, y := screenCoordinates(message)
	_, _, err := procSetCursorPos.Call(uintptr(x), uintptr(y))
	if err != windows.ERROR_SUCCESS {
		return fmt.Errorf("set cursor position: %w", err)
	}
	return nil
}

func buttonFlag(button int, down bool) uint32 {
	switch button {
	case 1:
		if down {
			return mouseEventFMiddleDown
		}
		return mouseEventFMiddleUp
	case 2:
		if down {
			return mouseEventFRightDown
		}
		return mouseEventFRightUp
	default:
		if down {
			return mouseEventFLeftDown
		}
		return mouseEventFLeftUp
	}
}

func sendMouse(flag uint32) error {
	if flag == 0 {
		return nil
	}
	event := mouseEventInput{Type: inputMouse, Mi: mouseInput{DwFlags: flag | mouseEventFMove}}
	return sendInput(unsafe.Pointer(&event), unsafe.Sizeof(event))
}

func sendKey(vk uint16, up bool) error {
	if vk == 0 {
		return nil
	}
	flags := uint32(0)
	if up {
		flags = keyEventFKeyUp
	}
	event := input{Type: inputKeyboard, Ki: keyboardInput{WVk: vk, DwFlags: flags}}
	return sendInput(unsafe.Pointer(&event), unsafe.Sizeof(event))
}

func sendInput(ptr unsafe.Pointer, size uintptr) error {
	result, _, err := procSendInput.Call(1, uintptr(ptr), size)
	if result == 0 {
		return fmt.Errorf("send input: %w", err)
	}
	return nil
}

func virtualKey(message ControlMessage) uint16 {
	code := strings.ToUpper(message.Code)
	if strings.HasPrefix(code, "KEY") && len(code) == 4 {
		return uint16(code[3])
	}
	if strings.HasPrefix(code, "DIGIT") && len(code) == 6 {
		return uint16(code[5])
	}
	switch code {
	case "ENTER":
		return 0x0D
	case "ESCAPE":
		return 0x1B
	case "BACKSPACE":
		return 0x08
	case "TAB":
		return 0x09
	case "SPACE":
		return 0x20
	case "ARROWLEFT":
		return 0x25
	case "ARROWUP":
		return 0x26
	case "ARROWRIGHT":
		return 0x27
	case "ARROWDOWN":
		return 0x28
	case "DELETE":
		return 0x2E
	}
	if len(message.Key) == 1 {
		return uint16(strings.ToUpper(message.Key)[0])
	}
	return 0
}
