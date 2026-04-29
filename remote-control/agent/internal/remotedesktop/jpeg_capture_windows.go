//go:build windows

package remotedesktop

import (
	"bytes"
	"fmt"
	"image"
	"image/jpeg"
	"unsafe"

	xdraw "golang.org/x/image/draw"
	"golang.org/x/sys/windows"
)

const (
	srccopy      = 0x00CC0020
	captureblt   = 0x40000000
	dibRGBColors = 0
	biRGB        = 0
	maxJPEGWidth = 1920
	maxJPEGHeight = 1080
)

var (
	gdi32                  = windows.NewLazySystemDLL("gdi32.dll")
	procCreateCompatibleDC = gdi32.NewProc("CreateCompatibleDC")
	procDeleteDC           = gdi32.NewProc("DeleteDC")
	procCreateCompatibleBM = gdi32.NewProc("CreateCompatibleBitmap")
	procSelectObject       = gdi32.NewProc("SelectObject")
	procDeleteObject       = gdi32.NewProc("DeleteObject")
	procBitBlt             = gdi32.NewProc("BitBlt")
	procGetDIBits          = gdi32.NewProc("GetDIBits")
	procGetDC              = user32.NewProc("GetDC")
	procReleaseDC          = user32.NewProc("ReleaseDC")
)

type bitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

type bitmapInfo struct {
	Header bitmapInfoHeader
	Colors [1]uint32
}

func CaptureJPEG(opts CaptureOptions) (JPEGFrame, error) {
	width, _, _ := procGetSystemMetrics.Call(0)
	height, _, _ := procGetSystemMetrics.Call(1)
	if width == 0 || height == 0 {
		return JPEGFrame{}, fmt.Errorf("screen dimensions unavailable")
	}

	screenDC, _, err := procGetDC.Call(0)
	if screenDC == 0 {
		return JPEGFrame{}, fmt.Errorf("get screen dc: %w", err)
	}
	defer procReleaseDC.Call(0, screenDC)

	memDC, _, err := procCreateCompatibleDC.Call(screenDC)
	if memDC == 0 {
		return JPEGFrame{}, fmt.Errorf("create compatible dc: %w", err)
	}
	defer procDeleteDC.Call(memDC)

	bitmap, _, err := procCreateCompatibleBM.Call(screenDC, width, height)
	if bitmap == 0 {
		return JPEGFrame{}, fmt.Errorf("create compatible bitmap: %w", err)
	}
	defer procDeleteObject.Call(bitmap)

	previous, _, _ := procSelectObject.Call(memDC, bitmap)
	bitmapSelected := previous != 0

	ok, _, err := procBitBlt.Call(memDC, 0, 0, width, height, screenDC, 0, 0, srccopy|captureblt)
	if ok == 0 {
		return JPEGFrame{}, fmt.Errorf("bitblt screen: %w", windowsAPICallError(err))
	}

	if bitmapSelected {
		procSelectObject.Call(memDC, previous)
	}

	pixelCount := int(width * height)
	pixels := make([]byte, pixelCount*4)
	info := bitmapInfo{
		Header: bitmapInfoHeader{
			Size:        uint32(unsafe.Sizeof(bitmapInfoHeader{})),
			Width:       int32(width),
			Height:      -int32(height),
			Planes:      1,
			BitCount:    32,
			Compression: biRGB,
			SizeImage:   uint32(len(pixels)),
		},
	}

	rows, _, err := procGetDIBits.Call(
		memDC,
		bitmap,
		0,
		height,
		uintptr(unsafe.Pointer(&pixels[0])),
		uintptr(unsafe.Pointer(&info)),
		dibRGBColors,
	)
	if rows == 0 {
		return JPEGFrame{}, fmt.Errorf("get dibits: %w", windowsAPICallError(err))
	}

	img := image.NewRGBA(image.Rect(0, 0, int(width), int(height)))
	for i := 0; i < pixelCount; i++ {
		src := i * 4
		dst := i * 4
		img.Pix[dst] = pixels[src+2]
		img.Pix[dst+1] = pixels[src+1]
		img.Pix[dst+2] = pixels[src]
		img.Pix[dst+3] = 0xff
	}

	output := resizeForTarget(img, opts)
	var out bytes.Buffer
	if err := jpeg.Encode(&out, output, &jpeg.Options{Quality: 70}); err != nil {
		return JPEGFrame{}, err
	}

	bounds := output.Bounds()
	return JPEGFrame{
		Data:   out.Bytes(),
		Width:  bounds.Dx(),
		Height: bounds.Dy(),
	}, nil
}

func resizeForTarget(src *image.RGBA, opts CaptureOptions) image.Image {
	srcBounds := src.Bounds()
	srcWidth := srcBounds.Dx()
	srcHeight := srcBounds.Dy()
	if srcWidth <= 0 || srcHeight <= 0 {
		return src
	}

	targetWidth, targetHeight := fitCaptureSize(srcWidth, srcHeight, opts.TargetWidth, opts.TargetHeight)
	if targetWidth >= srcWidth && targetHeight >= srcHeight {
		return src
	}

	dst := image.NewRGBA(image.Rect(0, 0, targetWidth, targetHeight))
	xdraw.NearestNeighbor.Scale(dst, dst.Bounds(), src, srcBounds, xdraw.Over, nil)
	return dst
}

func fitCaptureSize(srcWidth, srcHeight, targetWidth, targetHeight int) (int, int) {
	if targetWidth <= 0 || targetHeight <= 0 {
		targetWidth = srcWidth
		targetHeight = srcHeight
	}
	if targetWidth > maxJPEGWidth || targetHeight > maxJPEGHeight {
		scale := minFloat(float64(maxJPEGWidth)/float64(targetWidth), float64(maxJPEGHeight)/float64(targetHeight))
		targetWidth = maxInt(1, int(float64(targetWidth)*scale))
		targetHeight = maxInt(1, int(float64(targetHeight)*scale))
	}

	scale := minFloat(float64(targetWidth)/float64(srcWidth), float64(targetHeight)/float64(srcHeight))
	if scale >= 1 {
		return srcWidth, srcHeight
	}
	return maxInt(1, int(float64(srcWidth)*scale)), maxInt(1, int(float64(srcHeight)*scale))
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func windowsAPICallError(err error) error {
	if err == nil || err == windows.ERROR_SUCCESS {
		return fmt.Errorf("api returned failure without extended error")
	}
	return err
}
