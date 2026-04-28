package remotedesktop

import (
	"runtime"
	"testing"
)

func TestCurrentCapabilityReportsNonWindowsNotReady(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("non-Windows readiness test")
	}

	capability := CurrentCapability()
	if capability.State == "ready" {
		t.Fatalf("expected non-Windows agent to report not ready, got ready")
	}
	if capability.ScreenCapture == "ready" || capability.Input == "ready" {
		t.Fatalf("expected non-Windows capture/input to stay not ready, got capture=%s input=%s", capability.ScreenCapture, capability.Input)
	}
}
