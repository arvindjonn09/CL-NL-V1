//go:build windows

package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"strings"
	"time"

	"github.com/Microsoft/go-winio"
)

type desktopPipeConn interface {
	io.Reader
	io.Writer
	io.Closer
}

type desktopPipeServer struct {
	name     string
	listener net.Listener
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

const desktopPipeSecurityDescriptor = "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;IU)(A;;GA;;;AU)"

func newDesktopPipeName(sessionID string) (string, error) {
	var nonce [12]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return "", err
	}
	safeSessionID := strings.NewReplacer("-", "", "{", "", "}", "", "\\", "", "/", "").Replace(sessionID)
	if safeSessionID == "" {
		safeSessionID = "session"
	}
	if len(safeSessionID) > 48 {
		safeSessionID = safeSessionID[:48]
	}
	return `\\.\pipe\setulink-desktop-` + safeSessionID + "-" + hex.EncodeToString(nonce[:]), nil
}

func createDesktopPipeServer(sessionID string) (*desktopPipeServer, error) {
	name, err := newDesktopPipeName(sessionID)
	if err != nil {
		return nil, err
	}
	listener, err := winio.ListenPipe(name, &winio.PipeConfig{
		SecurityDescriptor: desktopPipeSecurityDescriptor,
		MessageMode:        false,
		InputBufferSize:    4 * 1024 * 1024,
		OutputBufferSize:   4 * 1024 * 1024,
	})
	if err != nil {
		return nil, err
	}
	return &desktopPipeServer{name: name, listener: listener}, nil
}

func (server *desktopPipeServer) Close() error {
	if server == nil || server.listener == nil {
		return nil
	}
	return server.listener.Close()
}

func (server *desktopPipeServer) Accept(ctx context.Context) (desktopPipeConn, error) {
	if server == nil || server.listener == nil {
		return nil, fmt.Errorf("desktop pipe server is not initialized")
	}
	type acceptResult struct {
		conn net.Conn
		err  error
	}
	resultCh := make(chan acceptResult, 1)
	go func() {
		conn, err := server.listener.Accept()
		resultCh <- acceptResult{conn: conn, err: err}
	}()

	select {
	case <-ctx.Done():
		_ = server.Close()
		return nil, ctx.Err()
	case result := <-resultCh:
		if result.err != nil {
			return nil, result.err
		}
		return result.conn, nil
	}
}

func dialDesktopPipe(ctx context.Context, name string, timeout time.Duration) (desktopPipeConn, error) {
	deadline := time.Now().Add(timeout)
	for {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return nil, fmt.Errorf("timed out waiting for pipe %s", name)
		}
		conn, err := winio.DialPipe(name, &remaining)
		if err == nil {
			return conn, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func writeDesktopPipeMessage(conn desktopPipeConn, messageType byte, payload []byte) error {
	if conn == nil {
		return fmt.Errorf("desktop pipe is not connected")
	}
	if uint64(len(payload)) > uint64(^uint32(0)) {
		return fmt.Errorf("desktop pipe payload too large")
	}
	var header [5]byte
	header[0] = messageType
	binary.BigEndian.PutUint32(header[1:], uint32(len(payload)))
	if _, err := conn.Write(header[:]); err != nil {
		return err
	}
	if len(payload) == 0 {
		return nil
	}
	_, err := conn.Write(payload)
	return err
}

func readDesktopPipeMessage(conn desktopPipeConn) (byte, []byte, error) {
	var header [5]byte
	if _, err := io.ReadFull(conn, header[:]); err != nil {
		return 0, nil, err
	}
	length := binary.BigEndian.Uint32(header[1:])
	payload := make([]byte, int(length))
	if length > 0 {
		if _, err := io.ReadFull(conn, payload); err != nil {
			return 0, nil, err
		}
	}
	return header[0], payload, nil
}

func encodeDesktopPipeFramePayload(header desktopPipeFrameHeader, jpeg []byte) ([]byte, error) {
	headerBytes, err := json.Marshal(header)
	if err != nil {
		return nil, err
	}
	if uint64(len(headerBytes)) > uint64(^uint32(0)) {
		return nil, fmt.Errorf("desktop pipe frame header too large")
	}
	var out bytes.Buffer
	var headerLength [4]byte
	binary.BigEndian.PutUint32(headerLength[:], uint32(len(headerBytes)))
	out.Write(headerLength[:])
	out.Write(headerBytes)
	out.Write(jpeg)
	return out.Bytes(), nil
}

func decodeDesktopPipeFramePayload(payload []byte) (desktopPipeFrameHeader, []byte, error) {
	if len(payload) < 4 {
		return desktopPipeFrameHeader{}, nil, fmt.Errorf("desktop pipe frame payload too short")
	}
	headerLength := int(binary.BigEndian.Uint32(payload[:4]))
	headerStart := 4
	headerEnd := headerStart + headerLength
	if headerLength <= 0 || headerEnd > len(payload) {
		return desktopPipeFrameHeader{}, nil, fmt.Errorf("desktop pipe frame header length invalid")
	}
	var header desktopPipeFrameHeader
	if err := json.Unmarshal(payload[headerStart:headerEnd], &header); err != nil {
		return desktopPipeFrameHeader{}, nil, err
	}
	return header, payload[headerEnd:], nil
}
