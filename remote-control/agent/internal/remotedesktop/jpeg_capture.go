package remotedesktop

type JPEGFrame struct {
	Data   []byte
	Width  int
	Height int
}

type CaptureOptions struct {
	TargetWidth  int
	TargetHeight int
	ScaleMode    string
}
