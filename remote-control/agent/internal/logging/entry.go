package logging

type Entry struct {
	TS        string         `json:"ts"`
	Level     string         `json:"level"`
	Component string         `json:"component"`
	Action    string         `json:"action"`
	DeviceID  string         `json:"device_id,omitempty"`
	RunMode   string         `json:"run_mode,omitempty"`
	Message   string         `json:"message"`
	Error     string         `json:"error,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
}
