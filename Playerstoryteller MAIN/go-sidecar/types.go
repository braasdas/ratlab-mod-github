package main

import (
	"log"
	"os"
)

// Configuration parsed from command-line arguments
type Config struct {
	SessionID   string
	StreamKey   string
	ParentPID   uint32
	CaptureMode string
	ServerURL   string
	Quality     string // "low", "medium", "high"
}

// StatusMessage sent to RimWorld mod via stdout
type StatusMessage struct {
	Type    string `json:"type"`    // "driver_warning", "info", "error"
	Message string `json:"message"` // Human-readable message
	Level   string `json:"level"`   // "info", "warning", "error"
}

// MP4SegmentType indicates the type of MP4 segment
type MP4SegmentType int

const (
	SegmentTypeInit  MP4SegmentType = iota // ftyp + moov (initialization segment)
	SegmentTypeMedia                       // moof + mdat (media fragment)
)

// MP4Segment represents a parsed MP4 segment
type MP4Segment struct {
	Type MP4SegmentType
	Data []byte
}

// Constants
const (
	ServerURL          = "ws://localhost:3000/stream"
	FFmpegPath         = "ffmpeg.exe"
	LogFileName        = "sidecar.log"
	TargetFPS          = 30
	MaxBufferedAmount  = 256 * 1024 // 256KB backpressure threshold
	STILL_ACTIVE       = 259        // Windows process exit code for running process
)

// Logger wraps log.Logger with consistent formatting
type Logger struct {
	logger *log.Logger
}

// NewLogger creates a new logger writing to the specified file
func NewLogger(filename string) (*Logger, error) {
	// Truncate (clear) the log file on startup for fresh logs
	logFile, err := os.OpenFile(filename, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return nil, err
	}

	return &Logger{
		logger: log.New(logFile, "", log.LstdFlags),
	}, nil
}

// Info logs an informational message
func (l *Logger) Info(format string, args ...interface{}) {
	l.logger.Printf("[INFO] "+format, args...)
}

// Error logs an error message
func (l *Logger) Error(format string, args ...interface{}) {
	l.logger.Printf("[ERROR] "+format, args...)
}

// Debug logs a debug message
func (l *Logger) Debug(format string, args ...interface{}) {
	l.logger.Printf("[DEBUG] "+format, args...)
}
