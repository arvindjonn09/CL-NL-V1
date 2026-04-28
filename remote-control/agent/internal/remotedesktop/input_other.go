//go:build !windows

package remotedesktop

import "fmt"

func InjectInput(_ ControlMessage) error {
	return fmt.Errorf("remote desktop input injection is only supported on Windows")
}
