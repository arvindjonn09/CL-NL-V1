package main

import "testing"

func TestClassifyCaptureStderr(t *testing.T) {
	tests := []struct {
		name       string
		stderrText string
		want       string
	}{
		{
			name:       "access denied error 5",
			stderrText: "Failed to capture image (error 5)",
			want:       "gdigrab-access-denied",
		},
		{
			name:       "gdigrab open failure",
			stderrText: "desktop: I/O error",
			want:       "gdigrab-open-failure",
		},
		{
			name:       "encoder failure",
			stderrText: "Transparency encoding with auto_alt_ref does not work\nError while opening encoder",
			want:       "encoder-failure",
		},
		{
			name:       "unknown exit",
			stderrText: "some other ffmpeg failure",
			want:       "capture-process-exited",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := classifyCaptureStderr(test.stderrText); got != test.want {
				t.Fatalf("classifyCaptureStderr() = %q, want %q", got, test.want)
			}
		})
	}
}
