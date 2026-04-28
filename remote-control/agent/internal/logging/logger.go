package logging

import (
	"encoding/json"
	"fmt"
	"os"
	"time"
)

type Logger struct {
	writer    *Writer
	component string
	deviceID  string
	runMode   string
}

func New(logPath string) (*Logger, error) {
	writer, err := NewWriter(logPath)
	if err != nil {
		return nil, err
	}
	return &Logger{writer: writer, component: "agent"}, nil
}

func (l *Logger) WithComponent(component string) *Logger {
	copyValue := *l
	copyValue.component = component
	return &copyValue
}

func (l *Logger) WithDevice(deviceID string) *Logger {
	copyValue := *l
	copyValue.deviceID = deviceID
	return &copyValue
}

func (l *Logger) WithRunMode(mode string) *Logger {
	copyValue := *l
	copyValue.runMode = mode
	return &copyValue
}

func (l *Logger) Debug(action, message string, metadata map[string]any) {
	l.log("debug", action, message, nil, metadata)
}

func (l *Logger) Info(action, message string, metadata map[string]any) {
	l.log("info", action, message, nil, metadata)
}

func (l *Logger) Warn(action, message string, err error, metadata map[string]any) {
	l.log("warn", action, message, err, metadata)
}

func (l *Logger) Error(action, message string, err error, metadata map[string]any) {
	l.log("error", action, message, err, metadata)
}

func (l *Logger) Fatal(action, message string, err error, metadata map[string]any) {
	l.log("fatal", action, message, err, metadata)
	os.Exit(1)
}

func (l *Logger) log(level, action, message string, err error, metadata map[string]any) {
	if l == nil || l.writer == nil {
		return
	}

	entry := Entry{
		TS:        time.Now().UTC().Format(time.RFC3339Nano),
		Level:     level,
		Component: l.component,
		Action:    action,
		DeviceID:  l.deviceID,
		RunMode:   l.runMode,
		Message:   message,
		Metadata:  metadata,
	}
	if err != nil {
		entry.Error = err.Error()
	}

	line, marshalErr := json.Marshal(entry)
	if marshalErr != nil {
		line = []byte(fmt.Sprintf(`{"ts":%q,"level":"error","component":"logger","action":"marshal","message":"failed to marshal log entry","error":%q}`, time.Now().UTC().Format(time.RFC3339Nano), marshalErr.Error()))
		level = "error"
	}

	_ = l.writer.WriteLine(line, level == "error" || level == "fatal")
}
