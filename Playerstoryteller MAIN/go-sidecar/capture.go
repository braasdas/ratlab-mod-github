package main

import (
	"context"
	"fmt"
	"syscall"
	"time"
	"unsafe"
)

// Windows API declarations
var (
	user32               = syscall.NewLazyDLL("user32.dll")
	gdi32                = syscall.NewLazyDLL("gdi32.dll")
	procEnumWindows      = user32.NewProc("EnumWindows")
	procGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
	procGetWindowRect    = user32.NewProc("GetWindowRect")
	procGetDC            = user32.NewProc("GetDC")
	procReleaseDC        = user32.NewProc("ReleaseDC")
	procCreateCompatibleDC = gdi32.NewProc("CreateCompatibleDC")
	procCreateCompatibleBitmap = gdi32.NewProc("CreateCompatibleBitmap")
	procSelectObject     = gdi32.NewProc("SelectObject")
	procBitBlt           = gdi32.NewProc("BitBlt")
	procDeleteObject     = gdi32.NewProc("DeleteObject")
	procDeleteDC         = gdi32.NewProc("DeleteDC")
	procGetDIBits        = gdi32.NewProc("GetDIBits")
	procPrintWindow      = user32.NewProc("PrintWindow")
)

const (
	SRCCOPY              = 0x00CC0020
	PW_RENDERFULLCONTENT = 0x00000002
)

type RECT struct {
	Left   int32
	Top    int32
	Right  int32
	Bottom int32
}

type BITMAPINFOHEADER struct {
	BiSize          uint32
	BiWidth         int32
	BiHeight        int32
	BiPlanes        uint16
	BiBitCount      uint16
	BiCompression   uint32
	BiSizeImage     uint32
	BiXPelsPerMeter int32
	BiYPelsPerMeter int32
	BiClrUsed       uint32
	BiClrImportant  uint32
}

type BITMAPINFO struct {
	BmiHeader BITMAPINFOHEADER
	BmiColors [1]uint32
}

// WindowCapture manages capturing a specific window
type WindowCapture struct {
	hwnd       syscall.Handle
	targetPID  uint32
	
	// Cached GDI objects (Reused every frame)
	hdcScreen  syscall.Handle
	hdcMem     syscall.Handle
	hBitmap    syscall.Handle
	oldBitmap  syscall.Handle // To restore later
	width      int
	height     int
	pixels     []byte        // Reused buffer (raw from GDI, potentially padded)
	unpaddedPixels []byte    // Reused buffer (clean BGR24 for FFmpeg)
	bi         BITMAPINFO
}

// NewWindowCapture creates a new window capturer for the given process ID
func NewWindowCapture(pid uint32) *WindowCapture {
	return &WindowCapture{
		targetPID: pid,
	}
}

// Cleanup releases resources when you shut down
func (wc *WindowCapture) Cleanup() {
	if wc.oldBitmap != 0 {
		procSelectObject.Call(uintptr(wc.hdcMem), uintptr(wc.oldBitmap))
	}
	if wc.hBitmap != 0 {
		procDeleteObject.Call(uintptr(wc.hBitmap))
	}
	if wc.hdcMem != 0 {
		procDeleteDC.Call(uintptr(wc.hdcMem))
	}
	if wc.hdcScreen != 0 {
		procReleaseDC.Call(0, uintptr(wc.hdcScreen))
	}
	wc.hBitmap = 0
	wc.hdcMem = 0
	wc.hdcScreen = 0
	wc.oldBitmap = 0
}

// Prepare initializes the GDI objects (Call this once, or on resize)
func (wc *WindowCapture) Prepare(width, height int) error {
	// 1. Cleanup old objects if they exist (handling resize)
	wc.Cleanup()

	wc.width = width
	wc.height = height

	// 2. Get Screen DC
	hdcScreen, _, _ := procGetDC.Call(0)
	if hdcScreen == 0 {
		return fmt.Errorf("failed to get screen DC")
	}
	wc.hdcScreen = syscall.Handle(hdcScreen)

	// 3. Create Memory DC (The "Canvas")
	hdcMem, _, _ := procCreateCompatibleDC.Call(uintptr(wc.hdcScreen))
	if hdcMem == 0 {
		return fmt.Errorf("failed to create compatible DC")
	}
	wc.hdcMem = syscall.Handle(hdcMem)

	// 4. Create Bitmap (The "Paper")
	hBitmap, _, _ := procCreateCompatibleBitmap.Call(uintptr(wc.hdcScreen), uintptr(width), uintptr(height))
	if hBitmap == 0 {
		return fmt.Errorf("failed to create compatible bitmap")
	}
	wc.hBitmap = syscall.Handle(hBitmap)

	// 5. Select Bitmap into DC
	oldBitmap, _, _ := procSelectObject.Call(uintptr(wc.hdcMem), uintptr(wc.hBitmap))
	wc.oldBitmap = syscall.Handle(oldBitmap)

	// 6. Setup Header Info
	wc.bi = BITMAPINFO{}
	wc.bi.BmiHeader.BiSize = uint32(unsafe.Sizeof(wc.bi.BmiHeader))
	wc.bi.BmiHeader.BiWidth = int32(width)
	wc.bi.BmiHeader.BiHeight = -int32(height) // Top-down
	wc.bi.BmiHeader.BiPlanes = 1
	wc.bi.BmiHeader.BiBitCount = 24
	wc.bi.BmiHeader.BiCompression = 0

	// 7. Pre-allocate buffers
	stride := ((width*3 + 3) / 4) * 4
	wc.pixels = make([]byte, stride*height)
	
	rowSize := width * 3
	if stride != rowSize {
		wc.unpaddedPixels = make([]byte, rowSize*height)
	} else {
		wc.unpaddedPixels = nil // Not needed if no padding
	}

	return nil
}

