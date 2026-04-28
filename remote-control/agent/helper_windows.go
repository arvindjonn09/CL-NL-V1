//go:build windows

package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	agentlogging "remote-control-agent/internal/logging"
	agentremotedesktop "remote-control-agent/internal/remotedesktop"
	"setulinkpaths"
)

type helperOptions struct {
	Helper    bool
	Pipe      string
	SessionID string
}

func maybeRunHelperMode(args []string) (bool, error) {
	if !helperFlagPresent(args) {
		return false, nil
	}
	opts, err := parseHelperOptions(args)
	if err != nil {
		return true, err
	}
	if opts.Pipe == "" {
		return true, fmt.Errorf("--pipe is required in helper mode")
	}
	if opts.SessionID == "" {
		return true, fmt.Errorf("--session-id is required in helper mode")
	}
	return true, RunRemoteDesktopHelper(context.Background(), opts)
}

func helperFlagPresent(args []string) bool {
	for _, arg := range args {
		if arg == "--helper" || arg == "-helper" || strings.HasPrefix(arg, "--helper=") || strings.HasPrefix(arg, "-helper=") {
			return true
		}
	}
	return false
}

func parseHelperOptions(args []string) (helperOptions, error) {
	fs := flag.NewFlagSet("setulink-agent-helper", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)

	var opts helperOptions
	fs.BoolVar(&opts.Helper, "helper", false, "run remote desktop helper mode")
	fs.StringVar(&opts.Pipe, "pipe", "", "remote desktop helper pipe")
	fs.StringVar(&opts.SessionID, "session-id", "", "remote desktop session id")
	if err := fs.Parse(args); err != nil {
		return opts, err
	}
	return opts, nil
}

func RunRemoteDesktopHelper(ctx context.Context, opts helperOptions) error {
	log := newDesktopHelperLogger()
	if log != nil {
		log.Info("helper-start", "remote desktop helper starting", logMetadata("sessionId", opts.SessionID, "pipe", opts.Pipe))
	}

	conn, err := dialDesktopPipe(ctx, opts.Pipe, 15*time.Second)
	if err != nil {
		if log != nil {
			log.Warn("helper-pipe-connect-failed", "remote desktop helper failed to connect to pipe", err, logMetadata("sessionId", opts.SessionID, "pipe", opts.Pipe))
		}
		return fmt.Errorf("connect helper pipe: %w", err)
	}
	defer conn.Close()
	defer func() {
		if log != nil {
			log.Info("helper-stop", "remote desktop helper stopping", logMetadata("sessionId", opts.SessionID))
		}
	}()
	if log != nil {
		log.Info("helper-pipe-connected", "remote desktop helper connected to pipe", logMetadata("sessionId", opts.SessionID, "pipe", opts.Pipe))
	}

	var writeMu sync.Mutex
	writeMsg := func(msgType byte, payload []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return writeDesktopPipeMessage(conn, msgType, payload)
	}

	errCh := make(chan error, 2)
	go func() {
		errCh <- runHelperCaptureLoop(ctx, writeMsg)
	}()
	go func() {
		errCh <- runHelperControlLoop(ctx, conn, writeMsg)
	}()

	select {
	case <-ctx.Done():
		return nil
	case err := <-errCh:
		return err
	}
}

func newDesktopHelperLogger() *agentlogging.Logger {
	layout, err := setulinkpaths.CurrentLayout()
	if err != nil {
		return nil
	}
	log, err := agentlogging.New(layout.AgentLogPath)
	if err != nil {
		return nil
	}
	return log.WithComponent("remote-desktop").WithRunMode("windows-helper")
}

func runHelperCaptureLoop(ctx context.Context, writeMsg func(byte, []byte) error) error {
	ticker := time.NewTicker(40 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}

		frame, err := agentremotedesktop.CaptureJPEG()
		if err != nil {
			return fmt.Errorf("capture jpeg desktop frame: %w", err)
		}

		payload, err := encodeDesktopPipeFramePayload(desktopPipeFrameHeader{
			Encoding:   "jpeg",
			Width:      frame.Width,
			Height:     frame.Height,
			CapturedAt: time.Now().UnixMilli(),
		}, frame.Data)
		if err != nil {
			return err
		}
		if err := writeMsg(desktopPipeMessageFrame, payload); err != nil {
			return fmt.Errorf("write desktop frame to pipe: %w", err)
		}
	}
}

func runHelperControlLoop(ctx context.Context, conn desktopPipeConn, writeMsg func(byte, []byte) error) error {
	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}
		messageType, payload, err := readDesktopPipeMessage(conn)
		if err != nil {
			return fmt.Errorf("read helper control pipe: %w", err)
		}
		switch messageType {
		case desktopPipeMessageInput:
			control, err := agentremotedesktop.DecodeControlMessage(payload)
			if err != nil {
				continue
			}
			_ = agentremotedesktop.InjectInput(control)
		case desktopPipeMessagePing:
			_ = writeMsg(desktopPipeMessagePong, nil)
		case desktopPipeMessageStop:
			return nil
		}
	}
}
