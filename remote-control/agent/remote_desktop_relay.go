package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"time"
)

type remoteDesktopRelayFrame struct {
	Type       string `json:"type"`
	SessionID  string `json:"sessionId"`
	DeviceID   string `json:"deviceId"`
	Encoding   string `json:"encoding"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	CapturedAt int64  `json:"capturedAt"`
}

type remoteDesktopRelayStatus struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
	DeviceID  string `json:"deviceId"`
	Status    string `json:"status"`
	Reason    string `json:"reason,omitempty"`
}

var remoteDesktopBinaryMagic = []byte{'R', 'D', 'F', '1'}

func StartRemoteDesktopRelay(ctx context.Context, cfg *Config, sessionID string, writeJSON func(any) error, writeBinary func([]byte) error) {
	if sessionID == "" {
		return
	}
	if isRemoteDesktopRuntimeActive(sessionID) {
		return
	}

	runtimeCtx, cancel := context.WithCancel(ctx)
	remoteDesktopRuntimes.Lock()
	if _, exists := remoteDesktopRuntimes.active[sessionID]; exists {
		remoteDesktopRuntimes.Unlock()
		cancel()
		return
	}
	remoteDesktopRuntimes.active[sessionID] = activeRemoteDesktopRuntime{cancel: cancel}
	remoteDesktopRuntimes.Unlock()

	go func() {
		defer func() {
			cancel()
			remoteDesktopRuntimes.Lock()
			delete(remoteDesktopRuntimes.active, sessionID)
			remoteDesktopRuntimes.Unlock()
		}()

		if err := runRemoteDesktopRelay(runtimeCtx, cfg, sessionID, writeJSON, writeBinary); err != nil {
			recordAgentError("remote-desktop-relay", err)
			logger("remote-desktop").Warn("relay", "remote desktop relay failed", err, logMetadata("sessionId", sessionID))
			_ = SendRemoteDesktopStatus(cfg, sessionID, "failed", err.Error())
			_ = writeJSON(remoteDesktopRelayStatus{
				Type:      "remote-desktop-status",
				SessionID: sessionID,
				DeviceID:  cfg.DeviceID,
				Status:    "failed",
				Reason:    err.Error(),
			})
		}
	}()
}

func runRemoteDesktopRelay(ctx context.Context, cfg *Config, sessionID string, writeJSON func(any) error, writeBinary func([]byte) error) error {
	startedAt := time.Now()
	elapsed := func() int64 {
		return time.Since(startedAt).Milliseconds()
	}
	logger("remote-desktop").Info("relay-start", "remote desktop websocket relay starting", logMetadata("sessionId", sessionID, "elapsedMs", elapsed()))
	if err := SendRemoteDesktopStatus(cfg, sessionID, "media_starting", "agent websocket relay starting"); err != nil {
		return err
	}

	pipeServer, err := createDesktopPipeServer(sessionID)
	if err != nil {
		return fmt.Errorf("create desktop helper pipe: %w", err)
	}
	defer pipeServer.Close()
	logger("remote-desktop").Info("pipe-created", "remote desktop helper pipe created", logMetadata("sessionId", sessionID, "elapsedMs", elapsed()))

	helper, err := launchDesktopHelper(ctx, sessionID, pipeServer.name)
	if err != nil {
		return fmt.Errorf("launch desktop helper: %w", err)
	}
	logger("remote-desktop").Info("helper-launched", "remote desktop helper process launched", logMetadata("sessionId", sessionID, "elapsedMs", elapsed()))
	defer func() {
		_ = helper.Kill()
	}()

	helperExited := make(chan error, 1)
	go func() {
		helperExited <- helper.Wait()
	}()

	pipeAcceptCtx, cancelAccept := context.WithTimeout(ctx, 15*time.Second)
	pipeCh := make(chan struct {
		pipe desktopPipeConn
		err  error
	}, 1)
	go func() {
		pipe, err := pipeServer.Accept(pipeAcceptCtx)
		pipeCh <- struct {
			pipe desktopPipeConn
			err  error
		}{pipe: pipe, err: err}
	}()

	var pipe desktopPipeConn
	select {
	case result := <-pipeCh:
		cancelAccept()
		if result.err != nil {
			return fmt.Errorf("desktop helper did not connect to pipe: %w", result.err)
		}
		pipe = result.pipe
	case err := <-helperExited:
		cancelAccept()
		if err != nil {
			return fmt.Errorf("desktop helper exited before connecting to pipe: %w", err)
		}
		return fmt.Errorf("desktop helper exited before connecting to pipe")
	}
	defer pipe.Close()

	remoteDesktopRuntimes.Lock()
	active := remoteDesktopRuntimes.active[sessionID]
	active.pipe = pipe
	remoteDesktopRuntimes.active[sessionID] = active
	remoteDesktopRuntimes.Unlock()
	defer func() {
		_ = writeDesktopPipeMessage(pipe, desktopPipeMessageStop, nil)
	}()

	logger("remote-desktop").Info("helper-connected", "remote desktop helper connected to pipe", logMetadata("sessionId", sessionID, "elapsedMs", elapsed()))
	firstFrame := true

	for {
		select {
		case <-ctx.Done():
			return nil
		case err := <-helperExited:
			if err != nil {
				return fmt.Errorf("desktop helper exited: %w", err)
			}
			return fmt.Errorf("desktop helper exited")
		default:
		}

		messageType, payload, err := readDesktopPipeMessage(pipe)
		if err != nil {
			return fmt.Errorf("read desktop helper pipe: %w", err)
		}
		if messageType == desktopPipeMessageJSON {
			var message any
			if err := json.Unmarshal(payload, &message); err != nil {
				return fmt.Errorf("decode desktop helper json message: %w", err)
			}
			if err := writeJSON(message); err != nil {
				return fmt.Errorf("send desktop helper json message: %w", err)
			}
			continue
		}
		if messageType != desktopPipeMessageFrame {
			continue
		}
		frameHeader, jpeg, err := decodeDesktopPipeFramePayload(payload)
		if err != nil {
			return fmt.Errorf("decode desktop helper frame: %w", err)
		}

		if firstFrame {
			if err := SendRemoteDesktopStatus(cfg, sessionID, "connected", "agent websocket relay publishing jpeg frames"); err != nil {
				return err
			}
			logger("remote-desktop").Info("first-frame-received", "first desktop helper frame received", logMetadata("sessionId", sessionID, "elapsedMs", elapsed(), "captureAgeMs", time.Now().UnixMilli()-frameHeader.CapturedAt))
		}

		websocketPayload, err := encodeRemoteDesktopBinaryFrame(remoteDesktopRelayFrame{
			Type:       "remote-desktop-frame",
			SessionID:  sessionID,
			DeviceID:   cfg.DeviceID,
			Encoding:   frameHeader.Encoding,
			Width:      frameHeader.Width,
			Height:     frameHeader.Height,
			CapturedAt: frameHeader.CapturedAt,
		}, jpeg)
		if err != nil {
			return err
		}
		if err := writeBinary(websocketPayload); err != nil {
			return fmt.Errorf("send desktop frame: %w", err)
		}
		if firstFrame {
			logger("remote-desktop").Info("first-frame-sent", "first desktop frame sent to websocket relay", logMetadata("sessionId", sessionID, "elapsedMs", elapsed()))
			firstFrame = false
		}
	}
}

func encodeRemoteDesktopBinaryFrame(header remoteDesktopRelayFrame, jpeg []byte) ([]byte, error) {
	headerBytes, err := json.Marshal(header)
	if err != nil {
		return nil, fmt.Errorf("marshal desktop frame header: %w", err)
	}
	if uint64(len(headerBytes)) > uint64(^uint32(0)) {
		return nil, fmt.Errorf("desktop frame header too large")
	}

	var out bytes.Buffer
	out.Write(remoteDesktopBinaryMagic)
	var headerLength [4]byte
	binary.BigEndian.PutUint32(headerLength[:], uint32(len(headerBytes)))
	out.Write(headerLength[:])
	out.Write(headerBytes)
	out.Write(jpeg)
	return out.Bytes(), nil
}

func ProcessRemoteDesktopRelayControl(sessionID string, payload json.RawMessage) error {
	if len(payload) == 0 {
		return nil
	}

	remoteDesktopRuntimes.Lock()
	active, ok := remoteDesktopRuntimes.active[sessionID]
	remoteDesktopRuntimes.Unlock()
	if !ok || active.pipe == nil {
		return fmt.Errorf("remote desktop helper pipe is not connected")
	}

	var control map[string]any
	if err := json.Unmarshal(payload, &control); err == nil {
		control["sessionId"] = sessionID
		payload, _ = json.Marshal(control)
	}
	return writeDesktopPipeMessage(active.pipe, desktopPipeMessageInput, payload)
}