// findWindowByPID finds a window handle for the given process ID
func (wc *WindowCapture) findWindow() error {
	var foundHwnd syscall.Handle

	callback := syscall.NewCallback(func(hwnd syscall.Handle, lParam uintptr) uintptr {
		var pid uint32
		procGetWindowThreadProcessId.Call(
			uintptr(hwnd),
			uintptr(unsafe.Pointer(&pid)),
		)

		if pid == wc.targetPID {
			foundHwnd = hwnd
			return 0 // Stop enumeration
		}
		return 1 // Continue
	})

	procEnumWindows.Call(callback, 0)

	if foundHwnd == 0 {
		return fmt.Errorf("window not found for PID %d", wc.targetPID)
	}

	wc.hwnd = foundHwnd
	return nil
}

// CaptureWindow now just does the drawing (Fast!)
func (wc *WindowCapture) CaptureWindow(quality int) ([]byte, int, int, error) {
	if wc.hwnd == 0 {
		if err := wc.findWindow(); err != nil {
			return nil, 0, 0, err
		}
	}

	// Get dimensions
	var rect RECT
	procGetWindowRect.Call(uintptr(wc.hwnd), uintptr(unsafe.Pointer(&rect)))
	width := int(rect.Right - rect.Left)
	height := int(rect.Bottom - rect.Top)

	if width <= 0 || height <= 0 {
		return nil, 0, 0, fmt.Errorf("invalid window dimensions: %dx%d", width, height)
	}

	// Re-initialize if size changed or first run
	if width != wc.width || height != wc.height {
		if err := wc.Prepare(width, height); err != nil {
			return nil, 0, 0, err
		}
	}

	// --- CRITICAL PERFORMANCE SECTION ---
	
	// 1. Ask Windows to render the specific window to our hidden memory DC
	// PW_RENDERFULLCONTENT = 0x00000002 (Captures even if covered!)
	ret, _, _ := procPrintWindow.Call(
		uintptr(wc.hwnd),
		uintptr(wc.hdcMem),
		PW_RENDERFULLCONTENT, 
	)
	if ret == 0 {
		// Fallback
		ret, _, _ = procPrintWindow.Call(
			uintptr(wc.hwnd),
			uintptr(wc.hdcMem),
			0, 
		)
		if ret == 0 {
			return nil, 0, 0, fmt.Errorf("PrintWindow failed")
		}
	}

	// 2. Extract raw bits from our memory DC to our Go buffer
	ret, _, _ = procGetDIBits.Call(
		uintptr(wc.hdcMem),
		uintptr(wc.hBitmap),
		0,
		uintptr(height),
		uintptr(unsafe.Pointer(&wc.pixels[0])),
		uintptr(unsafe.Pointer(&wc.bi)),
		0,
	)

	if ret == 0 {
		return nil, 0, 0, fmt.Errorf("GetDIBits failed")
	}

	// 3. Remove Padding (if necessary)
	stride := ((width*3 + 3) / 4) * 4
	rowSize := width * 3

	if stride == rowSize {
		return wc.pixels, width, height, nil
	}
	
	// Use cached buffer
	if len(wc.unpaddedPixels) != rowSize * height {
		// Fallback safety if size mismatch (shouldn't happen due to Prepare)
		wc.unpaddedPixels = make([]byte, rowSize*height)
	}

	// Copy each row, removing padding
	// This is CPU bound but necessary since FFmpeg rawvideo doesn't support stride via args easily
	for y := 0; y < height; y++ {
		srcOffset := y * stride
		dstOffset := y * rowSize
		copy(wc.unpaddedPixels[dstOffset:dstOffset+rowSize], wc.pixels[srcOffset:srcOffset+rowSize])
	}

	return wc.unpaddedPixels, width, height, nil 
}

// GetDimensions returns the last captured window dimensions
func (wc *WindowCapture) GetDimensions() (width, height int, err error) {
	// Try to capture once to get dimensions
	_, w, h, err := wc.CaptureWindow(0)
	return w, h, err
}

// CaptureLoop continuously captures the window at the given FPS
func (wc *WindowCapture) CaptureLoop(ctx context.Context, fps int, writeFrame func([]byte, int, int) error, logger func(string)) {
	interval := time.Second / time.Duration(fps)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	frameCount := 0
	lastLog := time.Now()

	// Ensure cleanup on exit
	defer wc.Cleanup()

	for {
		select {
		case <-ctx.Done():
			if logger != nil {
				logger("Capture loop stopped")
			}
			return
		case <-ticker.C:
			frame, width, height, err := wc.CaptureWindow(0)
			if err != nil {
				// Log error every 5 seconds to avoid spam
				if time.Since(lastLog) > 5*time.Second {
					if logger != nil {
						logger(fmt.Sprintf("Capture error: %v", err))
					}
					lastLog = time.Now()
				}
				continue
			}

			// Write frame directly to encoder with dimensions
			if writeFrame != nil {
				err := writeFrame(frame, width, height)
				if err == nil {
					frameCount++
					if frameCount%30 == 0 {
						if logger != nil {
							logger(fmt.Sprintf("Captured %d frames (%d KB)", frameCount, len(frame)/1024))
						}
					}
				}
				// Silently drop if writeFrame fails (backpressure)
			}
		}
	}
}