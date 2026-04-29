package remotedesktop

import "encoding/json"

type ControlMessage struct {
	Type             string  `json:"type"`
	SessionID        string  `json:"sessionId,omitempty"`
	X                int     `json:"x,omitempty"`
	Y                int     `json:"y,omitempty"`
	XRatio           float64 `json:"xRatio,omitempty"`
	YRatio           float64 `json:"yRatio,omitempty"`
	Button           int     `json:"button,omitempty"`
	Key              string  `json:"key,omitempty"`
	Code             string  `json:"code,omitempty"`
	Width            int     `json:"width,omitempty"`
	Height           int     `json:"height,omitempty"`
	ScaleMode        string  `json:"scaleMode,omitempty"`
	DevicePixelRatio float64 `json:"devicePixelRatio,omitempty"`
	Action           string  `json:"action,omitempty"`
	VkCode           uint16  `json:"vkCode,omitempty"`
	ScanCode         uint16  `json:"scanCode,omitempty"`
	Extended         bool    `json:"extended,omitempty"`
	Seq              uint64  `json:"seq,omitempty"`
	Ts               int64   `json:"ts,omitempty"`
	Payload          string  `json:"payload,omitempty"`
	ByteLen          int     `json:"byteLen,omitempty"`
}

func DecodeControlMessage(data []byte) (ControlMessage, error) {
	var message ControlMessage
	err := json.Unmarshal(data, &message)
	return message, err
}
