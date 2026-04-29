//go:build windows

package remotedesktop

import "golang.org/x/sys/windows"

func TriggerSAS() error {
	sasDLL := windows.NewLazySystemDLL("sas.dll")
	sendSAS := sasDLL.NewProc("SendSAS")
	_, _, err := sendSAS.Call(0)
	if err != windows.ERROR_SUCCESS {
		return err
	}
	return nil
}
