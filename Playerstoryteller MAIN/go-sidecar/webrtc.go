package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v3"
)

// SignalMessage represents WebSocket signaling messages
type SignalMessage struct {
	Type      string                     `json:"type"`
	Role      string                     `json:"role,omitempty"`
	SessionID string                     `json:"sessionId,omitempty"`
	ClientID  string                     `json:"clientId,omitempty"`
	StreamKey string                     `json:"streamKey,omitempty"`
	Offer     *webrtc.SessionDescription `json:"offer,omitempty"`
	Answer    *webrtc.SessionDescription `json:"answer,omitempty"`
	Candidate *webrtc.ICECandidateInit   `json:"candidate,omitempty"`
	To        string                     `json:"to,omitempty"`
	From      string                     `json:"from,omitempty"`
}

// WebRTCManager handles WebRTC signaling and peer connections
type WebRTCManager struct {
	config      *Config
	logger      *Logger
	wsConn      *websocket.Conn
	wsMutex     sync.Mutex
	peerConn    *webrtc.PeerConnection
	dataChannel *webrtc.DataChannel
	dcMutex     sync.Mutex

	// Callbacks
	onDataChannelOpen  func()
	onDataChannelClose func()
}

// NewWebRTCManager creates a new WebRTC manager
func NewWebRTCManager(config *Config, logger *Logger) *WebRTCManager {
	return &WebRTCManager{
		config: config,
		logger: logger,
	}
}

// SetDataChannelOpenCallback sets the callback for when the data channel opens
func (w *WebRTCManager) SetDataChannelOpenCallback(callback func()) {
	w.onDataChannelOpen = callback
}

// SetDataChannelCloseCallback sets the callback for when the data channel closes
func (w *WebRTCManager) SetDataChannelCloseCallback(callback func()) {
	w.onDataChannelClose = callback
}

// Connect establishes WebSocket connection and handles signaling
func (w *WebRTCManager) Connect() {
	go func() {
		for {
			w.logger.Info("Connecting to signaling server: %s", w.config.ServerURL)

			conn, _, err := websocket.DefaultDialer.Dial(w.config.ServerURL, nil)
			if err != nil {
				w.logger.Error("WebSocket dial error: %v. Retrying in 2s...", err)
				time.Sleep(2 * time.Second)
				continue
			}

			w.wsMutex.Lock()
			w.wsConn = conn
			w.wsMutex.Unlock()

			// Register as streamer
			w.sendSignal(SignalMessage{
				Type:      "register",
				Role:      "streamer",
				SessionID: w.config.SessionID,
				StreamKey: w.config.StreamKey,
			})

			// Read loop
			for {
				_, message, err := conn.ReadMessage()
				if err != nil {
					w.logger.Error("WebSocket read error: %v. Reconnecting...", err)
					break
				}
				w.handleSignalMessage(message)
			}

			w.wsMutex.Lock()
			conn.Close()
			w.wsConn = nil
			w.wsMutex.Unlock()

			time.Sleep(1 * time.Second)
		}
	}()
}

// sendSignal sends a signaling message via WebSocket
func (w *WebRTCManager) sendSignal(msg SignalMessage) {
	w.wsMutex.Lock()
	defer w.wsMutex.Unlock()

	if w.wsConn == nil {
		w.logger.Error("Cannot send signal: WebSocket not connected")
		return
	}

	err := w.wsConn.WriteJSON(msg)
	if err != nil {
		w.logger.Error("WebSocket write error: %v", err)
	}
}

// handleSignalMessage processes incoming signaling messages
func (w *WebRTCManager) handleSignalMessage(data []byte) {
	var msg SignalMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		w.logger.Error("JSON unmarshal error: %v", err)
		return
	}

	switch msg.Type {
	case "registered":
		w.logger.Info("Registered with signaling server. Client ID: %s", msg.ClientID)

	case "offer":
		w.logger.Info("Received offer from %s", msg.From)
		w.handleOffer(msg)

	case "ice-candidate":
		if msg.Candidate != nil && w.peerConn != nil {
			if err := w.peerConn.AddICECandidate(*msg.Candidate); err != nil {
				w.logger.Error("Failed to add ICE candidate: %v", err)
			}
		}
	}
}

