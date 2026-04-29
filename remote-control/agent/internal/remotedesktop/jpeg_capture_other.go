//go:build !windows

package remotedesktop

import "fmt"

func CaptureJPEG(_ CaptureOptions) (JPEGFrame, error) {
	return JPEGFrame{}, fmt.Errorf("jpeg desktop capture is only supported on Windows")
}
