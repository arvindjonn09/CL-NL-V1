package remotedesktop

import "encoding/json"

type ControlMessage struct {
	Type   string  `json:"type"`
	X      int     `json:"x,omitempty"`
	Y      int     `json:"y,omitempty"`
	XRatio float64 `json:"xRatio,omitempty"`
	YRatio float64 `json:"yRatio,omitempty"`
	Button int     `json:"button,omitempty"`
	Key    string  `json:"key,omitempty"`
	Code   string  `json:"code,omitempty"`
}

func DecodeControlMessage(data []byte) (ControlMessage, error) {
	var message ControlMessage
	err := json.Unmarshal(data, &message)
	return message, err
}
