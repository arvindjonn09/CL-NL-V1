//go:build !windows

package main

import (
	"context"
	"fmt"
	"io"
	"time"
)

type desktopPipeConn interface {
	io.Reader
	io.Writer
	io.Closer
}

type desktopPipeServer struct {
	name string
}

type desktopPipeFrameHeader struct {
	Encoding   string `json:"encoding"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	CapturedAt int64  `json:"capturedAt"`
}

const (
	desktopPipeMessageFrame byte = 0x01
	desktopPipeMessageInput byte = 0x02
	desktopPipeMessagePing  byte = 0x03
	desktopPipeMessagePong  byte = 0x04
	desktopPipeMessageJSON  byte = 0x05
	desktopPipeMessageStop  byte = 0xff
)

func createDesktopPipeServer(_ string) (*desktopPipeServer, error) {
	return nil, fmt.Errorf("remote desktop helper pipes are only supported on Windows")
}

func (server *desktopPipeServer) Close() error {
	return nil
}

func (server *desktopPipeServer) Accept(_ context.Context) (desktopPipeConn, error) {
	return nil, fmt.Errorf("remote desktop helper pipes are only supported on Windows")
}

func dialDesktopPipe(_ context.Context, _ string, _ time.Duration) (desktopPipeConn, error) {
	return nil, fmt.Errorf("remote desktop helper pipes are only supported on Windows")
}

func writeDesktopPipeMessage(_ desktopPipeConn, _ byte, _ []byte) error {
	return fmt.Errorf("remote desktop helper pipes are only supported on Windows")
}

func readDesktopPipeMessage(_ desktopPipeConn) (byte, []byte, error) {
	return 0, nil, fmt.Errorf("remote desktop helper pipes are only supported on Windows")
}

func encodeDesktopPipeFramePayload(_ desktopPipeFrameHeader, _ []byte) ([]byte, error) {
	return nil, fmt.Errorf("remote desktop helper pipes are only supported on Windows")
}

func decodeDesktopPipeFramePayload(_ []byte) (desktopPipeFrameHeader, []byte, error) {
	return desktopPipeFrameHeader{}, nil, fmt.Errorf("remote desktop helper pipes are only supported on Windows")
}