// handleOffer handles an incoming WebRTC offer
func (w *WebRTCManager) handleOffer(msg SignalMessage) {
	// Create peer connection
	config := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{URLs: []string{"stun:stun.l.google.com:19302"}},
		},
	}

	var err error
	w.peerConn, err = webrtc.NewPeerConnection(config)
	if err != nil {
		w.logger.Error("Failed to create peer connection: %v", err)
		return
	}

	// Handle ICE candidates
	w.peerConn.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		candidate := c.ToJSON()
		w.sendSignal(SignalMessage{
			Type:      "ice-candidate",
			Candidate: &candidate,
			To:        msg.From,
			SessionID: w.config.SessionID,
		})
	})

	// Monitor connection state
	w.peerConn.OnConnectionStateChange(func(s webrtc.PeerConnectionState) {
		w.logger.Info("Peer connection state: %s", s.String())
	})

	// Handle data channel
	w.peerConn.OnDataChannel(func(d *webrtc.DataChannel) {
		w.logger.Info("New data channel: %s (ID: %d)", d.Label(), d.ID())

		w.dcMutex.Lock()
		w.dataChannel = d
		w.dcMutex.Unlock()

		d.OnOpen(func() {
			w.logger.Info("Data channel opened")
			if w.onDataChannelOpen != nil {
				w.onDataChannelOpen()
			}
		})

		d.OnClose(func() {
			w.logger.Info("Data channel closed")
			if w.onDataChannelClose != nil {
				w.onDataChannelClose()
			}
		})
	})

	// Set remote description
	if err := w.peerConn.SetRemoteDescription(*msg.Offer); err != nil {
		w.logger.Error("Failed to set remote description: %v", err)
		return
	}

	// Create answer
	answer, err := w.peerConn.CreateAnswer(nil)
	if err != nil {
		w.logger.Error("Failed to create answer: %v", err)
		return
	}

	// Set local description
	if err := w.peerConn.SetLocalDescription(answer); err != nil {
		w.logger.Error("Failed to set local description: %v", err)
		return
	}

	// Send answer
	w.sendSignal(SignalMessage{
		Type:      "answer",
		Answer:    &answer,
		To:        msg.From,
		SessionID: w.config.SessionID,
	})
}

// SendData sends data via the data channel with backpressure check and automatic chunking
func (w *WebRTCManager) SendData(data []byte) error {
	w.dcMutex.Lock()
	defer w.dcMutex.Unlock()

	if w.dataChannel == nil {
		return fmt.Errorf("data channel not initialized")
	}

	if w.dataChannel.ReadyState() != webrtc.DataChannelStateOpen {
		return fmt.Errorf("data channel not open")
	}

	// Backpressure: check buffered amount
	if w.dataChannel.BufferedAmount() > MaxBufferedAmount {
		return fmt.Errorf("buffer full (%d bytes)", w.dataChannel.BufferedAmount())
	}

	// WebRTC has a 64KB message size limit - chunk large segments
	const maxChunkSize = 60000 // 60KB to be safe

	if len(data) <= maxChunkSize {
		// Small enough to send directly
		return w.dataChannel.Send(data)
	}

	// Chunk large segments
	for offset := 0; offset < len(data); offset += maxChunkSize {
		end := offset + maxChunkSize
		if end > len(data) {
			end = len(data)
		}
		chunk := data[offset:end]

		if err := w.dataChannel.Send(chunk); err != nil {
			return fmt.Errorf("failed to send chunk at offset %d: %v", offset, err)
		}
	}

	return nil
}

// IsReady returns true if the data channel is ready to send data
func (w *WebRTCManager) IsReady() bool {
	w.dcMutex.Lock()
	defer w.dcMutex.Unlock()

	return w.dataChannel != nil && w.dataChannel.ReadyState() == webrtc.DataChannelStateOpen
}
