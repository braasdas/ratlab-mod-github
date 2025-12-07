package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// SidecarApp is the main application struct
type SidecarApp struct {
	config  *Config
	logger  *Logger
	monitor *ParentMonitor
	capture *WindowCapture
	ws      *WebSocketManager
	encoder *EncoderManager
	ctx     context.Context
	cancel  context.CancelFunc
}

func main() {
	// Parse command-line arguments
	config := parseArgs()

	// Setup logging
	exePath, _ := os.Executable()
	dir := filepath.Dir(exePath)
	logger, err := NewLogger(filepath.Join(dir, LogFileName))
	if err != nil {
		fmt.Fprintf(os.Stderr, "CRITICAL ERROR: Failed to open log file: %v\n", err)
		os.Exit(1)
	}

	logger.Info("=== Sidecar started (Clean Rewrite with MP4 Parser) ===")
	logger.Info("Session ID: %s", config.SessionID)
	logger.Info("Server URL: %s", config.ServerURL)
	logger.Info("Capture Mode: %s", config.CaptureMode)
	if config.ParentPID != 0 {
		logger.Info("Parent PID: %d", config.ParentPID)
	}
	if config.StreamKey != "" {
		logger.Info("Stream key: %s", maskStreamKey(config.StreamKey))
	}

	// Validate capture mode
	if config.CaptureMode != "window" {
		logger.Error("Invalid capture mode: %s. Only 'window' mode is supported.", config.CaptureMode)
		fmt.Fprintf(os.Stderr, "ERROR: Invalid capture mode. Only 'window' mode is supported.\n")
		os.Exit(1)
	}

	// Create context for cancellation
	ctx, cancel := context.WithCancel(context.Background())

	// Create app instance
	app := &SidecarApp{
		config: config,
		logger: logger,
		ctx:    ctx,
		cancel: cancel,
	}

	// Handle OS signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigChan
		logger.Info("Received shutdown signal")
		cancel()
		os.Exit(0)
	}()

	// Start parent process monitor
	if config.ParentPID != 0 {
		app.monitor = NewParentMonitor(config.ParentPID, logger, cancel)
		app.monitor.Start(ctx)
	} else {
		logger.Info("Parent PID not provided. Not monitoring parent process.")
	}

	// Initialize window capture
	app.capture = NewWindowCapture(config.ParentPID)
	logger.Info("Window capture initialized for PID %d", config.ParentPID)

	// Initialize encoder manager
	app.encoder = NewEncoderManager(config, logger, ctx)

	// Initialize WebSocket manager
	app.ws = NewWebSocketManager(config, logger)

	// Set up callbacks
	app.ws.SetOpenCallback(app.onConnectionOpen)
	app.ws.SetCloseCallback(app.onConnectionClose)

	// Connect to streaming server
	app.ws.Connect()

	logger.Info("Waiting for WebSocket connection...")

	// Wait for shutdown
	<-ctx.Done()
	logger.Info("Sidecar shutting down")
	app.encoder.Stop()
}

// onConnectionOpen is called when the WebSocket connection opens
func (app *SidecarApp) onConnectionOpen() {
	app.logger.Info("WebSocket connected - starting encoder pipeline")

	// Get window dimensions
	width, height, err := app.capture.GetDimensions()
	if err != nil {
		app.logger.Error("Failed to get window dimensions: %v", err)
		return
	}

	app.logger.Info("Window dimensions: %dx%d", width, height)

	// Start encoder
	if err := app.encoder.Start(width, height); err != nil {
		app.logger.Error("Failed to start encoder: %v", err)
		return
	}

	// Start window capture loop (feeds frames to FFmpeg)
	logFunc := func(msg string) {
		app.logger.Info(msg)
	}
	go app.capture.CaptureLoop(app.ctx, TargetFPS, app.encoder.WriteFrame, logFunc)
	app.logger.Info("Window capture started - feeding frames to FFmpeg")

	// Wait for init segment to be ready (FFmpeg will produce it after receiving frames)
	app.logger.Info("Waiting for initialization segment...")
	if err := app.encoder.WaitReady(app.ctx); err != nil {
		app.logger.Error("Encoder failed to become ready: %v", err)
		return
	}

	app.logger.Info("Initialization segment ready")

	// Set send function (this immediately sends the buffered init segment)
	if err := app.encoder.SetSendFunc(app.ws.SendData); err != nil {
		app.logger.Error("Failed to send init segment: %v", err)
		return
	}

	app.logger.Info("Streaming pipeline fully operational")
}

// onConnectionClose is called when the WebSocket connection closes
func (app *SidecarApp) onConnectionClose() {
	app.logger.Info("WebSocket closed - stopping encoder")
	app.encoder.Stop()
}

// parseArgs parses command-line arguments
func parseArgs() *Config {
	config := &Config{
		SessionID:   "current-session",
		CaptureMode: "window",
		ServerURL:   ServerURL,
		Quality:     "low",
	}

	// Parse arguments manually
	for i := 1; i < len(os.Args); i++ {
		arg := os.Args[i]

		if arg == "--stream-key" && i+1 < len(os.Args) {
			config.StreamKey = os.Args[i+1]
			i++
		} else if arg == "--parent-pid" && i+1 < len(os.Args) {
			if pid, err := strconv.ParseUint(os.Args[i+1], 10, 32); err == nil {
				config.ParentPID = uint32(pid)
			}
			i++
		} else if arg == "--capture-mode" && i+1 < len(os.Args) {
			config.CaptureMode = os.Args[i+1]
			i++
		} else if arg == "--server-url" && i+1 < len(os.Args) {
			config.ServerURL = os.Args[i+1]
			i++
		} else if arg == "--quality" && i+1 < len(os.Args) {
			config.Quality = os.Args[i+1]
			i++
		} else if !strings.HasPrefix(arg, "--") {
			// Positional argument: session ID
			config.SessionID = arg
		}
	}

	// Allow SERVER_URL override from environment
	if envURL := os.Getenv("SERVER_URL"); envURL != "" {
		config.ServerURL = envURL
	}

	return config
}

// maskStreamKey masks the stream key for logging
func maskStreamKey(key string) string {
	if len(key) <= 8 {
		return "****"
	}
	return key[:4] + "****" + key[len(key)-4:]
}
