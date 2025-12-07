package main

import (
	"fmt"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// WebSocketManager manages WebSocket connection for streaming
type WebSocketManager struct {
	config            *Config
	logger            *Logger
	conn              *websocket.Conn
	connMutex         sync.Mutex
	onOpenCallback    func()
	onCloseCallback   func()
	reconnectInterval time.Duration
}

// NewWebSocketManager creates a new WebSocket manager
func NewWebSocketManager(config *Config, logger *Logger) *WebSocketManager {
	return &WebSocketManager{
		config:            config,
		logger:            logger,
		reconnectInterval: 2 * time.Second,
	}
}

// SetOpenCallback sets the callback for when connection opens
func (w *WebSocketManager) SetOpenCallback(callback func()) {
	w.onOpenCallback = callback
}

// SetCloseCallback sets the callback for when connection closes
func (w *WebSocketManager) SetCloseCallback(callback func()) {
	w.onCloseCallback = callback
}

// Connect establishes WebSocket connection with auto-reconnect
func (w *WebSocketManager) Connect() {
	go w.connectLoop()
}

// connectLoop maintains connection with auto-reconnect
func (w *WebSocketManager) connectLoop() {
	for {
		w.logger.Info("Connecting to streaming server: %s", w.config.ServerURL)

		// Build WebSocket URL with session ID and stream key
		wsURL := fmt.Sprintf("%s?session=%s&key=%s",
			w.config.ServerURL,
			w.config.SessionID,
			w.config.StreamKey)

		conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
		if err != nil {
			w.logger.Error("WebSocket dial error: %v. Retrying in %v...", err, w.reconnectInterval)
			time.Sleep(w.reconnectInterval)
			continue
		}

		w.connMutex.Lock()
		w.conn = conn
		w.connMutex.Unlock()

		w.logger.Info("WebSocket connected to streaming server")

		// Trigger open callback
		if w.onOpenCallback != nil {
			w.onOpenCallback()
		}

		// Monitor connection
		w.readLoop()

		// Connection closed - trigger callback
		if w.onCloseCallback != nil {
			w.onCloseCallback()
		}

		w.logger.Info("WebSocket disconnected. Reconnecting in %v...", w.reconnectInterval)
		time.Sleep(w.reconnectInterval)
	}
}

// readLoop reads messages from server (for control messages)
func (w *WebSocketManager) readLoop() {
	w.connMutex.Lock()
	conn := w.conn
	w.connMutex.Unlock()

	if conn == nil {
		return
	}

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			w.logger.Error("WebSocket read error: %v", err)
			w.connMutex.Lock()
			w.conn = nil
			w.connMutex.Unlock()
			return
		}

		// Handle control messages if needed
		w.logger.Debug("Received message from server: %s", string(message))
	}
}

// SendData sends binary data over WebSocket with automatic chunking
func (w *WebSocketManager) SendData(data []byte) error {
	w.connMutex.Lock()
	defer w.connMutex.Unlock()

	if w.conn == nil {
		return fmt.Errorf("websocket not connected")
	}

	// WebSocket doesn't have the same message size limits as WebRTC DataChannel
	// But we'll keep chunking for consistency and to avoid very large frames
	const maxChunkSize = 60000 // 60KB chunks

	if len(data) <= maxChunkSize {
		return w.conn.WriteMessage(websocket.BinaryMessage, data)
	}

	// Send large segments in chunks
	for offset := 0; offset < len(data); offset += maxChunkSize {
		end := offset + maxChunkSize
		if end > len(data) {
			end = len(data)
		}
		chunk := data[offset:end]

		if err := w.conn.WriteMessage(websocket.BinaryMessage, chunk); err != nil {
			return fmt.Errorf("failed to send chunk at offset %d: %v", offset, err)
		}
	}

	return nil
}

// IsReady returns true if WebSocket is connected
func (w *WebSocketManager) IsReady() bool {
	w.connMutex.Lock()
	defer w.connMutex.Unlock()
	return w.conn != nil
}

// Close closes the WebSocket connection
func (w *WebSocketManager) Close() {
	w.connMutex.Lock()
	defer w.connMutex.Unlock()

	if w.conn != nil {
		w.conn.Close()
		w.conn = nil
	}
}
