package diagnostics

import (
	"encoding/json"
	"time"
)

var timeNow = func() time.Time {
	return time.Now().UTC()
}

func BuildSnapshot(input RuntimeInput) Snapshot {
	return Collect(input)
}

func MarshalSnapshot(snapshot Snapshot) ([]byte, error) {
	return json.Marshal(snapshot)
}
