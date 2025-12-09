// Socket.IO connection
const socket = io();

// Stream State
let streamWebSocket = null;
let streamConnected = false;
let useWebSocket = false; // Toggle for WebSocket vs Socket.IO screenshots
let useHLS = false; // Toggle for HLS (Bunny CDN)
let hls = null; // Hls.js instance

// BUNNY CDN CONFIGURATION
// Use your Pull Zone URL here
const BUNNY_PULL_ZONE = "https://cdn.ratlab.online"; 

// Media Source Extensions (MSE) State
let mediaSource = null;
let sourceBuffer = null;
let h264Queue = [];
let initSegmentReceived = false;
let stickyBuffer = new Uint8Array(0); // Reassembly buffer for MP4 atoms
let cachedInitSegment = null; // Stores ftyp + moov for restarts

// State management
let currentSession = null;
let sessions = [];
let sessionRequiresPassword = false;
let sessionPassword = null;
let username = localStorage.getItem('username');
let actionCosts = {}; // Store action costs
let queueTimerInterval = null; // Moved here to prevent ReferenceError

// Check for direct session link in URL
const urlParams = new URLSearchParams(window.location.search);
const directSessionId = urlParams.get('session');

// DOM Elements
const sessionSelection = document.getElementById('session-selection');
const gameViewer = document.getElementById('game-viewer');
const sessionsList = document.getElementById('sessions-list');
const gameScreenshot = document.getElementById('game-screenshot');
const colonistsList = document.getElementById('colonists-list');
const connectionStatus = document.getElementById('connection-status');
const backButton = document.getElementById('back-button');
const currentSessionName = document.getElementById('current-session-name');
const colonistCount = document.getElementById('colonist-count');
const wealthDisplay = document.getElementById('wealth');
const viewerCount = document.getElementById('viewer-count');
const coinBalance = document.getElementById('coin-balance');
const lastUpdate = document.getElementById('last-update');
const loadingScreen = document.getElementById('loading-screen');
const loadingText = document.getElementById('loading-text');

function showLoading(message = "INITIALIZING...") {
    if (loadingText) loadingText.textContent = message;
    if (loadingScreen) loadingScreen.classList.add('active');
    if (loadingScreen) loadingScreen.classList.remove('hidden');
}

function hideLoading() {
    if (loadingScreen) {
        loadingScreen.classList.remove('active');
        loadingScreen.classList.add('hidden');
    }
}

const powerStats = document.getElementById('power-stats');
const creatureStats = document.getElementById('creature-stats');
const researchStats = document.getElementById('research-stats');
// const factionStats = document.getElementById('faction-stats'); // Not used in previous code?
const factionRelationsFull = document.getElementById('faction-relations-full');
const medicalAlertsList = document.getElementById('medical-alerts-list');
const inventoryContainer = document.getElementById('inventory-container');
const storedResourcesContainer = document.getElementById('stored-resources-container');
const modsList = document.getElementById('mods-list');

// Tab System Logic
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

function switchTab(tabId) {
    // Update buttons
    tabButtons.forEach(btn => {
        if (btn.dataset.tab === tabId) {
            btn.classList.add('active');
            btn.classList.add('bg-rat-dark');
            btn.classList.add('border-rat-border');
            btn.classList.remove('border-transparent');
            btn.classList.add('text-rat-green');
            btn.classList.remove('text-rat-text-dim');
        } else {
            btn.classList.remove('active');
            btn.classList.remove('bg-rat-dark');
            btn.classList.remove('border-rat-border');
            btn.classList.add('border-transparent');
            btn.classList.remove('text-rat-green');
            btn.classList.add('text-rat-text-dim');
        }
    });

    // Update panes
    tabPanes.forEach(pane => {
        if (pane.id === `tab-${tabId}`) {
            pane.classList.add('active');
        } else {
            pane.classList.remove('active');
        }
    });

    // Save to storage
    localStorage.setItem('activeTab', tabId);
}

// Initialize tabs
tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
    });
});

// Load saved tab
const savedTab = localStorage.getItem('activeTab');
if (savedTab && savedTab !== 'queue') { // Prevent defaulting to queue
    const targetPane = document.getElementById(`tab-${savedTab}`);
    if (targetPane) {
        switchTab(savedTab);
    } else {
        switchTab('stream');
    }
} else {
    switchTab('stream'); // Default
}

// Frame controls
const frameEnabled = document.getElementById('frame-enabled');
const frameWidth = document.getElementById('frame-width');
const frameHeight = document.getElementById('frame-height');
const resetFrameBtn = document.getElementById('reset-frame');
const screenshotFrame = document.getElementById('screenshot-frame');

// Socket event handlers
socket.on('connect', () => {
    console.log('Connected to server');
    updateConnectionStatus(true);
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    updateConnectionStatus(false);
});

socket.on('sessions-list', (data) => {
    sessions = data.sessions;
    renderSessionsList();

    // If we have a direct session link, try to join it automatically
    if (directSessionId && !currentSession) {
        // Check if session is in the public list
        const existingSession = sessions.find(s => s.sessionId === directSessionId);
        if (existingSession) {
            selectSession(directSessionId);
        } else {
            // Try to fetch it as a private session
            fetch(`/api/session/${encodeURIComponent(directSessionId)}`)
                .then(response => {
                    if (response.ok) {
                        return response.json();
                    }
                    throw new Error('Session not found');
                })
                .then(data => {
                    if (data.session) {
                        // Add to sessions list and select it
                        // Check if it already exists to avoid duplicates
                        if (!sessions.find(s => s.sessionId === data.session.sessionId)) {
                            sessions.push(data.session);
                        }
                        selectSession(directSessionId);
                    } else {
                        throw new Error('Invalid session data');
                    }
                })
                .catch(error => {
                    console.error('Error loading private session:', error);
                    alert(`Could not find session: ${directSessionId}\n\nThe session may have ended, is not currently active, or the link is invalid.`);
                    // Clear the invalid session from URL so refresh works
                    const url = new URL(window.location);
                    url.searchParams.delete('session');
                    window.history.replaceState({}, '', url);
                });
        }
    }
});

socket.on('screenshot-update', (data) => {
    // Only process Socket.IO screenshots if WebRTC is NOT connected
    if (!useWebSocket && currentSession && data.sessionId === currentSession) {
        const streamDisabledOverlay = document.getElementById('stream-disabled');
        
        // Handle Binary Buffer (New Optimization) or Base64 String (Legacy Fallback)
        if (data.screenshot) {
            gameScreenshot.style.display = 'block';
            
            if (gameScreenshot.src.startsWith('blob:')) {
                URL.revokeObjectURL(gameScreenshot.src);
            }

            if (typeof data.screenshot === 'string') {
                 // Fallback for Base64
                 gameScreenshot.src = `data:image/jpeg;base64,${data.screenshot}`;
            } else {
                // New Binary Flow
                const blob = new Blob([data.screenshot], { type: 'image/jpeg' });
                gameScreenshot.src = URL.createObjectURL(blob);
            }

            if (streamDisabledOverlay) streamDisabledOverlay.classList.remove('flex');
            if (streamDisabledOverlay) streamDisabledOverlay.classList.add('hidden');
        } else {
            gameScreenshot.style.display = 'none';
            if (streamDisabledOverlay) streamDisabledOverlay.classList.remove('hidden');
            if (streamDisabledOverlay) streamDisabledOverlay.classList.add('flex');
        }

        const now = new Date(data.timestamp);
        lastUpdate.textContent = `LAST UPDATE: ${now.toLocaleTimeString()}`;
    }
});

socket.on('gamestate-update', (data) => {
    if (currentSession && data.sessionId === currentSession) {
        updateGameState(data.gameState);
    }
});

socket.on('coin-update', (data) => {
    if (data.username === username) {
        if (coinBalance) {
            coinBalance.textContent = `💰 ${data.coins.toLocaleString()} CREDITS`;
            coinBalance.classList.remove('hidden');
        }
    }
});

socket.on('economy-config-update', (data) => {
    if (data.actionCosts) {
        actionCosts = data.actionCosts;
        updateActionButtonsCosts();
    }
});

// MAP UPDATE LISTENER
socket.on('map-image-update', (data) => {
    if (currentSession && data.sessionId === currentSession && data.image) {
        const mapImg = document.getElementById('tactical-map-image');
        const mapLoading = document.getElementById('map-loading');
        
        if (mapImg) {
            if (mapImg.src.startsWith('blob:')) {
                URL.revokeObjectURL(mapImg.src);
            }
            
            // Create Blob from buffer
            const blob = new Blob([data.image], { type: 'image/jpeg' });
            mapImg.src = URL.createObjectURL(blob);
            
            if (mapLoading) mapLoading.classList.add('hidden');
        }
    }
});

// VIEW MODE SWITCHER
document.querySelectorAll('.view-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        
        // Update Buttons
        document.querySelectorAll('.view-mode-btn').forEach(b => {
            if (b.dataset.mode === mode) {
                b.classList.add('active', 'text-rat-green', 'bg-rat-dark');
                b.classList.remove('hover:text-white');
            } else {
                b.classList.remove('active', 'text-rat-green', 'bg-rat-dark');
                b.classList.add('hover:text-white');
            }
        });

        // Update View Layers
        const viewCamera = document.getElementById('view-camera');
        const viewMap = document.getElementById('view-map');
        const mapControls = document.getElementById('map-controls');

        if (mode === 'camera') {
            viewCamera.classList.remove('hidden');
            viewMap.classList.add('hidden');
            if (mapControls) mapControls.classList.add('hidden');
        } else {
            viewCamera.classList.add('hidden');
            viewMap.classList.remove('hidden');
            if (mapControls) mapControls.classList.remove('hidden');
        }
    });
});

// MAP INTERACTION LOGIC
const mapContent = document.getElementById('map-content');
// Legacy map logic removed to prevent conflict with new implementation (mapState)

// HLS Implementation (Bunny CDN)
let hlsRetryCount = 0;
const MAX_HLS_RETRIES = 5;

function initializeHLS() {
    console.log('[HLS] Initializing HLS connection via Bunny CDN...');
    showLoading("BUFFERING SATELLITE FEED...");
    
    const video = document.getElementById('game-screenshot');
    const streamKey = "74a978f8-5c3b-4da2-b20bc523cbae-322c-4464"; // Ideally this comes from session metadata
    const hlsUrl = `${BUNNY_PULL_ZONE}/${streamKey}/playlist.m3u8`;

    // Idempotency check
    if (hls && hls.media === video) {
        console.log('[HLS] Already attached, skipping init.');
        hideLoading(); // Hide if already ready
        return;
    }

    if (Hls.isSupported()) {
        if (hls) {
            hls.destroy();
        }

        hls = new Hls({
            debug: false,
            enableWorker: true,
            lowLatencyMode: false, // Disable LL-HLS for better stability
            backBufferLength: 60,  // Keep 60s of history
            maxBufferLength: 60,   // Buffer up to 60s ahead
            maxMaxBufferLength: 120,
            manifestLoadingTimeOut: 10000,
            manifestLoadingMaxRetry: 10,
            levelLoadingTimeOut: 10000,
            levelLoadingMaxRetry: 4,
            fragLoadingTimeOut: 20000,
            fragLoadingMaxRetry: 6,
        });

        hls.loadSource(hlsUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
            console.log('[HLS] Media attached');
            video.muted = true;
            video.play().catch(e => console.log('[HLS] Autoplay blocked', e));
            hlsRetryCount = 0;
        });

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            console.log('[HLS] Manifest parsed, starting playback');
            useHLS = true;
            useWebSocket = false;
            hlsRetryCount = 0;
            
            hideLoading();
            showFeedback('success', 'CDN Stream Connected (High Capacity)');
            
            // Update UI to show HLS mode
            const statusText = document.querySelector('#connection-status .status-text');
            if (statusText) statusText.textContent = 'CDN LINK ESTABLISHED';
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        const retryMsg = `SEARCHING FOR SIGNAL (${hlsRetryCount + 1}/${MAX_HLS_RETRIES})...`;
                        console.log(`[HLS] ${retryMsg}`);
                        showLoading(retryMsg);
                        
                        if (hlsRetryCount < MAX_HLS_RETRIES) {
                            hlsRetryCount++;
                            // Exponential backoff
                            const delay = Math.pow(2, hlsRetryCount) * 1000;
                            setTimeout(() => {
                                console.log(`[HLS] Retrying loadSource after ${delay}ms`);
                                // If manifest load failed, we might need to reload source
                                if (data.details === 'manifestLoadError') {
                                     hls.loadSource(hlsUrl);
                                } else {
                                     hls.startLoad();
                                }
                            }, delay);
                        } else {
                             console.error('[HLS] Max retries reached. Resetting HLS entirely in 5s.');
                             hls.destroy();
                             hideLoading(); // Stop infinite loading screen
                             showFeedback('error', 'Stream Offline. Retrying in 5s...');
                             
                             setTimeout(() => {
                                 hlsRetryCount = 0;
                                 initializeHLS();
                             }, 5000);
                        }
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        console.log('[HLS] Media error, trying to recover...');
                        hls.recoverMediaError();
                        break;
                    default:
                        console.error('[HLS] Fatal error, cannot recover');
                        hls.destroy();
                        hideLoading();
                        showFeedback('error', 'Stream Fatal Error');
                        break;
                }
            }
        });
        
        hls.on(Hls.Events.DESTROYING, () => {
             console.log('[HLS] Instance destroyed');
        });

    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS (Safari)
        video.src = hlsUrl;
        video.addEventListener('loadedmetadata', () => {
            video.play();
            useHLS = true;
            useWebSocket = false;
        });
        
        // Basic Native Error Recovery
        video.addEventListener('error', (e) => {
             console.error('[HLS Native] Video error:', video.error);
             // Simple retry after 3s
             setTimeout(() => {
                 video.src = hlsUrl;
                 video.play();
             }, 3000);
        });
    } else {
        console.error('[HLS] HLS not supported in this browser');
        showFeedback('error', 'HLS Not Supported');
    }
}

// WebRTC Functions
async function initializeWebSocket() {
    console.log('[WebSocket] Initializing WebSocket stream connection...');
    showLoading("CONNECTING TO STREAM...");

    if (streamWebSocket && (streamWebSocket.readyState === WebSocket.OPEN || streamWebSocket.readyState === WebSocket.CONNECTING)) {
        console.log('[WebSocket] Already connected.');
        return;
    }

    if (streamWebSocket) {
        streamWebSocket.close();
    }

    // Connect to the same host but with ws/wss protocol and /stream path
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const streamUrl = `${protocol}//${window.location.host}/stream?session=${currentSession}`;

    console.log(`[WebSocket] Connecting to: ${streamUrl}`);
    streamWebSocket = new WebSocket(streamUrl);
    streamWebSocket.binaryType = 'arraybuffer';

    streamWebSocket.onopen = () => {
        console.log('[WebSocket] Stream connected');
        streamConnected = true;
        useWebSocket = true;
        hideLoading();
        showFeedback('success', 'Live Stream Connected');

        // Initialize MSE for video playback
        initializeMediaSource();
    };

    streamWebSocket.onmessage = (event) => {
        console.log(`[WebSocket] RX Chunk: ${event.data.byteLength} bytes`);
        handleH264Data(event.data);
    };

    streamWebSocket.onerror = (error) => {
        console.error('[WebSocket] Connection error:', error);
    };

    streamWebSocket.onclose = (event) => {
        console.log(`[WebSocket] Connection closed (Code: ${event.code})`);
        streamConnected = false;
        useWebSocket = false;
        cleanupMediaSource(true);

        // Auto-reconnect
        if (currentSession && !useHLS) {
            setTimeout(() => {
                console.log('[WebSocket] Attempting to reconnect...');
                initializeWebSocket();
            }, 2000);
        }
    };
}

async function handleSFUOffer(offer) {
    if (webrtcPeerConnection) {
        webrtcPeerConnection.close();
    }

    webrtcPeerConnection = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    });

    // Handle ICE candidates -> Send back to SFU
    webrtcPeerConnection.onicecandidate = (event) => {
        if (event.candidate && videoSignalSocket.readyState === WebSocket.OPEN) {
            videoSignalSocket.send(JSON.stringify({
                type: 'ice-candidate',
                candidate: event.candidate,
                sessionId: currentSession
            }));
        }
    };

    // Connection State
    webrtcPeerConnection.onconnectionstatechange = () => {
        console.log('[WebRTC] Connection State:', webrtcPeerConnection.connectionState);
        if (webrtcPeerConnection.connectionState === 'connected') {
            webrtcConnected = true;
            useWebSocket = true;
            hideLoading();
            showFeedback('success', 'Live Stream Connected');
        } else if (['failed', 'disconnected', 'closed'].includes(webrtcPeerConnection.connectionState)) {
            webrtcConnected = false;
            useWebSocket = false;
            cleanupMediaSource(true);
        }
    };

    // Handle Data Channel (Video Stream)
    webrtcPeerConnection.ondatachannel = (event) => {
        console.log(`[WebRTC] Data Channel Received: ${event.channel.label}`);
        webrtcDataChannel = event.channel;
        webrtcDataChannel.binaryType = 'arraybuffer';

        webrtcDataChannel.onopen = () => {
            console.log('[WebRTC] Data Channel Open -> Init MSE');
            initializeMediaSource();
        };

        // FIX: Add data reception tracking for health monitoring
        let lastDataReceived = Date.now();

        webrtcDataChannel.onmessage = (e) => {
            console.log(`[WebRTC] RX Chunk: ${e.data.byteLength} bytes`);
            lastDataReceived = Date.now();
            handleH264Data(e.data);
        };

        // FIX: Monitor data channel health
        const healthCheckInterval = setInterval(() => {
            if (!webrtcDataChannel || webrtcDataChannel.readyState !== 'open') {
                clearInterval(healthCheckInterval);
                return;
            }

            const timeSinceData = Date.now() - lastDataReceived;
            if (timeSinceData > 10000) { // No data for 10 seconds
                console.error('[WebRTC] No data received for 10s - connection stalled, reconnecting...');
                clearInterval(healthCheckInterval);

                // Trigger reconnection
                showFeedback('warning', 'Stream stalled, reconnecting...');

                // Close the current connection
                if (webrtcPeerConnection) {
                    webrtcPeerConnection.close();
                }
                if (webrtcDataChannel) {
                    webrtcDataChannel.close();
                }
                if (videoSignalSocket) {
                    videoSignalSocket.close();
                }

                // Clean up media source
                cleanupMediaSource(true);

                // Wait a moment then reconnect
                setTimeout(() => {
                    console.log('[WebRTC] Attempting to reconnect...');
                    webrtcConnected = false;
                    webrtcPeerConnection = null;
                    webrtcDataChannel = null;
                    initializeWebRTC();
                }, 1000);
            }
        }, 5000);

        webrtcDataChannel.onclose = () => {
            console.log('[WebRTC] Data Channel Closed');
            clearInterval(healthCheckInterval);
        };
    };

    // Accept Offer & Send Answer
    await webrtcPeerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await webrtcPeerConnection.createAnswer();
    await webrtcPeerConnection.setLocalDescription(answer);

    if (videoSignalSocket.readyState === WebSocket.OPEN) {
        console.log('[WebRTC] Sending Answer to SFU');
        videoSignalSocket.send(JSON.stringify({
            type: 'answer',
            answer: answer,
            sessionId: currentSession
        }));
    }
}

// ============================================================================
// MEDIA SOURCE EXTENSIONS (MSE) IMPLEMENTATION
// ============================================================================

function initializeMediaSource() {
    // Baseline Profile Level 3.0 (Most compatible)
    const mimeCodec = 'video/mp4; codecs="avc1.42E01E"'; 
    
    if (!window.MediaSource || !MediaSource.isTypeSupported(mimeCodec)) {
        console.error(`[MSE] MimeType ${mimeCodec} not supported`);
        showFeedback('error', 'Video streaming not supported');
        useWebSocket = false;
        return;
    }
    
    console.log('[MSE] Initializing Media Source Extensions...');
    
    if (mediaSource) {
        try {
            if (mediaSource.readyState === 'open') mediaSource.endOfStream();
        } catch(e) {}
        mediaSource = null;
    }

    mediaSource = new MediaSource();
    const video = document.getElementById('game-screenshot');

    // FIX: Ensure video element is properly reset before attaching new source
    if (video.src && video.src.startsWith('blob:')) {
        URL.revokeObjectURL(video.src);
    }
    video.src = URL.createObjectURL(mediaSource);
    video.style.display = 'block';

    // FIX: Force video element to be visible and ready
    video.controls = false;
    video.autoplay = true;
    video.muted = true; // Required for autoplay in most browsers
    video.playsInline = true; // Required for iOS

    // Hide the "Stream Disabled" overlay if it's showing
    const streamDisabledOverlay = document.getElementById('stream-disabled');
    if (streamDisabledOverlay) {
        streamDisabledOverlay.classList.remove('flex');
        streamDisabledOverlay.classList.add('hidden');
    }

    // Don't call play() here - wait for sourceopen event
    
    mediaSource.addEventListener('sourceopen', () => {
        console.log(`[MSE] Media Source opened (readyState: ${mediaSource.readyState})`);
        
        try {
            if (sourceBuffer) return; // Already created

            sourceBuffer = mediaSource.addSourceBuffer(mimeCodec);
            sourceBuffer.mode = 'segments'; // Segments mode: Use internal MP4 timestamps (tfdt)
            console.log('[MSE] SourceBuffer created (mode=segments)');
            
            sourceBuffer.addEventListener('updateend', () => {
                try {
                    // Only access buffered property if SourceBuffer is valid
                    if (sourceBuffer && !sourceBuffer.updating && mediaSource.readyState === 'open') {
                        const buffered = sourceBuffer.buffered;
                        const video = document.getElementById('game-screenshot');

                        // FIX: Automatically start playback when we have enough buffer
                        if (buffered.length > 0 && video.paused && video.readyState >= 2) {
                            console.log('[MSE] Buffer available, starting playback...');
                            video.play().catch(e => console.log('[MSE] Play prevented:', e));
                        }
                    }
                } catch(e) {
                    console.warn('[MSE] Error in updateend:', e);
                }
                processH264Queue();
            });
            
            sourceBuffer.addEventListener('error', (e) => {
                console.error('[MSE] SourceBuffer error:', e);
            });
            
            // CRITICAL FIX: Re-append Init Segment on restart/late join
            if (cachedInitSegment) {
                console.log(`[MSE] Restoring Init Segment (${cachedInitSegment.byteLength} bytes)`);
                h264Queue.unshift(cachedInitSegment); // Put it at the FRONT of the queue
            }

            // Process any data that was buffered in stickyBuffer while waiting for sourceopen
            if (stickyBuffer.length > 0) {
                console.log(`[MSE] Parsing ${stickyBuffer.length} bytes buffered during init`);
                parseAtoms();
            }
            
            // Process any queued data
            if (h264Queue.length > 0) {
                console.log(`[MSE] Processing ${h264Queue.length} queued chunks`);
                processH264Queue();
            }
            
        } catch (error) {
            console.error('[MSE] Failed to create SourceBuffer:', error);
        }
    });
}

function handleH264Data(arrayBuffer) {
    try {
        // RECOVERY: If MediaSource died (e.g., tab backgrounded), restart it.
        // FIX: Only restart if we have a SourceBuffer (meaning we were fully running before)
        if (!mediaSource || (mediaSource.readyState === 'closed' && sourceBuffer)) {
            console.warn('[MSE] MediaSource is closed. Attempting restart...');
            cleanupMediaSource();
            initializeMediaSource();
            // Reset buffer to wait for next Keyframe/Init
            stickyBuffer = new Uint8Array(0);
            // Keep initSegmentReceived = true if we have cachedInitSegment, otherwise false
            initSegmentReceived = !!cachedInitSegment; 
            return;
        }

        // FIX: Don't process data if MediaSource isn't ready yet
        if (mediaSource.readyState !== 'open') {
            // Still append to stickyBuffer so we don't lose data while opening
             const chunk = new Uint8Array(arrayBuffer);
             const newBuffer = new Uint8Array(stickyBuffer.length + chunk.length);
             newBuffer.set(stickyBuffer, 0);
             newBuffer.set(chunk, stickyBuffer.length);
             stickyBuffer = newBuffer;
             return;
        }

        // DIAGNOSTIC: Log first packet to verify Init Segment
        if (!initSegmentReceived && stickyBuffer.length === 0) {
             const debugView = new Uint8Array(arrayBuffer.slice(0, 8));
             const hexHeader = Array.from(debugView).map(b => b.toString(16).padStart(2, '0')).join(' ');
             const asciiHeader = Array.from(debugView).map(b => b >= 32 && b <= 126 ? String.fromCharCode(b) : '.').join('');
             console.log(`[MSE DEBUG] First Packet Received (${arrayBuffer.byteLength} bytes). Hex: ${hexHeader} | Ascii: ${asciiHeader}`);
        }

        // 1. Append to reassembly buffer
        const chunk = new Uint8Array(arrayBuffer);
        const newBuffer = new Uint8Array(stickyBuffer.length + chunk.length);
        newBuffer.set(stickyBuffer, 0);
        newBuffer.set(chunk, stickyBuffer.length);
        stickyBuffer = newBuffer;

        // 2. Parse complete atoms
        parseAtoms();

    } catch (error) {
        console.error('[MSE] handleH264Data error:', error);
    }
}

// DIAGNOSTIC: Monitor Video State
setInterval(() => {
    const video = document.getElementById('game-screenshot');
    if (!video || !useWebSocket) return;
    
    // FIX: Wrap SourceBuffer access in try-catch to prevent "SourceBuffer removed" crash
    try {
        if (sourceBuffer && sourceBuffer.buffered && mediaSource.readyState === 'open') {
             const ranges = [];
             for(let i=0; i<sourceBuffer.buffered.length; i++) {
                 ranges.push(`[${sourceBuffer.buffered.start(i).toFixed(2)} - ${sourceBuffer.buffered.end(i).toFixed(2)}]`);
             }
             if (video.readyState > 0 || ranges.length > 0) {
                 console.log(`[MSE STATUS] ReadyState: ${video.readyState} | Buffered: ${ranges.join(', ')} | Q: ${h264Queue.length}`);
             }
        }
    } catch (e) {
        // Suppress noise
    }
}, 2000);

function parseAtoms() {
    while (true) {
        // Need at least 8 bytes (Size + Type)
        if (stickyBuffer.length < 8) break;

        const view = new DataView(stickyBuffer.buffer, stickyBuffer.byteOffset, stickyBuffer.byteLength);
        const atomSize = view.getUint32(0, false); // Big Endian

        // Basic validation / Sanity check
        if (atomSize === 0) {
            console.warn('[MSE] Atom size 0 detected. Resetting buffer.');
            stickyBuffer = new Uint8Array(0);
            break;
        }
        
        // Wait for full atom
        if (stickyBuffer.length < atomSize) break;

        // Extract atom
        const atom = stickyBuffer.slice(0, atomSize);
        stickyBuffer = stickyBuffer.slice(atomSize);

        // Check for Init Segment (ftyp / moov)
        const atomType = String.fromCharCode(
            atom[4], atom[5], atom[6], atom[7]
        );
        
        if (atomType === 'ftyp' || atomType === 'moov') {
            console.log(`[MSE] Received Init Atom: ${atomType} (${atomSize} bytes)`);
            initSegmentReceived = true;

            // Cache logic - Critical for Late Joiners
            if (atomType === 'ftyp') {
                cachedInitSegment = atom;
                continue; // Don't push ftyp alone - wait for moov to combine them
            } else if (cachedInitSegment && atomType === 'moov') {
                // Combine ftyp + moov into one valid Init Segment
                const newCache = new Uint8Array(cachedInitSegment.length + atom.length);
                newCache.set(cachedInitSegment, 0);
                newCache.set(atom, cachedInitSegment.length);
                cachedInitSegment = newCache;

                // If we are joining late, this combined segment IS the payload we need to process now
                h264Queue.push(newCache);
                continue; // Skip pushing 'atom' individually since we pushed the combo
            }
        } 
        else if (atomType === 'moof') {
             if (!initSegmentReceived && !cachedInitSegment) {
                 console.warn('[MSE] Received moof before Init Segment! Waiting for Init...');
                 // Drop this packet. We cannot play it without Init.
                 // But we don't reset stickyBuffer because the next packet might be valid.
                 continue; 
             }
        }

        // Normal processing
        h264Queue.push(atom);
    }

    // Trigger processing
    processH264Queue();
}

function processH264Queue() {
    if (!sourceBuffer || sourceBuffer.updating || h264Queue.length === 0) {
        return;
    }
    
    // If MediaSource isn't ready, we just wait.
    if (!mediaSource || mediaSource.readyState !== 'open') {
        return;
    }

    const nextChunk = h264Queue.shift();
    try {
        sourceBuffer.appendBuffer(nextChunk);
        
        // UI Updates
        const video = document.getElementById('game-screenshot');
        video.style.display = 'block';
        lastUpdate.textContent = `LAST UPDATE: ${new Date().toLocaleTimeString()} [LIVE FEED]`;
        
        if (video.paused && video.readyState >= 2) {
             video.play().catch(e => {});
        }
        
        const streamDisabledOverlay = document.getElementById('stream-disabled');
        if (streamDisabledOverlay) {
            streamDisabledOverlay.classList.remove('flex');
            streamDisabledOverlay.classList.add('hidden');
        }

    } catch (err) {
        console.error('[MSE] Error appending buffer:', err);
        if (err.name === 'QuotaExceededError') {
            console.warn('[MSE] Buffer full. Cleaning up...');
            removeOldBuffer();
            h264Queue.unshift(nextChunk); // Retry
        } else if (err.name === 'InvalidStateError') {
            console.error('[MSE] Invalid State - SourceBuffer removed or MediaSource closed. Resetting.');
            cleanupMediaSource();
            initializeMediaSource();
        }
    }
}

function removeOldBuffer() {
    if (!sourceBuffer || sourceBuffer.updating) {
        return;
    }
    
    const video = document.getElementById('game-screenshot');
    if (!video) return;
    
    // Keep last 30 seconds, remove everything older
    const currentTime = video.currentTime;
    const buffered = sourceBuffer.buffered;
    
    if (buffered.length > 0) {
        const start = buffered.start(0);
        const end = buffered.end(buffered.length - 1);
        
        // Remove old data before (currentTime - 30 seconds)
        const removeUntil = Math.max(start, currentTime - 30);
        
        if (removeUntil > start) {
            console.log(`[MSE] Removing buffer from ${start.toFixed(2)} to ${removeUntil.toFixed(2)}`);
            try {
                sourceBuffer.remove(start, removeUntil);
            } catch (err) {
                console.error('[MSE] Error removing buffer:', err);
            }
        }
    }
}

function cleanupMediaSource(fullReset = false) {
    console.log(`[MSE] Cleaning up Media Source Extensions (Full Reset: ${fullReset})`);
    
    if (sourceBuffer) {
        try {
            if (mediaSource && mediaSource.readyState === 'open') {
                mediaSource.endOfStream();
            }
        } catch (e) {
            console.warn('[MSE] Cleanup warning:', e);
        }
    }
    
    sourceBuffer = null;
    mediaSource = null;
    h264Queue = [];
    stickyBuffer = new Uint8Array(0); // Reset reassembly buffer
    initSegmentReceived = false;
    
    if (fullReset) {
        cachedInitSegment = null;
    }
    
    const video = document.getElementById('game-screenshot');
    if (video && video.src.startsWith('blob:')) {
        URL.revokeObjectURL(video.src);
        video.src = '';
    }
}

// FIX: Improved Latency Management with Stuck Detection
let lastVideoTime = 0;
let stuckCounter = 0;

setInterval(() => {
    const video = document.getElementById('game-screenshot');
    if (!video || !sourceBuffer || !useWebSocket) return;

    // Wrap in try-catch to handle potential sourceBuffer errors
    try {
        const buffered = sourceBuffer.buffered;
        if (buffered.length > 0) {
            const bufferEnd = buffered.end(buffered.length - 1);
            const currentTime = video.currentTime;
            const latency = bufferEnd - currentTime;

            // LOGGING (Every 2s or if interesting events happen)
            // Log more frequently if we are starting up (time < 3) or latency is high
            if (currentTime < 3 || latency > 0.5 || stuckCounter > 0) {
                 console.log(`[MSE STATUS] Ready: ${video.readyState} | Buf: [0.00 - ${bufferEnd.toFixed(2)}] | Time: ${currentTime.toFixed(2)} | Lat: ${latency.toFixed(2)} | Paused: ${video.paused}`);
            }

            // FIX: Detect stuck playback (time not advancing)
            if (!video.paused) {
                if (Math.abs(currentTime - lastVideoTime) < 0.01) {
                    stuckCounter++;
                    if (stuckCounter > 2) { // Stuck for 2+ seconds
                        console.warn('[MSE] Playback stuck! Attempting recovery...');
                        video.currentTime = bufferEnd - 0.1;
                        stuckCounter = 0;
                    }
                } else {
                    stuckCounter = 0;
                }
            } else {
                 // If paused but we have buffer, TRY TO PLAY
                 console.log('[MSE] Video is paused but has buffer. Attempting play...');
                 video.play().then(() => {
                     console.log('[MSE] Playback started successfully');
                 }).catch(e => {
                     console.warn('[MSE] Autoplay prevented:', e);
                     // If autoplay is blocked, muting might help (though we already mute)
                     if (!video.muted) {
                         video.muted = true;
                         video.play().catch(e2 => console.error('[MSE] Muted autoplay also failed:', e2));
                     }
                 });
                 
                 // If we are way behind (latency > 1.0s), jump ahead even if paused so we are ready when played
                 if (latency > 1.0) {
                     console.log('[MSE] Latency high (paused), seeking to live edge...');
                     video.currentTime = bufferEnd - 0.1;
                 }
            }
            lastVideoTime = currentTime;

            // Latency management (while playing)
            // Aggressive latency control for live streaming
            if (latency > 0.6 && !video.paused) {
                console.log(`[MSE] Latency high (${latency.toFixed(2)}s), seeking to live edge`);
                video.currentTime = bufferEnd - 0.1;
            }
        } else if (useWebSocket && !video.paused) {
            // No buffer but we should be streaming - possible issue
            stuckCounter++;
            if (stuckCounter > 5) {
                console.warn('[MSE] No buffer for 5+ seconds, may need reconnection');
                stuckCounter = 0;
            }
        }
    } catch (e) {
        console.error('[MSE] Monitor error:', e);
    }
}, 1000);

// Store camera bounds for ping coordinate mapping
let cameraBounds = null;

// Store colonist portraits from gameState
const colonistPortraits = {};
// Store item icons from gameState
const itemIcons = {};
const openedInventoryColonists = new Set();
let mapSize = { x: 250, z: 250 }; // Default fallback

function updateMapOverlays(colonists, gameState) {
    const overlaysContainer = document.getElementById('map-overlays');
    if (!overlaysContainer) return;

    // Update map size if available
    if (gameState.map_size) {
        mapSize = gameState.map_size;
    }

    // Full redraw for smooth movement (markers are cheap)
    overlaysContainer.innerHTML = '';

    colonists.forEach((c, index) => {
        const data = c.colonist || c;
        const pos = data.position;
        if (!pos) return;

        // Normalize coordinates (RimWorld Bottom-Left -> CSS Top-Left)
        const leftPct = (pos.x / mapSize.x) * 100;
        const topPct = ((mapSize.z - pos.z) / mapSize.z) * 100;

        const marker = document.createElement('div');
        marker.className = 'absolute w-6 h-6 -ml-3 -mt-3 border border-black rounded-full overflow-hidden shadow-sm cursor-pointer transition-transform z-10';
        marker.style.left = `${leftPct}%`;
        marker.style.top = `${topPct}%`;
        marker.style.transform = 'scale(var(--marker-scale, 1))'; // Dynamic scaling
        marker.title = data.name;
        
        // Add hover effect manually to respect dynamic scale
        marker.onmouseenter = () => marker.style.transform = 'scale(calc(var(--marker-scale, 1) * 1.5))';
        marker.onmouseleave = () => marker.style.transform = 'scale(var(--marker-scale, 1))';
        
        // Status Color
        if (data.drafted) {
            marker.classList.add('ring-2', 'ring-rat-red');
        } else {
            marker.classList.add('ring-1', 'ring-white');
        }

        // Portrait
        const pawnId = String(data.id || data.pawn_id || index);
        const portrait = getColonistPortrait(pawnId);
        if (portrait) {
            marker.innerHTML = `<img src="data:image/png;base64,${portrait}" class="w-full h-full object-cover">`;
        } else {
            marker.className += ' bg-rat-dark flex items-center justify-center text-[8px] font-mono text-white';
            marker.textContent = (data.name || '?').substring(0,2).toUpperCase();
        }

        marker.onclick = (e) => {
            e.stopPropagation(); // Don't trigger map click
            showColonistSnapshot(c, pawnId);
        };

        overlaysContainer.appendChild(marker);
    });
}

// Function to generate HTML for a single colonist card
function createColonistCardHtml(colonistDetailed, index, gameState) {
    // RIMAPI colonists/detailed returns: { sleep, comfort, fresh_air, colonist: {...}, colonist_work_info: {...} }
    const colonistData = colonistDetailed.colonist || colonistDetailed;

    const pawnId = colonistData.id || colonistData.pawn_id || index;
    const name = colonistData.name || 'Unknown';
    const health = colonistData.health !== undefined ? colonistData.health : 0;
    const mood = colonistData.mood !== undefined ? colonistData.mood : 0;
    const position = colonistData.position || { x: 0, z: 0 };

    // Get inventory for this colonist
    const inventoryData = gameState.inventory || {};
    let inv = inventoryData[pawnId];
    // Handle potential RimAPI wrapper leak
    if (inv && inv.success && inv.data) inv = inv.data;

    let items = inv ? [
        ...(inv.items || []),
        ...(inv.apparels || []),
        ...(inv.equipment || [])
    ] : [];

    // Categorize equipment by slot
    const equipment = {
        weapon: null,
        helmet: null,
        shirt: null,
        bodyArmor: null,
        pants: null,
        shield: null,
        belt: null
    };

    items.forEach(item => {
        const defName = (item.defName || item.def_name || '').toLowerCase();
        const label = (item.label || '').toLowerCase();
        const categories = item.categories || [];

        // Determine slot based on defName and categories
        if (!equipment.weapon && (defName.includes('gun_') || defName.includes('weapon_') || defName.includes('melee') || categories.some(c => c.includes('weapon')))) {
            equipment.weapon = item;
        } else if (!equipment.helmet && (defName.includes('helmet') || defName.includes('hat') || defName.includes('cowboy') || label.includes('helmet') || label.includes('hat'))) {
            equipment.helmet = item;
        } else if (!equipment.shield && (defName.includes('shield') || label.includes('shield'))) {
            equipment.shield = item;
        } else if (!equipment.belt && (defName.includes('belt') || label.includes('belt'))) {
            equipment.belt = item;
        } else if (!equipment.pants && (defName.includes('pants') || defName.includes('trousers') || label.includes('pants') || label.includes('trousers'))) {
            equipment.pants = item;
        } else if (!equipment.shirt && (defName.includes('shirt') || defName.includes('tshirt') || defName.includes('button') || label.includes('shirt'))) {
            equipment.shirt = item;
        } else if (!equipment.bodyArmor && (defName.includes('armor') || defName.includes('vest') || defName.includes('duster') || defName.includes('parka') || defName.includes('jacket') || categories.some(c => c.includes('apparel')))) {
            equipment.bodyArmor = item;
        }
    });

    // Create equipment HTML
    const renderEquipSlot = (slotName, slotItem, slotIcon) => {
        if (slotItem) {
            const defName = slotItem.defName || slotItem.def_name || slotItem.label;
            // Try lookup by defName, then label, then lowercase variations
            let iconData = itemIcons[defName];
            if (!iconData && itemIcons[slotItem.label]) iconData = itemIcons[slotItem.label];
            
            const itemLabel = slotItem.label || slotItem.defName || 'Unknown';

            if (iconData) {
                return `<div class="equip-slot filled" title="${itemLabel}">
                    <img src="data:image/png;base64,${iconData}" alt="${itemLabel}" class="equip-icon" />
                </div>`;
            } else {
                // console.log(`Missing icon for ${defName} / ${itemLabel}`);
                return `<div class="equip-slot filled" title="${itemLabel}">
                    <div class="equip-placeholder">${slotIcon}</div>
                </div>`;
            }
        }
        return `<div class="equip-slot empty" title="No ${slotName}">
            <div class="equip-placeholder">${slotIcon}</div>
        </div>`;
    };

    const equipmentHtml = `
        <div class="equipment-layout">
            <div class="equip-row">
                ${renderEquipSlot('helmet', equipment.helmet, '🪖')}
            </div>
            <div class="equip-row">
                ${renderEquipSlot('shirt', equipment.shirt, '👕')}
                ${renderEquipSlot('body armor', equipment.bodyArmor, '🦺')}
                ${renderEquipSlot('weapon', equipment.weapon, '⚔️')}
            </div>
            <div class="equip-row">
                ${renderEquipSlot('shield', equipment.shield, '🛡️')}
                ${renderEquipSlot('belt', equipment.belt, '📿')}
                ${renderEquipSlot('pants', equipment.pants, '👖')}
            </div>
        </div>
    `;

    const portraitData = getColonistPortrait(pawnId);
    const portraitHtml = portraitData 
        ? `<img src="data:image/png;base64,${portraitData}" alt="${name}" class="w-full h-full object-cover" />`
        : `<div class="portrait-placeholder w-full h-full flex items-center justify-center text-rat-text-dim">?</div>`;

    return `
        <div class="colonist-card" data-pawn-id="${pawnId}" data-x="${position.x}" data-z="${position.z}">
            <div class="colonist-header">
                <div class="colonist-portrait" data-pawn-id="${pawnId}" title="Click for snapshot">
                    ${portraitHtml}
                </div>
                <div class="colonist-info flex-1">
                    <h4>${name}</h4>
                    <div class="colonist-actions">
                        <button class="btn-snapshot text-xs bg-rat-dark border border-rat-border hover:border-rat-green hover:text-rat-green px-2 py-1 rounded transition-colors" data-colonist-index="${index}" title="View detailed info">
                            <i class="fa-regular fa-id-card"></i> ACCESS FILE
                        </button>
                    </div>
                </div>
            </div>
            ${equipmentHtml}
            <div class="colonist-stat">
                <span>Health</span>
                <span>${Math.round(health * 100)}%</span>
            </div>
            <div class="health-bar">
                <div class="health-bar-fill" style="width: ${health * 100}%"></div>
            </div>
            <div class="colonist-stat">
                <span>Mood</span>
                <span>${Math.round(mood * 100)}%</span>
            </div>
            <div class="mood-bar">
                <div class="mood-bar-fill" style="width: ${mood * 100}%"></div>
            </div>
            <div class="colonist-stat mt-2 pt-2 border-t border-rat-border">
                <span>POS</span>
                <span class="text-rat-text-dim">X:${position.x} Z:${position.z}</span>
            </div>
        </div>
    `;
}

// Get colonist portrait from cached gameState data
function getColonistPortrait(pawnId) {
    // Return cached portrait if available
    return colonistPortraits[pawnId] || null;
}

// Function for granular DOM updates of the colonists list
function updateColonistsList(newColonistsData, gameState) {
    const listContainer = document.getElementById('colonists-list');
    
    // Deduplicate newColonists based on pawnId
    const processedPawnIds = new Set();
    const newColonists = newColonistsData.filter(colonistDetailed => {
        const colonistData = colonistDetailed.colonist || colonistDetailed;
        const pawnId = String(colonistData.id || colonistData.pawn_id);
        if (processedPawnIds.has(pawnId)) return false;
        processedPawnIds.add(pawnId);
        return true;
    });

    // 1. Clear loading text or non-card elements
    Array.from(listContainer.children).forEach(child => {
        if (!child.hasAttribute('data-pawn-id')) {
            child.remove();
        }
    });

    const existingCards = new Map();
    Array.from(listContainer.children).forEach(card => {
        if (card.dataset.pawnId) {
            existingCards.set(card.dataset.pawnId, card);
        }
    });

    const newColonistIds = new Set();
    let domChanged = false;

    newColonists.forEach((colonistDetailed, index) => {
        const colonistData = colonistDetailed.colonist || colonistDetailed;
        const pawnId = String(colonistData.id || colonistData.pawn_id || index);
        newColonistIds.add(pawnId);

        if (existingCards.has(pawnId)) {
            const existingCard = existingCards.get(pawnId);
            updateColonistCard(existingCard, colonistDetailed, index, gameState); // Granular update
            existingCards.delete(pawnId);
        } else {
            const newHtml = createColonistCardHtml(colonistDetailed, index, gameState);
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = newHtml;
            const newCardElement = tempDiv.firstElementChild;
            listContainer.appendChild(newCardElement);
            domChanged = true;
        }
    });

    // Remove stale cards
    existingCards.forEach(card => {
        card.remove();
        domChanged = true;
    });

    // Only re-attach listeners if we touched the DOM
    if (domChanged) {
        attachColonistCardEventListeners(newColonists);
    }
}

// Function to attach event listeners to colonist cards
function attachColonistCardEventListeners(colonists) {
    document.querySelectorAll('.btn-snapshot').forEach(btn => {
        // Remove old event listener first to prevent duplicates
        const oldHandler = btn.__snapshotClickHandler;
        if (oldHandler) {
            btn.removeEventListener('click', oldHandler);
        }

        const newHandler = (e) => {
            e.stopPropagation();
            const colonistIndex = parseInt(btn.dataset.colonistIndex);
            const colonist = colonists[colonistIndex];
            const colonistData = colonist.colonist || colonist;
            const pawnId = colonistData.id || colonistData.pawn_id || colonistIndex;
            showColonistSnapshot(colonist, pawnId);
        };
        btn.addEventListener('click', newHandler);
        btn.__snapshotClickHandler = newHandler; // Store handler for removal
    });

    document.querySelectorAll('.colonist-portrait').forEach(portrait => {
        // Remove old event listener first to prevent duplicates
        const oldHandler = portrait.__portraitClickHandler;
        if (oldHandler) {
            portrait.removeEventListener('click', oldHandler);
        }

        const newHandler = (e) => {
            e.stopPropagation();
            const card = portrait.closest('.colonist-card');
            const pawnId = portrait.dataset.pawnId;
            // Find the colonist data from the original array passed to updateColonistsList
            const colonist = colonists.find(c => String(c.colonist?.id || c.colonist?.pawn_id) === pawnId);
            if (colonist) {
                showColonistSnapshot(colonist, pawnId);
            }
        };
        portrait.addEventListener('click', newHandler);
        portrait.__portraitClickHandler = newHandler; // Store handler for removal
    });
}

// Function to update an existing colonist card with new data
function updateColonistCard(existingCard, colonistDetailed, index, gameState) {
    const colonistData = colonistDetailed.colonist || colonistDetailed;
    const name = colonistData.name || 'Unknown';
    const health = colonistData.health !== undefined ? colonistData.health : 0;
    const mood = colonistData.mood !== undefined ? colonistData.mood : 0;
    const position = colonistData.position || { x: 0, z: 0 };
    const pawnId = String(colonistData.id || colonistData.pawn_id || index); // Ensure string for map key

    // Get inventory for this colonist and calculate equipment
    const inventoryData = gameState.inventory || {};
    let inv = inventoryData[pawnId];
    // Handle potential RimAPI wrapper leak
    if (inv && inv.success && inv.data) inv = inv.data;

    let items = inv ? [
        ...(inv.items || []),
        ...(inv.apparels || []),
        ...(inv.equipment || [])
    ] : [];

    // Categorize equipment by slot
    const equipment = {
        weapon: null,
        helmet: null,
        shirt: null,
        bodyArmor: null,
        pants: null,
        shield: null,
        belt: null
    };

    items.forEach(item => {
        const defName = (item.defName || item.def_name || '').toLowerCase();
        const label = (item.label || '').toLowerCase();
        const categories = item.categories || [];

        // Determine slot based on defName and categories
        if (!equipment.weapon && (defName.includes('gun_') || defName.includes('weapon_') || defName.includes('melee') || categories.some(c => c.includes('weapon')))) {
            equipment.weapon = item;
        } else if (!equipment.helmet && (defName.includes('helmet') || defName.includes('hat') || defName.includes('cowboy') || label.includes('helmet') || label.includes('hat'))) {
            equipment.helmet = item;
        } else if (!equipment.shield && (defName.includes('shield') || label.includes('shield'))) {
            equipment.shield = item;
        } else if (!equipment.belt && (defName.includes('belt') || label.includes('belt'))) {
            equipment.belt = item;
        } else if (!equipment.pants && (defName.includes('pants') || defName.includes('trousers') || label.includes('pants') || label.includes('trousers'))) {
            equipment.pants = item;
        } else if (!equipment.shirt && (defName.includes('shirt') || defName.includes('tshirt') || defName.includes('button') || label.includes('shirt'))) {
            equipment.shirt = item;
        } else if (!equipment.bodyArmor && (defName.includes('armor') || defName.includes('vest') || defName.includes('duster') || defName.includes('parka') || defName.includes('jacket') || categories.some(c => c.includes('apparel')))) {
            equipment.bodyArmor = item;
        }
    });

    // 1. Update Name
    const nameEl = existingCard.querySelector('.colonist-info h4');
    if (nameEl && nameEl.textContent !== name) {
        nameEl.textContent = name;
    }

    // 2. Update Portrait
    const portraitContainer = existingCard.querySelector('.colonist-portrait');
    const portraitImg = portraitContainer.querySelector('img');
    const portraitData = getColonistPortrait(pawnId);
    
    if (portraitData && !portraitImg) { // Has data, but currently placeholder (no img)
        const newPortraitHtml = `<img src="data:image/png;base64,${portraitData}" alt="${name}" class="w-full h-full object-cover" />`;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newPortraitHtml;
        portraitContainer.innerHTML = ''; // Clear placeholder
        portraitContainer.appendChild(tempDiv.firstElementChild);
    } else if (portraitData && portraitImg && portraitImg.src !== `data:image/png;base64,${portraitData}`) {
        portraitImg.src = `data:image/png;base64,${portraitData}`; // Update source
    } else if (!portraitData && portraitImg) { // No data, but currently image
        portraitContainer.innerHTML = `<div class="portrait-placeholder w-full h-full flex items-center justify-center text-rat-text-dim">?</div>`;
    }


    // 3. Update Health Bar
    const healthTextEl = existingCard.querySelector('.colonist-stat:nth-of-type(1) span:nth-of-type(2)');
    const healthFillEl = existingCard.querySelector('.health-bar-fill');
    if (healthTextEl) healthTextEl.textContent = `${Math.round(health * 100)}%`;
    if (healthFillEl) healthFillEl.style.width = `${health * 100}%`;

    // 4. Update Mood Bar
    const moodTextEl = existingCard.querySelector('.colonist-stat:nth-of-type(2) span:nth-of-type(2)');
    const moodFillEl = existingCard.querySelector('.mood-bar-fill');
    if (moodTextEl) moodTextEl.textContent = `${Math.round(mood * 100)}%`;
    if (moodFillEl) moodFillEl.style.width = `${mood * 100}%`;

    // 5. Update Position
    const posTextEl = existingCard.querySelector('.colonist-stat:nth-of-type(3) span:nth-of-type(2)');
    if (posTextEl) posTextEl.textContent = `X:${position.x} Z:${position.z}`;

    // 6. Update Equipment (re-generating is usually fine as it's not a hover target)
    // We need the createColonistCardHtml's internal renderEquipSlot
    const renderEquipSlot = (slotName, slotItem, slotIcon) => {
        if (slotItem) {
            const defName = slotItem.defName || slotItem.def_name || slotItem.label;
            let iconData = itemIcons[defName];
            if (!iconData && itemIcons[slotItem.label]) iconData = itemIcons[slotItem.label];
            const itemLabel = slotItem.label || slotItem.defName || 'Unknown';

            if (iconData) {
                return `<div class="equip-slot filled" title="${itemLabel}">
                    <img src="data:image/png;base64,${iconData}" alt="${itemLabel}" class="equip-icon" />
                </div>`;
            } else {
                return `<div class="equip-slot filled" title="${itemLabel}">
                    <div class="equip-placeholder">${slotIcon}</div>
                </div>`;
            }
        }
        return `<div class="equip-slot empty" title="No ${slotName}">
            <div class="equip-placeholder">${slotIcon}</div>
        </div>`;
    };

    const newEquipmentHtml = `
        <div class="equip-row">
            ${renderEquipSlot('helmet', equipment.helmet, '🪖')}
        </div>
        <div class="equip-row">
            ${renderEquipSlot('shirt', equipment.shirt, '👕')}
            ${renderEquipSlot('body armor', equipment.bodyArmor, '🦺')}
            ${renderEquipSlot('weapon', equipment.weapon, '⚔️')}
        </div>
        <div class="equip-row">
            ${renderEquipSlot('shield', equipment.shield, '🛡️')}
            ${renderEquipSlot('belt', equipment.belt, '📿')}
            ${renderEquipSlot('pants', equipment.pants, '👖')}
        </div>
    `;
    const currentEquipmentLayout = existingCard.querySelector('.equipment-layout');
    if (currentEquipmentLayout && currentEquipmentLayout.innerHTML.trim() !== newEquipmentHtml.trim()) {
        currentEquipmentLayout.innerHTML = newEquipmentHtml;
    }
}

// Function for granular DOM updates of the medical alerts list
function updateMedicalAlertsList(newMedicalAlertsData) {
    const existingAlerts = new Map(); // Map<alertId, HTMLElement>
    Array.from(medicalAlertsList.children).forEach(alertDiv => {
        if (alertDiv.dataset.alertId) {
            existingAlerts.set(alertDiv.dataset.alertId, alertDiv);
        }
    });

    // Deduplicate alerts
    const processedAlertIds = new Set();
    const newMedicalAlerts = newMedicalAlertsData.filter(alert => {
        const alertId = `${alert.pawnId}-${alert.condition}-${alert.bodyPart}`;
        if (processedAlertIds.has(alertId)) return false;
        processedAlertIds.add(alertId);
        return true;
    });

    const newAlertIds = new Set();
    const fragment = document.createDocumentFragment();

    newMedicalAlerts.forEach(alert => {
        // Create a unique ID for the alert
        const alertId = `${alert.pawnId}-${alert.condition}-${alert.bodyPart}`;
        newAlertIds.add(alertId);

        const newHtml = createMedicalAlertHtml(alert);

        if (existingAlerts.has(alertId)) {
            // Update existing alert
            const existingAlertDiv = existingAlerts.get(alertId);
            if (existingAlertDiv.outerHTML !== newHtml) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = newHtml;
                const newAlertElement = tempDiv.firstElementChild;
                medicalAlertsList.replaceChild(newAlertElement, existingAlertDiv);
            }
            existingAlerts.delete(alertId); // Mark as processed
        } else {
            // Add new alert
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = newHtml;
            const newAlertElement = tempDiv.firstElementChild;
            fragment.appendChild(newAlertElement);
        }
    });

    // Append new alerts from the fragment
    medicalAlertsList.appendChild(fragment);

    // Remove old alerts
    existingAlerts.forEach(alertDiv => {
        alertDiv.remove();
    });

    // Re-attach event listeners
    attachMedicalAlertEventListeners();
}

// Function to attach event listeners to medical alert cards
function attachMedicalAlertEventListeners() {
    document.querySelectorAll('.btn-follow-alert').forEach(btn => {
        // Remove old event listener first to prevent duplicates
        const oldHandler = btn.__followAlertClickHandler;
        if (oldHandler) {
            btn.removeEventListener('click', oldHandler);
        }

        const newHandler = async () => {
            const pawnId = btn.dataset.pawnId;
            btn.disabled = true;
            btn.textContent = '⏳ LOCATING...';

            await selectColonist(pawnId);

            setTimeout(() => {
                btn.disabled = false;
                btn.textContent = '📍 LOCATE SUBJECT';
                showFeedback('success', 'Subject located');
            }, 1000);
        };
        btn.addEventListener('click', newHandler);
        btn.__followAlertClickHandler = newHandler; // Store handler for removal
    });
}

// Send camera control command
async function moveCameraToPosition(x, z, zoom = null) {
    // ... existing camera logic ...
}

// Select colonist in-game
async function selectColonist(pawnId) {
    console.log(`Selecting colonist: ${pawnId}`);
    try {
        await sendAction('colonist_command', JSON.stringify({
            type: 'select',
            pawnId: pawnId
        }));
    } catch (error) {
        console.error('Failed to select colonist:', error);
    }
}

// Show colonist snapshot modal
async function showColonistSnapshot(colonistDetailed, pawnId) {
    // RIMAPI structure: { sleep, comfort, fresh_air, colonist: {...}, colonist_work_info: {...}, colonist_medical_info: {...} }
    const colonistData = colonistDetailed.colonist || colonistDetailed;
    const workInfo = colonistDetailed.colonist_work_info || {};
    const medicalInfo = colonistDetailed.colonist_medical_info || {};

    const name = colonistData.name || 'Unknown';
    const health = colonistData.health !== undefined ? colonistData.health : 0;
    const mood = colonistData.mood !== undefined ? colonistData.mood : 0;
    const position = colonistData.position || { x: 0, z: 0 };

    // Extract additional data
    const age = colonistData.age || 'Unknown';
    const gender = colonistData.gender || 'Unknown';
    const currentActivity = workInfo.current_job || colonistData.current_activity || 'Idle';
    const traits = workInfo.traits || [];
    const skills = workInfo.skills || [];

    // Needs from top-level fields in colonistDetailed
    const needs = {
        sleep: colonistDetailed.sleep,
        comfort: colonistDetailed.comfort,
        recreation: colonistData.joy || colonistData.recreation,
        food: colonistData.food || colonistData.hunger,
        rest: colonistDetailed.sleep
    };

    // Build skills HTML
    let skillsHtml = '';
    if (skills.length > 0) {
        const sortedSkills = [...skills]
            .filter(skill => !skill.permanently_disabled && !skill.totally_disabled)
            .sort((a, b) => (b.level || 0) - (a.level || 0));

        skillsHtml = sortedSkills.slice(0, 10).map(skill => {
            const skillName = skill.name || 'Unknown';
            const skillLevel = skill.level !== undefined ? skill.level : 0;
            const passion = skill.passion || 0;
            const passionIcon = passion === 2 ? '<span class="text-rat-yellow">🔥🔥</span>' : passion === 1 ? '<span class="text-rat-yellow">🔥</span>' : '';

            return `
                <div class="grid grid-cols-[1fr_auto] gap-2 items-center mb-2 text-sm">
                    <span class="text-rat-text">${skillName} ${passionIcon}</span>
                    <span class="font-mono font-bold text-rat-green">${skillLevel}</span>
                    <div class="col-span-2 h-1 bg-rat-border rounded-full overflow-hidden">
                        <div class="h-full bg-rat-green" style="width: ${(skillLevel / 20) * 100}%"></div>
                    </div>
                </div>
            `;
        }).join('');
    } else {
        skillsHtml = '<p class="text-rat-text-dim text-sm italic">Data corrupted/unavailable</p>';
    }

    // Build traits HTML
    let traitsHtml = '';
    if (traits.length > 0) {
        const activeTraits = traits.filter(trait => !trait.suppressed);
        traitsHtml = activeTraits.map(trait => {
            const traitName = trait.label || trait.name || 'Unknown';
            return `<span class="inline-block px-2 py-1 bg-rat-dark border border-rat-green text-rat-green text-xs rounded mr-1 mb-1">${traitName}</span>`;
        }).join('');
    } else {
        traitsHtml = '<p class="text-rat-text-dim text-sm italic">None detected</p>';
    }

    // Build needs HTML
    let needsHtml = '';
    const needsList = [
        { key: 'food', label: 'NUTRITION', value: needs.food },
        { key: 'rest', label: 'REST', value: needs.rest },
        { key: 'recreation', label: 'RECREATION', value: needs.recreation || needs.joy },
        { key: 'comfort', label: 'COMFORT', value: needs.comfort }
    ];

    needsHtml = needsList.map(need => {
        if (need.value === undefined) return '';
        const percent = Math.round(need.value * 100);
        return `
            <div class="mb-3">
                <div class="flex justify-between text-xs font-mono mb-1 text-rat-text-dim">
                    <span>${need.label}</span>
                    <span>${percent}%</span>
                </div>
                <div class="h-1 bg-rat-border rounded-full overflow-hidden">
                    <div class="h-full bg-white" style="width: ${percent}%"></div>
                </div>
            </div>
        `;
    }).filter(h => h).join('');

    // Create modal backdrop
    const modal = document.createElement('div');
    modal.className = 'colonist-snapshot-modal fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm';
    modal.innerHTML = `
        <div class="bg-rat-panel border border-rat-green rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col m-4">
            <div class="flex justify-between items-center p-6 border-b border-rat-border bg-rat-dark">
                <div>
                    <h2 class="font-mono text-2xl text-rat-green uppercase tracking-widest">${name}</h2>
                    <span class="text-xs font-mono text-rat-text-dim">ID: ${pawnId}</span>
                </div>
                <button class="modal-close-btn text-rat-text-dim hover:text-rat-red text-3xl leading-none">&times;</button>
            </div>
            
            <div class="overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-3 gap-8 custom-scrollbar">
                <!-- Left: Portrait & Basic Info -->
                <div class="flex flex-col gap-4">
                    <div class="snapshot-portrait-large aspect-square bg-black border-2 border-rat-border rounded-lg overflow-hidden relative flex items-center justify-center group">
                        <div class="portrait-placeholder-large text-rat-text-dim animate-pulse">Loading scan...</div>
                        <div class="absolute inset-0 border border-rat-green/30 pointer-events-none"></div>
                        <div class="absolute bottom-2 right-2 text-xs font-mono text-rat-green/50">LIVE FEED</div>
                    </div>
                    <div class="bg-rat-dark p-4 rounded border border-rat-border">
                        <div class="flex justify-between py-1 border-b border-rat-border border-dashed text-sm">
                            <span class="text-rat-text-dim">AGE</span>
                            <span class="font-mono">${age}</span>
                        </div>
                         <div class="flex justify-between py-1 border-b border-rat-border border-dashed text-sm">
                            <span class="text-rat-text-dim">GENDER</span>
                            <span class="font-mono">${gender}</span>
                        </div>
                         <div class="flex justify-between py-1 text-sm">
                            <span class="text-rat-text-dim">ACTIVITY</span>
                            <span class="font-mono text-right max-w-[150px] truncate" title="${currentActivity}">${currentActivity}</span>
                        </div>
                    </div>
                </div>

                <!-- Middle: Status & Traits -->
                <div class="flex flex-col gap-6">
                    <div>
                        <h3 class="font-mono text-rat-yellow text-sm mb-3 border-b border-rat-yellow/20 pb-1">VITALS & NEEDS</h3>
                        <div class="mb-2">
                            <div class="flex justify-between text-xs font-mono mb-1 text-rat-text-dim">
                                <span>HEALTH INTEGRITY</span>
                                <span>${Math.round(health * 100)}%</span>
                            </div>
                            <div class="h-2 bg-rat-border rounded-full overflow-hidden">
                                <div class="h-full bg-rat-red" style="width: ${health * 100}%"></div>
                            </div>
                        </div>
                        <div class="mb-4">
                             <div class="flex justify-between text-xs font-mono mb-1 text-rat-text-dim">
                                <span>PSYCH STATE</span>
                                <span>${Math.round(mood * 100)}%</span>
                            </div>
                            <div class="h-2 bg-rat-border rounded-full overflow-hidden">
                                <div class="h-full bg-rat-green" style="width: ${mood * 100}%"></div>
                            </div>
                        </div>
                        ${needsHtml}
                    </div>

                    <div>
                        <h3 class="font-mono text-rat-yellow text-sm mb-3 border-b border-rat-yellow/20 pb-1">PSYCH PROFILE</h3>
                        <div class="flex flex-wrap gap-1">
                            ${traitsHtml}
                        </div>
                    </div>
                </div>

                <!-- Right: Skills -->
                <div class="flex flex-col">
                     <h3 class="font-mono text-rat-yellow text-sm mb-3 border-b border-rat-yellow/20 pb-1">COMPETENCIES</h3>
                     <div class="skills-container">
                        ${skillsHtml}
                     </div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Load portrait
    const portraitDiv = modal.querySelector('.snapshot-portrait-large');
    const imageData = getColonistPortrait(pawnId);

    if (imageData) {
        portraitDiv.innerHTML = `
            <img src="data:image/png;base64,${imageData}" alt="${name}" class="w-full h-full object-cover" />
            <div class="absolute inset-0 border border-rat-green/30 pointer-events-none"></div>
             <div class="absolute bottom-2 right-2 text-xs font-mono text-rat-green/50">LIVE FEED</div>
        `;
    } else {
         portraitDiv.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full text-rat-text-dim">
                <i class="fa-solid fa-user-slash text-3xl mb-2"></i>
                <span class="font-mono text-xs">NO VISUAL</span>
            </div>
             <div class="absolute inset-0 border border-rat-green/30 pointer-events-none"></div>
        `;
    }

    // Close handler
    const closeBtn = modal.querySelector('.modal-close-btn');
    closeBtn.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

socket.on('viewer-count-update', (data) => {
    if (currentSession && data.sessionId === currentSession) {
        viewerCount.textContent = `${data.viewerCount} OBSERVERS`;
    }
    // Update session list object
    if (!currentSession) {
        const session = sessions.find(s => s.sessionId === data.sessionId);
        if (session) {
            session.playerCount = data.viewerCount;
            renderSessionsList();
        }
    }
});

socket.on('map-image-update', (data) => {
    if (currentSession && data.sessionId === currentSession) {
        const mapImg = document.getElementById('tactical-map-image');
        const mapLoading = document.getElementById('map-loading');
        
        if (mapImg && data.image) {
            // Handle ArrayBuffer -> Blob -> URL
            const blob = new Blob([data.image], { type: 'image/jpeg' });
            const url = URL.createObjectURL(blob);
            
            // Revoke old URL to prevent memory leaks
            if (mapImg.src && mapImg.src.startsWith('blob:')) {
                URL.revokeObjectURL(mapImg.src);
            }
            
            mapImg.src = url;
            
            if (mapLoading) mapLoading.classList.add('hidden');
        }
    }
});

// CONTENT BROWSER LOGIC

let definitions = null;

async function openContentBrowser(category) {
    const modal = document.getElementById('content-browser-modal');
    const title = document.getElementById('browser-title');
    const grid = document.getElementById('browser-grid');
    const filterSelect = document.getElementById('browser-filter');
    const searchInput = document.getElementById('browser-search');
    
    // Reset state
    grid.innerHTML = '<p class="text-rat-text-dim font-mono col-span-full text-center py-10">Fetching telemetry...</p>';
    filterSelect.innerHTML = '<option value="all">ALL CATEGORIES</option>';
    searchInput.value = '';
    
    modal.classList.remove('hidden');

    // Fetch definitions if not cached
    if (!definitions) {
        try {
            const res = await fetch(`/api/definitions/${currentSession}`);
            if (res.ok) {
                definitions = await res.json();
            } else {
                throw new Error('API Error');
            }
        } catch (e) {
            grid.innerHTML = '<p class="text-rat-red font-mono col-span-full text-center py-10">Failed to load game data.</p>';
            return;
        }
    }

    // Render logic based on category
    let items = [];
    let filters = [];

    if (category === 'weather') {
        title.textContent = 'WEATHER CONTROL';
        items = (definitions.weather || []).map(w => ({
            id: w.defName,
            label: w.label,
            desc: w.description,
            type: 'weather',
            category: 'Weather',
            cost: 500 // Default cost
        }));
    } else if (category === 'events') {
        title.textContent = 'EVENT DIRECTOR';
        items = (definitions.incidents || []).map(i => ({
            id: i.defName,
            label: i.label,
            desc: i.category,
            type: 'event',
            category: i.category,
            cost: 1000 // Default cost
        }));
        filters = [...new Set(items.map(i => i.category))];
    } else if (category === 'animals') {
        title.textContent = 'ANIMAL SPAWNER';
        items = (definitions.animals || []).map(a => ({
            id: a.defName,
            label: a.label,
            desc: a.race,
            type: 'animal',
            category: a.race || 'Unknown',
            cost: Math.max(100, Math.floor((a.combatPower || 10) * 2)) // Dynamic pricing
        }));
    }

    // Populate Filter Dropdown
    if (filters.length > 0) {
        filters.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f;
            opt.textContent = f;
            filterSelect.appendChild(opt);
        });
        filterSelect.disabled = false;
    } else {
        filterSelect.disabled = true;
    }

    // Initial Render
    renderBrowserItems(items, grid);

    // Search Handler
    searchInput.oninput = (e) => {
        const query = e.target.value.toLowerCase();
        const cat = filterSelect.value;
        const filtered = items.filter(i => 
            (cat === 'all' || i.category === cat) &&
            (i.label.toLowerCase().includes(query) || i.id.toLowerCase().includes(query))
        );
        renderBrowserItems(filtered, grid);
    };

    // Filter Handler
    filterSelect.onchange = (e) => {
        searchInput.dispatchEvent(new Event('input'));
    };
}

function renderBrowserItems(items, container) {
    document.getElementById('browser-count').textContent = `${items.length} ITEMS FOUND`;
    
    if (items.length === 0) {
        container.innerHTML = '<p class="text-rat-text-dim font-mono col-span-full text-center py-10">No matching definitions found.</p>';
        return;
    }

    container.innerHTML = items.map(item => `
        <div class="bg-rat-panel border border-rat-border rounded p-4 hover:border-rat-green transition-colors group relative cursor-pointer" onclick="selectBrowserItem('${item.id}', '${item.type}', ${item.cost}, '${item.label.replace(/'/g, "\\'")}')">
            <h3 class="font-mono text-rat-green text-lg truncate group-hover:text-white">${item.label}</h3>
            <p class="text-xs text-rat-text-dim font-mono truncate mb-2">${item.desc || item.id}</p>
            <div class="flex justify-between items-center mt-2 border-t border-rat-border pt-2">
                <span class="text-xs text-rat-yellow font-mono font-bold">${item.cost}c</span>
                <span class="text-[10px] text-rat-text-dim font-mono uppercase bg-rat-dark px-2 rounded border border-rat-border">BUY</span>
            </div>
        </div>
    `).join('');
}

function closeContentBrowser() {
    document.getElementById('content-browser-modal').classList.add('hidden');
}

// Handle selection and purchase
async function selectBrowserItem(id, type, cost, label) {
    if(!confirm(`Trigger "${label}" for ${cost} coins?`)) return;

    // Construct payload
    let action = '';
    if (type === 'weather') action = 'change_weather_dynamic';
    else if (type === 'event') action = 'trigger_incident_dynamic';
    else if (type === 'animal') action = 'spawn_pawn_dynamic';

    // Purchase logic reused from sendAction but adapted for dynamic costs
    const currentCoinText = coinBalance ? coinBalance.textContent.replace(/[^0-9]/g, '') : '0';
    const currentCoins = parseInt(currentCoinText);
    
    if (currentCoins < cost) {
        showFeedback('error', `INSUFFICIENT FUNDS (${cost} CREDITS)`);
        return;
    }

    try {
        // 1. Pay
        const purchaseRes = await fetch(`/api/economy/${encodeURIComponent(currentSession)}/purchase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, action: 'dynamic_purchase', cost }) // Generic action name for log
        });
        
        if (!purchaseRes.ok) {
            throw new Error('Purchase failed');
        }

        const resData = await purchaseRes.json();
        
        // 2. Send Action to Mod
        await sendAction(action, id);

        showFeedback('success', `ACTION QUEUED: ${label.toUpperCase()}`);
        closeContentBrowser();

    } catch (e) {
        console.error('Purchase error:', e);
        showFeedback('error', 'TRANSACTION FAILED');
    }
}

// ============================================================================
// MY PAWN (ADOPTION) LOGIC
// ============================================================================

let myPawnId = null;
let myPawnData = null;
let myPawnComponentLoaded = false;

// Poll adoption status every 5 seconds
setInterval(checkAdoptionStatus, 5000);

async function checkAdoptionStatus() {
    if (!currentSession || !username) return;

    try {
        const res = await fetch(`/api/adoptions/${currentSession}/status/${username}`);
        const data = await res.json();
        
        const navBtn = document.getElementById('tab-btn-my-pawn');
        const navBtnText = navBtn ? navBtn.querySelector('span') : null;
        
        // Use existing DOM elements from index.html
        const adoptionCta = document.getElementById('adoption-cta');
        const adoptionInterface = document.getElementById('adoption-interface');
        const adoptBtnMain = document.getElementById('btn-adopt-request-main');

        if (data.hasAdopted && data.adoption && data.adoption.pawnId) {
            // User HAS a pawn
            myPawnId = data.adoption.pawnId;
            
            // Update Navigation Button Text
            if (navBtnText) navBtnText.textContent = "MY PAWN";

            // Switch Views
            if (adoptionCta) adoptionCta.classList.add('hidden');
            if (adoptionInterface) {
                adoptionInterface.classList.remove('hidden');
                adoptionInterface.classList.add('flex'); // Ensure flex display
            }
            
            // Ensure listeners are attached (idempotent)
            if (!myPawnComponentLoaded) {
                attachMyPawnListeners();
                myPawnComponentLoaded = true;
            }

            // Update Data (if tab is active)
            const activeTab = document.querySelector('.tab-btn.active');
            if (activeTab && activeTab.dataset.tab === 'my-pawn') {
                updateMyPawnUI();
            }

        } else {
            // User does NOT have a pawn
            myPawnId = null;
            
            // Update Navigation Button Text
            if (navBtnText) navBtnText.textContent = "ADOPT";

            // Switch Views
            if (adoptionInterface) {
                adoptionInterface.classList.add('hidden');
                adoptionInterface.classList.remove('flex');
            }
            if (adoptionCta) adoptionCta.classList.remove('hidden');
            
            myPawnComponentLoaded = false;
        }
        
        // Always attach listener to the CTA button if it exists
        if(adoptBtnMain) adoptBtnMain.onclick = requestAdoption;

    } catch (e) {
        console.error('Adoption check failed:', e);
    }
}

async function requestAdoption() {
    if (!currentSession || !username) return;
    
    if(!confirm("Initiate Neural Link? Cost: 1000 Credits.")) return;

    try {
        const res = await fetch(`/api/adoptions/${currentSession}/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        
        const data = await res.json();
        if (res.ok && data.success) {
            showFeedback('success', 'NEURAL LINK ESTABLISHED');
            checkAdoptionStatus(); // Immediate refresh
            // Switch to tab
            switchTab('my-pawn');
        } else {
            showFeedback('error', data.error || 'LINK FAILED');
        }
    } catch (e) {
        console.error(e);
        showFeedback('error', 'CONNECTION ERROR');
    }
}

let lastGameState = null;

function updateMyPawnUI() {
    if (!myPawnId || !myPawnComponentLoaded || !lastGameState) return;
    updateMyPawnView(lastGameState);
}

function attachMyPawnListeners() {
    // Commands
    document.querySelectorAll('.btn-cmd').forEach(btn => {
        btn.onclick = async () => {
            const cmd = btn.dataset.cmd;
            console.log(`Sending command: ${cmd} to pawn ${myPawnId}`);
            
            let payload = {
                type: cmd,
                pawnId: myPawnId
            };

            // Map UI commands to Mod commands
            if (cmd === 'draft') {
                payload.type = 'toggle_draft';
            } else if (cmd === 'goto') {
                payload.type = 'move';
                // Future: Activate map cursor to pick location
            } else if (cmd === 'attack') {
                 showFeedback('info', 'ATTACK: COMING SOON');
                 return;
            } else if (cmd === 'medical') {
                 showFeedback('info', 'MEDICAL: COMING SOON');
                 return;
            }

            try {
                await sendAction('colonist_command', JSON.stringify(payload));
            } catch (error) {
                console.error('Command failed:', error);
            }
        };
    });

    // Force Equip Button
    const forceEquipBtn = document.getElementById('btn-force-equip');
    if (forceEquipBtn) {
        forceEquipBtn.onclick = () => {
            showFeedback('info', 'FEATURE IN DEVELOPMENT');
        };
    }
}

// Expose global
window.openContentBrowser = openContentBrowser;
window.closeContentBrowser = closeContentBrowser;
window.selectBrowserItem = selectBrowserItem;

// UI Functions
function updateConnectionStatus(connected) {
    const statusDot = connectionStatus.querySelector('.status-dot');
    const statusText = connectionStatus.querySelector('.status-text');

    if (connected) {
        connectionStatus.classList.remove('disconnected');
        connectionStatus.classList.add('connected');
        connectionStatus.classList.add('text-rat-green');
        statusDot.classList.remove('bg-rat-red');
        statusDot.classList.add('bg-rat-green');
        statusDot.classList.add('shadow-[0_0_10px_#00ff41]');
        statusText.textContent = 'LINK ESTABLISHED';
    } else {
        connectionStatus.classList.remove('connected');
        connectionStatus.classList.add('disconnected');
        connectionStatus.classList.remove('text-rat-green');
        statusDot.classList.remove('bg-rat-green');
        statusDot.classList.remove('shadow-[0_0_10px_#00ff41]');
        statusDot.classList.add('bg-rat-red');
        statusText.textContent = 'NO SIGNAL';
    }
}

function renderSessionsList() {
    if (sessions.length === 0) {
        // Handled in initial HTML, but if we need to clear:
        sessionsList.innerHTML = `
            <div class="no-sessions col-span-full text-center py-20 border border-rat-border border-dashed rounded-lg bg-rat-panel">
                <i class="fa-solid fa-satellite-dish text-4xl text-rat-text-dim mb-4"></i>
                <p class="font-mono text-rat-green">SCANNING FREQUENCIES...</p>
                <p class="text-sm text-rat-text-dim mt-2">No active signals detected.</p>
            </div>
        `;
        return;
    }

    sessionsList.innerHTML = sessions.map(session => {
        const qualityColor = session.networkQuality === 'high' ? '#00ff41' : session.networkQuality === 'low' ? '#ff3333' : '#ffcc00';
        
        return `
        <div class="session-card group bg-rat-panel border border-rat-border hover:border-rat-green rounded-lg p-6 cursor-pointer transition-all relative overflow-hidden" onclick="selectSession('${session.sessionId}')">
            <div class="absolute top-0 left-0 w-1 h-full bg-rat-border group-hover:bg-rat-green transition-colors"></div>
            
            <div class="flex justify-between items-start mb-4 pl-4">
                <h3 class="font-mono text-xl text-white group-hover:text-rat-green transition-colors truncate max-w-[70%]">
                    ${session.mapName} 
                    ${session.requiresPassword ? '<i class="fa-solid fa-lock text-xs text-rat-red ml-2" title="Secure Access"></i>' : ''}
                </h3>
                <div class="flex flex-col items-end">
                    <span class="text-[10px] font-mono uppercase text-rat-text-dim">SIGNAL QUALITY</span>
                    <div class="flex items-center gap-1">
                        <div class="w-2 h-2 rounded-full" style="background: ${qualityColor}; box-shadow: 0 0 5px ${qualityColor}"></div>
                        <span class="text-xs font-bold" style="color: ${qualityColor}">${session.networkQuality.toUpperCase()}</span>
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-y-2 gap-x-4 pl-4 text-sm">
                <div class="flex justify-between border-b border-rat-border/30 pb-1">
                    <span class="text-rat-text-dim">SUBJECTS</span>
                    <span class="font-mono text-rat-text">${session.colonistCount}</span>
                </div>
                <div class="flex justify-between border-b border-rat-border/30 pb-1">
                    <span class="text-rat-text-dim">ASSET VALUE</span>
                    <span class="font-mono text-rat-yellow">$${(session.wealth / 1000).toFixed(1)}k</span>
                </div>
                <div class="flex justify-between border-b border-rat-border/30 pb-1">
                    <span class="text-rat-text-dim">THREATS</span>
                    <span class="font-mono text-rat-red">${session.enemiesCount}</span>
                </div>
                 <div class="flex justify-between border-b border-rat-border/30 pb-1">
                    <span class="text-rat-text-dim">OBSERVERS</span>
                    <span class="font-mono text-rat-green">${session.playerCount}</span>
                </div>
            </div>
            
            <div class="mt-4 pl-4 text-right">
                <span class="text-[10px] font-mono text-rat-text-dim">LAST PING: ${new Date(session.lastUpdate).toLocaleTimeString()}</span>
            </div>
        </div>
    `}).join('');
}

function selectSession(sessionId) {
    // Check for username first
    if (!username) {
        // Show username modal
        pendingSessionId = sessionId;
        openUsernameModal();
        return;
    }

    startSessionConnection(sessionId);
}

function startSessionConnection(sessionId) {
    currentSession = sessionId;
    sessionPassword = null;

    sessionSelection.classList.remove('active');
    gameViewer.classList.add('active');
    
    showLoading("ESTABLISHING SECURE CONNECTION...");

    // Cleanup previous session media state
    cleanupMediaSource(true);

    socket.emit('select-session', { sessionId, username });
    
    // Check viewer count to decide protocol
    const session = sessions.find(s => s.sessionId === sessionId);
    const viewerCount = session ? session.playerCount : 0;
    const forceCDN = document.getElementById('force-cdn-toggle').checked;
    
    // Threshold: > 50 viewers -> HLS (Bunny CDN)
    // OR if Force CDN is toggled
    if (viewerCount > 50 || forceCDN) {
        console.log(`[Protocol] Switching to HLS (Bunny CDN). Force: ${forceCDN}, Viewers: ${viewerCount}`);
        initializeHLS();
    } else {
        console.log(`[Protocol] Low load (${viewerCount} viewers). Using WebSocket streaming.`);
        // Initialize WebSocket for this session
        console.log('[WebSocket] Attempting to initialize for session:', sessionId);
        initializeWebSocket();
    }

    fetch(`/api/session/${encodeURIComponent(sessionId)}`)
        .then(res => res.json())
        .then(data => {
            if (data.session) {
                sessionRequiresPassword = data.session.requiresPassword;
                if (sessionRequiresPassword) {
                    currentSessionName.innerHTML = `${data.session.mapName} <i class="fa-solid fa-lock text-rat-red text-xs ml-2"></i>`;
                } else {
                    currentSessionName.textContent = data.session.mapName;
                }
                colonistCount.textContent = data.session.colonistCount;
                wealthDisplay.textContent = `${(data.session.wealth / 1000).toFixed(1)}k`;
            }
        })
        .catch(err => console.error("Error:", err));

    // Fetch initial balance and prices
    fetchEconomyData(sessionId);
    fetchQueueData(sessionId);
}

function fetchEconomyData(sessionId) {
    // Get prices
    fetch(`/api/economy/${encodeURIComponent(sessionId)}/prices`)
        .then(res => res.json())
        .then(data => {
            if (data.prices) {
                actionCosts = data.prices;
                updateActionButtonsCosts(); // Need to implement this
            }
        })
        .catch(e => console.error('Error fetching prices:', e));

    // Get balance
    if (username) {
        fetch(`/api/economy/${encodeURIComponent(sessionId)}/balance/${encodeURIComponent(username)}`)
            .then(res => res.json())
            .then(data => {
                if (data.coins !== undefined) {
                    if (coinBalance) {
                        coinBalance.textContent = `💰 ${data.coins.toLocaleString()} CREDITS`;
                        coinBalance.classList.remove('hidden');
                    }
                }
            })
            .catch(e => console.error('Error fetching balance:', e));
    }
}

// Track if we've logged initial debug info
let hasLoggedInitialState = false;

function updateGameState(gameState) {
    lastGameState = gameState; // Store global state

    if (!hasLoggedInitialState) {
        console.log('Game State received:', gameState);
        hasLoggedInitialState = true;
    }

    // Update My Pawn View if active
    updateMyPawnUI();

    const colonists = gameState.colonists || [];
    const resources = gameState.resources || {};
    const power = gameState.power || {};
    const creatures = gameState.creatures || {};
    const research = gameState.research || {};
    const factions = gameState.factions || [];

    if (gameState.camera) cameraBounds = gameState.camera;
    if (gameState.colonist_portraits) Object.assign(colonistPortraits, gameState.colonist_portraits);
    if (gameState.item_icons) {
        Object.assign(itemIcons, gameState.item_icons);
        loadActionItemIcons();
    }

    // DLC Availability Check
    if (gameState.active_dlcs) {
        const dlcMap = {
            'royalty': 'dlc-royalty',
            'ideology': 'dlc-ideology',
            'biotech': 'dlc-biotech',
            'anomaly': 'dlc-anomaly',
            'odyssey': 'dlc-odyssey'
        };

        for (const [dlcKey, elementId] of Object.entries(dlcMap)) {
            const el = document.getElementById(elementId);
            if (el) {
                const isActive = gameState.active_dlcs[dlcKey];
                if (!isActive) {
                    el.style.opacity = '0.4';
                    el.style.pointerEvents = 'none';
                    el.style.filter = 'grayscale(1)';
                    const summary = el.querySelector('summary span');
                    if (summary) summary.style.textDecoration = 'line-through';
                    el.removeAttribute('open'); // Close if open
                } else {
                    el.style.opacity = '1';
                    el.style.pointerEvents = 'auto';
                    el.style.filter = 'none';
                    const summary = el.querySelector('summary span');
                    if (summary) summary.style.textDecoration = 'none';
                }
            }
        }
    }

    try {
        colonistCount.textContent = colonists.length;
        wealthDisplay.textContent = `$${((resources.total_market_value || 0)/1000).toFixed(1)}k`;

        if (colonists.length > 0) {
            updateColonistsList(colonists, gameState);
            updateMapOverlays(colonists, gameState);
        } else {
            colonistsList.innerHTML = '<p class="loading col-span-full text-center">No active subjects found</p>';
        }
    } catch (e) {
        console.error("Error updating colonists:", e);
    }

    // Medical Alerts Logic
    try {
        const medicalAlerts = [];
        colonists.forEach(colonistDetailed => {
            const colonistData = colonistDetailed.colonist || colonistDetailed;
            const medicalInfo = colonistDetailed.colonist_medical_info || {};
            const name = colonistData.name || 'Unknown';
            const pawnId = colonistData.id || colonistData.pawn_id;
            const hediffs = medicalInfo.hediffs || [];

            hediffs.forEach(hediff => {
                const hediffName = hediff.label || hediff.def_name || 'Unknown';
                const severity = hediff.severity || 0;
                const bodyPart = hediff.part || hediff.body_part || null;
                const bleeding = hediff.bleeding || false;
                const isPain = hediff.pain_offset !== undefined && hediff.pain_offset > 0;
                const isLethal = hediff.lethal || hediff.tends_to_death || false;

                if (bleeding || isPain || isLethal || severity > 0.3) {
                    let severityClass = 'minor';
                    if (bleeding || isLethal) severityClass = 'critical';
                    else if (severity > 0.6) severityClass = 'serious';

                    medicalAlerts.push({
                        colonist: name,
                        pawnId: pawnId,
                        condition: hediffName,
                        severity: severity,
                        severityClass: severityClass,
                        bodyPart: bodyPart,
                        bleeding: bleeding,
                        isPain: isPain,
                        isLethal: isLethal
                    });
                }
            });
        });

        if (medicalAlerts.length > 0) {
            medicalAlerts.sort((a, b) => {
                const severityOrder = { critical: 0, serious: 1, minor: 2 };
                return (severityOrder[a.severityClass] || 3) - (severityOrder[b.severityClass] || 3);
            });
            updateMedicalAlertsList(medicalAlerts);
        } else {
            medicalAlertsList.innerHTML = '<p class="text-center text-xs text-rat-green/50 font-mono py-4">ALL VITALS STABLE</p>';
        }
    } catch (e) {
        console.error("Error updating medical alerts:", e);
    }

    // Power Stats
    try {
        updatePowerStats(power);
    } catch (e) {
        console.error("Error updating power stats:", e);
    }

    // Creature Stats
    try {
        updateCreatureStats(creatures);
    } catch (e) {
        console.error("Error updating creature stats:", e);
    }

    // Research Stats
    try {
        updateResearchStats(research);
    } catch (e) {
        console.error("Error updating research stats:", e);
    }

    // Factions Stats
    try {
        updateFactionsList(factions);
    } catch (e) {
        console.error("Error updating factions:", e);
    }

    // Inventory Logic
    try {
        const storedResources = gameState.stored_resources || {};
        let allResources = [];

        if (Array.isArray(storedResources)) {
            allResources = storedResources;
        } else {
            Object.values(storedResources).forEach(items => {
                if (Array.isArray(items)) allResources.push(...items);
            });
        }
        allResources = allResources.filter(item => item.stack_count > 0);
        
        // Filter out non-item objects (Plants, Filth, etc.) from storage zones
        const ignoredCategories = ['Plants', 'Filth', 'Mote', 'Pawn', 'Building', 'Ethereal'];
        allResources = allResources.filter(item => {
            const categories = item.categories || [];
            // Also check defName for "Plant_" prefix as a backup
            const defName = (item.def_name || item.defName || '').toString();
            if (defName.startsWith('Plant_')) return false;
            
            return !categories.some(c => ignoredCategories.includes(c));
        });

        const groupedResources = new Map();
        allResources.forEach(item => {
            const defName = item.def_name || item.defName || item.label;
            if (groupedResources.has(defName)) {
                groupedResources.get(defName).stack_count += item.stack_count;
            } else {
                groupedResources.set(defName, { ...item });
            }
        });
        
        allResources = Array.from(groupedResources.values()).sort((a, b) => a.label.localeCompare(b.label));

        if (allResources.length > 0) {
            // Granular update for storage to prevent flicker
            updateStorageList(allResources);
        } else {
            storedResourcesContainer.innerHTML = '<p class="col-span-full text-center text-rat-text-dim">Storage Empty</p>';
        }
    } catch (e) {
        console.error("Error updating storage:", e);
    }

    // Colonist Inventory
    try {
        const inventoryData = gameState.inventory || {};
        if (colonists.length > 0) {
            updateInventoryList(colonists, inventoryData);
        }
    } catch (e) {
        console.error("Error updating inventory:", e);
    }

    // Mods List
    try {
        const mods = gameState.mods || [];
        if (mods.length > 0) {
            updateModsList(mods);
        } else {
            modsList.innerHTML = '<p class="col-span-full text-center text-rat-text-dim">No mod telemetry</p>';
        }
    } catch (e) {
        console.error("Error updating mods:", e);
    }
}

// --- Granular Update Functions ---

function createMedicalAlertHtml(alert) {
    const severityPercent = Math.min(100, Math.round(alert.severity * 100));
    const bodyPartText = alert.bodyPart ? ` <span class="text-rat-text-dim">(${alert.bodyPart})</span>` : '';
    const icons = [
        alert.bleeding ? '🩸' : '',
        alert.isPain ? '⚡' : '',
        alert.isLethal ? '💀' : ''
    ].join('');

    return `
        <div class="medical-alert ${alert.severityClass}" data-alert-id="${alert.pawnId}-${alert.condition}-${alert.bodyPart}">
            <div class="alert-header">
                <strong>${alert.colonist}</strong>
                <span class="alert-severity ${alert.severityClass}">${alert.severityClass.toUpperCase()}</span>
            </div>
            <div class="alert-condition">
                ${alert.condition}${bodyPartText} ${icons}
            </div>
            <div class="alert-severity-bar">
                <div class="alert-severity-fill ${alert.severityClass}" style="width: ${severityPercent}%"></div>
            </div>
            <button class="btn-follow-alert" data-pawn-id="${alert.pawnId}" title="Go to colonist">
                LOCATE SUBJECT
            </button>
        </div>
    `;
}

function updateModsList(mods) {
    // Clear loading text
    Array.from(modsList.children).forEach(el => {
        if (!el.dataset.packageId) el.remove();
    });

    const sortedMods = [...mods].sort((a, b) => a.load_order - b.load_order);
    const existingMap = new Map();
    Array.from(modsList.children).forEach(el => {
        if (el.dataset.packageId) existingMap.set(el.dataset.packageId, el);
    });

    sortedMods.forEach(mod => {
        const pkg = (mod.package_id || mod.packageId || 'unknown').toLowerCase();
        
        const createContent = () => {
            let typeColor = 'text-rat-text-dim';
            if (pkg === 'ludeon.rimworld') typeColor = 'text-rat-green';
            else if (pkg.startsWith('ludeon.rimworld')) typeColor = 'text-rat-yellow';
            
            return `
                <div class="flex justify-between items-start">
                    <h3 class="font-bold text-sm text-white truncate pr-2" title="${mod.name}">${mod.name}</h3>
                    <span class="text-[10px] bg-rat-dark px-1 rounded text-rat-text-dim">#${mod.load_order}</span>
                </div>
                <span class="text-xs font-mono ${typeColor} truncate">${mod.package_id || mod.packageId}</span>
                <span class="text-[10px] text-rat-text-dim italic">${mod.author || 'Unknown'}</span>
            `;
        };

        if (existingMap.has(pkg)) {
            const el = existingMap.get(pkg);
            if (el.innerHTML !== createContent()) { 
                 el.innerHTML = createContent(); 
            }
            existingMap.delete(pkg);
        } else {
            const el = document.createElement('div');
            el.className = "bg-rat-panel border border-rat-border p-3 rounded flex flex-col gap-1 hover:border-rat-green/50 transition-colors";
            el.dataset.packageId = pkg;
            el.innerHTML = createContent();
            modsList.appendChild(el);
        }
    });

    existingMap.forEach(el => el.remove());
}

function updateFactionsList(factionsData) {
    // Clear loading text
    Array.from(factionRelationsFull.children).forEach(el => {
        if (!el.dataset.factionName) el.remove();
    });

    const existingMap = new Map();
    Array.from(factionRelationsFull.children).forEach(el => {
        if (el.dataset.factionName) existingMap.set(el.dataset.factionName, el);
    });

    // Deduplicate factions
    const processedSlugs = new Set();
    const factions = factionsData.filter(faction => {
        const slug = faction.name.replace(/\s+/g, '-').toLowerCase();
        if (processedSlugs.has(slug)) return false;
        processedSlugs.add(slug);
        return true;
    });

    factions.forEach(faction => {
        const slug = faction.name.replace(/\s+/g, '-').toLowerCase();
        const relationColor = faction.relation === 'Hostile' ? 'text-rat-red' :
                              faction.relation === 'Neutral' ? 'text-rat-yellow' : 'text-rat-green';
        
        const createContent = () => `
            <div>
                <span class="block font-bold text-sm text-white">${faction.name}</span>
                <span class="text-xs font-mono ${relationColor}">${faction.relation} (${faction.goodwill})</span>
            </div>
            <div class="flex gap-1">
                 <button class="btn-faction-goodwill w-8 h-8 flex items-center justify-center bg-rat-dark border border-rat-border hover:border-rat-red text-rat-red rounded text-xs" data-faction="${faction.name}" data-amount="-15" title="Sabotage relations">-</button>
                 <button class="btn-faction-goodwill w-8 h-8 flex items-center justify-center bg-rat-dark border border-rat-border hover:border-rat-green text-rat-green rounded text-xs" data-faction="${faction.name}" data-amount="15" title="Improve relations">+</button>
            </div>
        `;

        if (existingMap.has(slug)) {
            const el = existingMap.get(slug);
            // Check if content actually changed (optimization)
            const currentRelation = el.querySelector('.font-mono').textContent;
            if (currentRelation !== `${faction.relation} (${faction.goodwill})`) {
                 el.innerHTML = createContent();
                 attachFactionListeners(el);
            }
            existingMap.delete(slug);
        } else {
            const el = document.createElement('div');
            el.className = "flex items-center justify-between p-3 bg-rat-panel border border-rat-border rounded hover:border-rat-green/50 transition-colors";
            el.dataset.factionName = slug;
            el.innerHTML = createContent();
            factionRelationsFull.appendChild(el);
            attachFactionListeners(el);
        }
    });

    existingMap.forEach(el => el.remove());
}

function attachFactionListeners(container) {
    container.querySelectorAll('.btn-faction-goodwill').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const factionName = btn.dataset.faction;
            const amount = parseInt(btn.dataset.amount);
            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

            try {
                await sendAction('changeFactionGoodwill', {
                    faction: factionName,
                    amount: amount
                });
                showFeedback('success', `Diplomatic signal sent`);
            } catch (error) {
                showFeedback('error', `Transmission failed`);
            } finally {
                setTimeout(() => {
                    btn.disabled = false;
                    btn.innerHTML = originalHTML;
                }, 1000);
            }
        });
    });
}

function updatePowerStats(power) {
    const netPower = (power.current_power || 0) - (power.total_consumption || 0);
    const netColor = netPower >= 0 ? '#00ff41' : '#ff3333';
    const batteryPercent = power.total_power_storage > 0 ? (power.currently_stored_power / power.total_power_storage) * 100 : 0;

    // Initial Render if empty
    if (powerStats.children.length === 0) {
        powerStats.innerHTML = `
            <div class="stat-widget-header">
                <span class="widget-icon"><i class="fa-solid fa-bolt"></i></span>
                <h4>POWER GRID</h4>
            </div>
            <div class="flex flex-col gap-4 bg-rat-panel border border-rat-border p-4 rounded">
                <div class="text-center border-b border-rat-border pb-4">
                    <span class="text-xs text-rat-text-dim font-mono uppercase">Net Output</span>
                    <div id="power-net-val" class="text-3xl font-mono font-bold"></div>
                </div>
                <div class="grid grid-cols-2 gap-4 text-center">
                    <div>
                        <span class="text-[10px] text-rat-text-dim font-mono block">GENERATION</span>
                        <span id="power-gen-val" class="text-rat-green font-mono text-lg"></span>
                    </div>
                    <div>
                        <span class="text-[10px] text-rat-text-dim font-mono block">LOAD</span>
                        <span id="power-load-val" class="text-rat-yellow font-mono text-lg"></span>
                    </div>
                </div>
                <div class="pt-2">
                    <div class="flex justify-between text-xs font-mono mb-1 text-rat-text-dim">
                        <span>BATTERY BANKS</span>
                        <span id="power-bat-pct"></span>
                    </div>
                    <div class="h-2 bg-rat-black border border-rat-border rounded-full overflow-hidden relative">
                        <div id="power-bat-bar" class="h-full bg-rat-yellow transition-all duration-500"></div>
                    </div>
                    <div id="power-bat-text" class="text-right text-[10px] text-rat-text-dim mt-1 font-mono"></div>
                </div>
            </div>
        `;
    }

    // Update Values
    const netEl = document.getElementById('power-net-val');
    if(netEl) {
        netEl.textContent = `${netPower > 0 ? '+' : ''}${netPower.toLocaleString()} W`;
        netEl.style.color = netColor;
    }
    document.getElementById('power-gen-val').textContent = `${(power.current_power || 0).toLocaleString()} W`;
    document.getElementById('power-load-val').textContent = `${(power.total_consumption || 0).toLocaleString()} W`;
    document.getElementById('power-bat-pct').textContent = `${Math.round(batteryPercent)}%`;
    document.getElementById('power-bat-bar').style.width = `${batteryPercent}%`;
    document.getElementById('power-bat-text').textContent = `${(power.currently_stored_power || 0).toLocaleString()} Wd Stored`;
}

function updateCreatureStats(creatures) {
    if (creatureStats.children.length === 0) {
        creatureStats.innerHTML = `
            <div class="stat-widget-header">
                <span class="widget-icon"><i class="fa-solid fa-chart-pie"></i></span>
                <h4>CENSUS DATA</h4>
            </div>
            <div class="population-grid">
                <div class="pop-card colonist">
                    <i class="fa-solid fa-user-astronaut text-rat-text-dim text-xl mb-2"></i>
                    <span id="pop-colonist" class="pop-count">0</span>
                    <span class="pop-label">Subjects</span>
                </div>
                <div class="pop-card enemy">
                     <i class="fa-solid fa-skull text-rat-text-dim text-xl mb-2"></i>
                    <span id="pop-enemy" class="pop-count">0</span>
                    <span class="pop-label">Hostiles</span>
                </div>
                <div class="pop-card animal">
                     <i class="fa-solid fa-paw text-rat-text-dim text-xl mb-2"></i>
                    <span id="pop-animal" class="pop-count">0</span>
                    <span class="pop-label">Fauna</span>
                </div>
                <div class="pop-card prisoner">
                     <i class="fa-solid fa-lock text-rat-text-dim text-xl mb-2"></i>
                    <span id="pop-prisoner" class="pop-count">0</span>
                    <span class="pop-label">Captives</span>
                </div>
            </div>
        `;
    }

    document.getElementById('pop-colonist').textContent = creatures.colonists_count || 0;
    document.getElementById('pop-enemy').textContent = creatures.enemies_count || 0;
    document.getElementById('pop-animal').textContent = creatures.animals_count || 0;
    document.getElementById('pop-prisoner').textContent = creatures.prisoners_count || 0;
}

function updateResearchStats(research) {
    const currentProject = research.label || research.name || 'None';
    const progressPercent = research.progress_percent || 0;

    if (researchStats.children.length === 0) {
        researchStats.innerHTML = `
            <div class="stat-widget-header">
                 <span class="widget-icon"><i class="fa-solid fa-microscope"></i></span>
                <h4>R&D DIVISION</h4>
            </div>
            <div class="bg-rat-panel border border-rat-border p-6 rounded text-center flex flex-col items-center justify-center h-[calc(100%-4rem)]">
                <span class="text-xs text-rat-text-dim font-mono mb-2">CURRENT PROJECT</span>
                <span id="res-project" class="text-xl text-rat-green font-mono font-bold mb-4 block truncate w-full"></span>
                
                <span id="res-tech" class="inline-block px-2 py-1 bg-rat-dark border border-rat-border text-xs text-rat-text-dim rounded mb-6"></span>
                
                <div class="w-full relative pt-2">
                    <div class="h-3 bg-rat-black border border-rat-border rounded-full overflow-hidden relative shadow-[0_0_10px_rgba(0,0,0,0.5)_inset]">
                        <div id="res-bar" class="h-full bg-gradient-to-r from-rat-green to-green-300" style="width: 0%"></div>
                    </div>
                    <span id="res-pct" class="block mt-2 font-mono text-rat-green font-bold"></span>
                </div>
            </div>
        `;
    }

    document.getElementById('res-project').textContent = currentProject;
    document.getElementById('res-project').title = currentProject;
    
    const techEl = document.getElementById('res-tech');
    if (research.tech_level) {
        techEl.textContent = research.tech_level;
        techEl.style.display = 'inline-block';
    } else {
        techEl.style.display = 'none';
    }

    document.getElementById('res-bar').style.width = `${progressPercent}%`;
    document.getElementById('res-pct').textContent = `${Math.round(progressPercent)}%`;
}

function updateStorageList(resources) {
    // Clear loading text
    Array.from(storedResourcesContainer.children).forEach(el => {
        if (!el.dataset.defName) el.remove();
    });

    const existingMap = new Map();
    Array.from(storedResourcesContainer.children).forEach(el => {
        if (el.dataset.defName) existingMap.set(el.dataset.defName, el);
    });

    resources.forEach(item => {
        const defName = item.def_name || item.defName || item.label;
        const createContent = () => {
            const iconData = itemIcons[defName];
            const iconHtml = iconData ? 
                `<img src="data:image/png;base64,${iconData}" class="w-8 h-8 object-contain mb-2" />` : 
                `<div class="w-8 h-8 flex items-center justify-center bg-rat-dark rounded text-rat-text-dim mb-2"><i class="fa-solid fa-box"></i></div>`;
            return `
                ${iconHtml}
                <span class="text-xs text-rat-text-dim truncate w-full">${item.label}</span>
                <span class="font-mono text-rat-yellow font-bold">${item.stack_count.toLocaleString()}</span>
            `;
        };

        if (existingMap.has(defName)) {
            const el = existingMap.get(defName);
            // Update count if changed
            const currentCount = el.querySelector('.text-rat-yellow').textContent;
            if (currentCount !== item.stack_count.toLocaleString()) {
                el.innerHTML = createContent();
            }
            existingMap.delete(defName);
        } else {
            const el = document.createElement('div');
            el.className = "bg-rat-black border border-rat-border p-3 rounded flex flex-col items-center text-center hover:border-rat-yellow transition-colors";
            el.title = item.label;
            el.dataset.defName = defName;
            el.innerHTML = createContent();
            storedResourcesContainer.appendChild(el);
        }
    });

    existingMap.forEach(el => el.remove());
}

function updateInventoryList(colonists, inventoryData) {
    // Clear loading text
    Array.from(inventoryContainer.children).forEach(el => {
        if (!el.dataset.pawnId) el.remove();
    });

    const existingRows = new Map();
    Array.from(inventoryContainer.children).forEach(row => {
        if (row.dataset.pawnId) existingRows.set(row.dataset.pawnId, row);
    });

    colonists.forEach(colonistDetailed => {
        const colonistData = colonistDetailed.colonist || colonistDetailed;
        const pawnId = String(colonistData.id || colonistData.pawn_id);
        const name = colonistData.name || 'Unknown';
        const isExpanded = openedInventoryColonists.has(pawnId);
        
        let inv = inventoryData[pawnId];

        let items = inv ? [
            ...(inv.items || []),
            ...(inv.apparels || []),
            ...(inv.equipment || [])
        ] : [];
        
        const groupedItems = new Map();
        items.forEach(item => {
            const defName = item.defName || item.def_name || item.label;
            const stackCount = item.stackCount || item.stack_count || 1;
            if (groupedItems.has(defName)) {
                groupedItems.get(defName).stackCount += stackCount;
            } else {
                groupedItems.set(defName, { ...item, stackCount: stackCount });
            }
        });
        items = Array.from(groupedItems.values());

        const itemsHtml = items.length === 0 ? 
            '<div class="p-3 text-xs text-rat-text-dim italic">No equipment carried</div>' : 
            items.map(item => {
                const defName = item.defName || item.def_name || item.label;
                const iconData = itemIcons[defName];
                const iconHtml = iconData ? `<img src="data:image/png;base64,${iconData}" class="w-6 h-6 object-contain mr-3" />` : '';
                return `
                    <div class="flex items-center p-2 bg-rat-black border-b border-rat-border/50 last:border-0">
                        ${iconHtml}
                        <span class="text-sm text-rat-text flex-1">${item.label || item.defName}</span>
                        <span class="font-mono text-rat-green text-xs ml-2">x${item.stackCount || item.stack_count || 1}</span>
                    </div>
                `;
            }).join('');

        const portraitData = getColonistPortrait(pawnId);
        const portraitHtml = portraitData ? 
            `<img src="data:image/png;base64,${portraitData}" class="w-8 h-8 rounded object-cover mr-3 border border-rat-border" />` : 
            `<div class="w-8 h-8 rounded bg-rat-dark mr-3 border border-rat-border flex items-center justify-center text-xs">?</div>`;

        // Helper for new row creation
        const createRowContent = () => `
            <div class="inventory-colonist-header bg-rat-panel p-3 flex items-center cursor-pointer hover:bg-rat-dark transition-colors">
                ${portraitHtml}
                <span class="font-mono text-sm flex-1">${name}</span>
                <span class="text-xs bg-rat-dark px-2 py-1 rounded text-rat-text-dim mr-2">${items.length} items</span>
                <i class="fa-solid fa-chevron-down text-xs transition-transform ${isExpanded ? 'rotate-180' : ''}"></i>
            </div>
            <div class="inventory-items-list ${isExpanded ? 'block' : 'hidden'} bg-rat-dark/50 border-t border-rat-border">
                ${itemsHtml}
            </div>
        `;

        if (existingRows.has(pawnId)) {
            const row = existingRows.get(pawnId);
            const listDiv = row.querySelector('.inventory-items-list');
            const header = row.querySelector('.inventory-colonist-header');
            const countBadge = header.querySelector('.text-xs.bg-rat-dark');
            const chevron = header.querySelector('.fa-chevron-down');

            // 1. Update List Content
            if (listDiv.innerHTML !== itemsHtml) {
                listDiv.innerHTML = itemsHtml;
            }

            // 2. Update Badge
            if (countBadge) {
                countBadge.textContent = `${items.length} items`;
            }

            // 3. Update Portrait if needed (e.g. placeholder -> image)
            // Check if we have data but DOM has placeholder div (no img tag)
            const currentPortraitContainer = header.firstElementChild;
            if (portraitData && currentPortraitContainer.tagName === 'DIV') {
                 const temp = document.createElement('div');
                 temp.innerHTML = portraitHtml;
                 if (temp.firstElementChild) {
                     header.replaceChild(temp.firstElementChild, currentPortraitContainer);
                 }
            }

            // 4. Update Expansion State
            if (isExpanded) {
                listDiv.classList.remove('hidden');
                listDiv.classList.add('block');
                chevron.classList.add('rotate-180');
                row.classList.add('expanded');
            } else {
                listDiv.classList.add('hidden');
                listDiv.classList.remove('block');
                chevron.classList.remove('rotate-180');
                row.classList.remove('expanded');
            }

            existingRows.delete(pawnId);
        } else {
            const row = document.createElement('div');
            row.className = `inventory-colonist-row border border-rat-border rounded overflow-hidden mb-2 ${isExpanded ? 'expanded' : ''}`;
            row.dataset.pawnId = pawnId;
            row.innerHTML = createRowContent();
            inventoryContainer.appendChild(row);
            attachInventoryRowListener(row);
        }
    });

    existingRows.forEach(row => row.remove());
}

function attachInventoryRowListener(row) {
    const header = row.querySelector('.inventory-colonist-header');
    header.addEventListener('click', (e) => {
        e.stopPropagation();
        const pawnId = row.dataset.pawnId;
        const list = row.querySelector('.inventory-items-list');
        const icon = row.querySelector('.fa-chevron-down');

        if (openedInventoryColonists.has(pawnId)) {
            openedInventoryColonists.delete(pawnId);
            list.classList.add('hidden');
            list.classList.remove('block');
            icon.classList.remove('rotate-180');
            row.classList.remove('expanded');
        } else {
            openedInventoryColonists.add(pawnId);
            list.classList.remove('hidden');
            list.classList.add('block');
            icon.classList.add('rotate-180');
            row.classList.add('expanded');
        }
    });
}

// Event listeners
backButton.addEventListener('click', () => {
    currentSession = null;
    gameViewer.classList.remove('active');
    sessionSelection.classList.add('active');
    gameScreenshot.src = '';
    hideLoading();
    
    // Clean up active connections
    if (hls) {
        hls.destroy();
        hls = null;
    }
    if (webrtcPeerConnection) {
        webrtcPeerConnection.close();
        webrtcPeerConnection = null;
    }
});

gameScreenshot.addEventListener('click', (e) => {
    if (!currentSession || !cameraBounds) return;
    const rect = gameScreenshot.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const relativeX = clickX / rect.width;
    const relativeY = clickY / rect.height;
    const worldX = Math.round(cameraBounds.minX + (relativeX * cameraBounds.width));
    const worldZ = Math.round(cameraBounds.minZ + ((1 - relativeY) * cameraBounds.height));

    sendAction('ping', JSON.stringify({ x: worldX, z: worldZ }), null);
    createClickRipple(clickX, clickY);
});

function createClickRipple(x, y) {
    const ripple = document.createElement('div');
    ripple.className = 'ping-ripple';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    gameScreenshot.parentElement.appendChild(ripple);
    setTimeout(() => ripple.remove(), 1000);
}

// Frame control functions
function updateFrameSize() {
    const width = parseInt(frameWidth.value);
    const height = parseInt(frameHeight.value);
    const enabled = frameEnabled.checked;

    if (enabled) {
        screenshotFrame.style.width = width + 'px';
        screenshotFrame.style.height = height + 'px';
        gameScreenshot.style.objectFit = 'contain';
    } else {
        screenshotFrame.style.width = '100%';
        screenshotFrame.style.height = '100%';
        gameScreenshot.style.objectFit = 'contain';
    }
    localStorage.setItem('frameEnabled', enabled);
    localStorage.setItem('frameWidth', width);
    localStorage.setItem('frameHeight', height);
}

function loadFramePreferences() {
    const savedEnabled = localStorage.getItem('frameEnabled');
    const savedWidth = localStorage.getItem('frameWidth');
    const savedHeight = localStorage.getItem('frameHeight');

    if (savedEnabled !== null) {
        frameEnabled.checked = savedEnabled === 'true';
    } else {
        frameEnabled.checked = false; // Default to OFF (Full Responsive)
    }
    
    if (savedWidth !== null) frameWidth.value = savedWidth;
    if (savedHeight !== null) frameHeight.value = savedHeight;
    updateFrameSize();
}

frameEnabled.addEventListener('change', updateFrameSize);
frameWidth.addEventListener('input', updateFrameSize);
frameHeight.addEventListener('input', updateFrameSize);
resetFrameBtn.addEventListener('click', () => {
    frameEnabled.checked = false;
    frameWidth.value = 1280;
    frameHeight.value = 720;
    updateFrameSize();
});
loadFramePreferences();

const togglePreviewBtn = document.getElementById('toggle-preview');
const togglePreviewIcon = document.getElementById('toggle-preview-icon');
const screenshotContainer = document.getElementById('screenshot-container');
let previewVisible = true;

togglePreviewBtn.addEventListener('click', () => {
    previewVisible = !previewVisible;
    if (previewVisible) {
        screenshotContainer.classList.remove('hidden');
        togglePreviewBtn.innerHTML = '<span id="toggle-preview-icon">▼</span> HIDE';
    } else {
        screenshotContainer.classList.add('hidden');
        togglePreviewBtn.innerHTML = '<span id="toggle-preview-icon">▲</span> SHOW';
    }
});

// Force CDN Toggle Logic
const forceCdnToggle = document.getElementById('force-cdn-toggle');
if (forceCdnToggle) {
    forceCdnToggle.addEventListener('change', (e) => {
        if (!currentSession) return; // Only act if in a session

        const useCdn = e.target.checked;
        console.log(`[Protocol] Manual switch to ${useCdn ? 'CDN (HLS)' : 'WebRTC (SFU)'}`);

        if (useCdn) {
            // Switch to HLS
            if (webrtcPeerConnection) {
                webrtcPeerConnection.close();
                webrtcPeerConnection = null;
            }
            if (videoSignalSocket) {
                videoSignalSocket.close();
                videoSignalSocket = null;
            }
            initializeHLS();
        } else {
            // Switch to WebRTC
            if (hls) {
                hls.destroy();
                hls = null;
            }
            // Stop native HLS if active
            const video = document.getElementById('game-screenshot');
            if (video) {
                video.pause();
                video.removeAttribute('src'); // Clear native HLS source
                video.load();
            }
            initializeWebSocket();
        }
    });
}

// Map Interaction Logic
let mapState = { scale: 1, x: 0, y: 0, isDragging: false, startX: 0, startY: 0 };
const mapContainer = document.getElementById('visual-viewport');

if (mapContent && mapContainer) {
    // Zoom
    mapContainer.addEventListener('wheel', (e) => {
        if (document.getElementById('view-map').classList.contains('hidden')) return;
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.min(Math.max(mapState.scale * delta, 1), 8); // Min 1x, Max 8x
        
        mapState.scale = newScale;
        updateMapTransform();
    });

    // Pan
    mapContainer.addEventListener('mousedown', (e) => {
        if (e.target.closest('.view-mode-btn') || e.target.closest('button')) return;
        // Only pan in Map Mode
        if (document.getElementById('view-map').classList.contains('hidden')) return;
        
        mapState.isDragging = true;
        mapState.startX = e.clientX - mapState.x;
        mapState.startY = e.clientY - mapState.y;
        mapContent.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
        if (!mapState.isDragging) return;
        e.preventDefault();
        mapState.x = e.clientX - mapState.startX;
        mapState.y = e.clientY - mapState.startY;
        updateMapTransform();
    });

    window.addEventListener('mouseup', () => {
        mapState.isDragging = false;
        if(mapContent) mapContent.style.cursor = 'move';
    });
    
    // Controls
    document.getElementById('map-zoom-in')?.addEventListener('click', () => {
        mapState.scale = Math.min(mapState.scale * 1.2, 8);
        updateMapTransform();
    });
    
    document.getElementById('map-zoom-out')?.addEventListener('click', () => {
        mapState.scale = Math.max(mapState.scale / 1.2, 1);
        updateMapTransform();
    });
    
    document.getElementById('map-reset')?.addEventListener('click', () => {
        mapState = { scale: 1, x: 0, y: 0, isDragging: false, startX: 0, startY: 0 };
        updateMapTransform();
    });
    
    // View Switcher Logic
    document.querySelectorAll('.view-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            document.querySelectorAll('.view-mode-btn').forEach(b => {
                b.classList.remove('active', 'text-rat-green', 'bg-rat-dark');
            });
            btn.classList.add('active', 'text-rat-green', 'bg-rat-dark');
            
            if (mode === 'map') {
                document.getElementById('view-camera').classList.add('hidden');
                document.getElementById('view-map').classList.remove('hidden');
                document.getElementById('map-controls').classList.remove('hidden');
                document.getElementById('live-indicator').classList.add('hidden');
            } else {
                document.getElementById('view-map').classList.add('hidden');
                document.getElementById('view-camera').classList.remove('hidden');
                document.getElementById('map-controls').classList.add('hidden');
                document.getElementById('live-indicator').classList.remove('hidden');
            }
        });
    });
}

function updateMapTransform() {
    if (!mapContent) return;
    mapContent.style.transform = `translate(${mapState.x}px, ${mapState.y}px) scale(${mapState.scale})`;
    
    // Update marker scale inverse
    const overlays = document.getElementById('map-overlays');
    if (overlays) {
        overlays.style.setProperty('--marker-scale', 1 / mapState.scale);
    }
}

async function loadActionPanel() {
    try {
        // We rely on the existing HTML file for the action panel structure, 
        // but we can try to inject style updates after loading if needed.
        const response = await fetch('/components/action-panel.html');
        const html = await response.text();
        document.getElementById('action-panel-container').innerHTML = html;
        initializeActionPanel();
    } catch (error) {
        console.error('Error loading action panel:', error);
    }
}

function initializeActionPanel() {
    const messageInput = document.getElementById('message-input');
    const charCount = document.getElementById('char-count');
    const sendMessageBtn = document.getElementById('send-message-btn');

    if (messageInput && charCount) {
        messageInput.classList.add('bg-rat-black', 'border', 'border-rat-border', 'text-white', 'p-2', 'rounded', 'w-full', 'mb-2');
        if(sendMessageBtn) sendMessageBtn.classList.add('bg-rat-green', 'text-black', 'uppercase', 'py-2', 'px-4', 'rounded', 'hover:bg-white', 'transition-colors');

        messageInput.addEventListener('input', () => {
            const length = messageInput.value.length;
            charCount.textContent = length;
            charCount.style.color = length > 450 ? '#ff3333' : '#888';
        });
        
        // Allow Enter key
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessageBtn.click();
            }
        });
    }

    if (sendMessageBtn) {
        sendMessageBtn.addEventListener('click', () => {
            const message = messageInput.value.trim();
            if (!currentSession) {
                showFeedback('error', 'Link not established');
                return;
            }
            if (message.length < 3) {
                showFeedback('warning', 'Message too short');
                return;
            }
            sendAction('sendLetter', message, sendMessageBtn);
            messageInput.value = '';
            charCount.textContent = '0';
        });
    }

    document.querySelectorAll('.action-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            if (action) sendAction(action, {}, btn);
        });
    });
    loadActionItemIcons();
    updateActionButtonsCosts();
}

function loadActionItemIcons() {
    const itemContainers = document.querySelectorAll('.item-icon-container[data-item-def]');
    for (const container of itemContainers) {
        const defName = container.dataset.itemDef;
        if (!defName) continue;
        const imageData = itemIcons[defName];
        if (imageData && !container.querySelector('img')) {
            const img = document.createElement('img');
            img.src = `data:image/png;base64,${imageData}`;
            img.alt = defName;
            img.className = 'w-8 h-8 object-contain';
            container.innerHTML = '';
            container.appendChild(img);
        }
    }
}

// Password Modal Logic
const passwordModal = document.getElementById('password-modal');
const passwordInput = document.getElementById('interaction-password-input');
const passwordError = document.getElementById('password-error');
const submitPasswordBtn = document.getElementById('submit-password-btn');
const closePasswordModalBtn = document.getElementById('close-password-modal');
let pendingAction = null;

function openPasswordModal() {
    passwordModal.classList.remove('hidden');
    passwordModal.classList.add('flex');
    passwordInput.value = '';
    passwordError.classList.add('hidden');
    passwordInput.focus();
}

function closePasswordModal() {
    passwordModal.classList.add('hidden');
    passwordModal.classList.remove('flex');
    pendingAction = null;
}

async function submitPassword() {
    const password = passwordInput.value;
    if (!password) return;
    sessionPassword = password;
    
    if (pendingAction) {
        const { action, data, buttonElement } = pendingAction;
        closePasswordModal();
        await sendAction(action, data, buttonElement);
    } else {
        closePasswordModal();
    }
}

submitPasswordBtn.addEventListener('click', submitPassword);
closePasswordModalBtn.addEventListener('click', closePasswordModal);
passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitPassword();
});

async function sendAction(action, data, buttonElement) {
    if (!currentSession) {
        showFeedback('error', 'NO SIGNAL');
        return;
    }

    if (sessionRequiresPassword && !sessionPassword) {
        pendingAction = { action, data, buttonElement };
        openPasswordModal();
        return;
    }

    // Economy Check
    const cost = actionCosts[action] || 0;
    if (cost > 0) {
        const currentCoinText = coinBalance ? coinBalance.textContent.replace(/[^0-9]/g, '') : '0';
        const currentCoins = parseInt(currentCoinText);
        
        if (currentCoins < cost) {
            showFeedback('error', `INSUFFICIENT FUNDS (${cost} CREDITS)`);
            return;
        }
    }

    if (buttonElement) {
        buttonElement.disabled = true;
        buttonElement.classList.add('sending');
    }

    try {
        // If there is a cost, process purchase first
        if (cost > 0) {
            const purchaseRes = await fetch(`/api/economy/${encodeURIComponent(currentSession)}/purchase`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, action, cost })
            });
            
            if (!purchaseRes.ok) {
                const errData = await purchaseRes.json();
                showFeedback('error', errData.error || 'PURCHASE FAILED');
                if (buttonElement) {
                    buttonElement.disabled = false;
                    buttonElement.classList.remove('sending');
                }
                return;
            }
        }

        const response = await fetch('/api/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: currentSession, action: action, data: data, password: sessionPassword })
        });

        const result = await response.json();

        if (response.ok) {
            showFeedback('success', 'COMMAND EXECUTED');
            if (buttonElement) {
                buttonElement.classList.add('success-pulse');
                setTimeout(() => buttonElement.classList.remove('success-pulse'), 500);
            }
        } else {
            if (response.status === 401) {
                sessionPassword = null;
                if (pendingAction) {
                    openPasswordModal();
                    passwordError.classList.remove('hidden');
                } else {
                    showFeedback('error', 'ACCESS DENIED');
                }
            } else if (response.status === 403) {
                // Handle disabled action or forbidden access
                showFeedback('error', result.message || 'ACTION DISABLED');
            } else {
                showFeedback('error', result.message || 'COMMAND FAILED');
            }
        }
    } catch (error) {
        console.error('Error:', error);
        showFeedback('error', 'TRANSMISSION ERROR');
    } finally {
        if (buttonElement) {
            setTimeout(() => {
                buttonElement.disabled = false;
                buttonElement.classList.remove('sending');
            }, 500);
        }
    }
}

function showFeedback(type, message) {
    const toast = document.createElement('div');
    toast.className = `feedback-toast ${type}`;
    toast.innerHTML = type === 'success' ? `<i class="fa-solid fa-check"></i> ${message}` : `<i class="fa-solid fa-triangle-exclamation"></i> ${message}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function updateActionButtonsCosts() {
    document.querySelectorAll('.action-btn').forEach(btn => {
        const action = btn.dataset.action;
        const cost = actionCosts[action];
        
        // Check if badge already exists
        let badge = btn.querySelector('.cost-badge');
        
        if (cost > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'cost-badge text-[10px] bg-rat-black border border-rat-yellow text-rat-yellow px-1 rounded absolute top-1 right-1';
                btn.style.position = 'relative';
                btn.appendChild(badge);
            }
            badge.textContent = `${cost}c`;
        } else {
            if (badge) badge.remove();
        }
    });
}

// Username Modal Logic
const usernameModal = document.getElementById('username-modal');
const usernameInput = document.getElementById('username-input');
const usernameError = document.getElementById('username-error');
const submitUsernameBtn = document.getElementById('submit-username-btn');
let pendingSessionId = null;

function openUsernameModal() {
    usernameModal.classList.remove('hidden');
    usernameModal.classList.add('flex');
    usernameInput.value = '';
    usernameError.classList.add('hidden');
    usernameInput.focus();
}

function closeUsernameModal() {
    usernameModal.classList.add('hidden');
    usernameModal.classList.remove('flex');
}

function submitUsername() {
    const val = usernameInput.value.trim().toUpperCase();
    if (val.length < 3) {
        usernameError.textContent = "MINIMUM 3 CHARACTERS";
        usernameError.classList.remove('hidden');
        return;
    }
    if (!/^[A-Z0-9_]+$/.test(val)) {
        usernameError.textContent = "ALPHANUMERIC ONLY";
        usernameError.classList.remove('hidden');
        return;
    }

    username = val;
    localStorage.setItem('username', username);
    closeUsernameModal();

    if (pendingSessionId) {
        startSessionConnection(pendingSessionId);
        pendingSessionId = null;
    }
}

if (submitUsernameBtn) {
    submitUsernameBtn.addEventListener('click', submitUsername);
    usernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') submitUsername();
    });
}

loadActionPanel();

setInterval(() => {
    if (!currentSession) {
        fetch('/api/sessions')
            .then(response => response.json())
            .then(data => {
                sessions = data.sessions;
                renderSessionsList();
            })
            .catch(error => console.error('Error fetching sessions:', error));
    }
}, 5000);

// Pretty Names map (Shared with dashboard)
const prettyNames = {
    'heal_colonist': 'Heal Colonist', 'heal_all': 'Heal All', 'inspire_colonist': 'Inspire Colonist', 'inspire_all': 'Inspire All',
    'send_wanderer': 'Send Wanderer', 'send_refugee': 'Send Refugee',
    'drop_food': 'Drop Food', 'drop_medicine': 'Drop Medicine', 'drop_steel': 'Drop Steel', 'drop_components': 'Drop Components',
    'drop_silver': 'Drop Silver', 'send_legendary': 'Send Legendary', 'send_trader': 'Send Trader',
    'tame_animal': 'Tame Animal', 'spawn_animal': 'Spawn Animal', 'good_event': 'Good Event',
    'weather_clear': 'Clear Skies', 'weather_rain': 'Rain', 'weather_fog': 'Fog', 'weather_snow': 'Snow', 'weather_thunderstorm': 'Thunderstorm',
    'weather_vomit': 'Vomit Rain', 'weather_heat_wave': 'Heat Wave', 'weather_cold_snap': 'Cold Snap',
    'weather_dry_storm': 'Dry Storm', 'weather_foggy_rain': 'Foggy Rain', 'weather_snow_gentle': 'Gentle Snow', 'weather_snow_hard': 'Hard Snow',
    'raid': 'Raid', 'manhunter': 'Manhunter Pack', 'mad_animal': 'Mad Animal', 'solar_flare': 'Solar Flare',
    'eclipse': 'Eclipse', 'toxic_fallout': 'Toxic Fallout', 'flashstorm': 'Flashstorm', 'meteor': 'Meteor Strike',
    'tornado': 'Tornado', 'lightning': 'Lightning Strike', 'random_event': 'Random Event',
    'send_letter': 'Send Letter', 'ping': 'Map Ping',
    // DLC
    'dlc_laborers': 'Empire Laborers', 'dlc_tribute': 'Tribute Collector', 'dlc_anima_tree': 'Anima Tree', 'dlc_mech_cluster': 'Mech Cluster',
    'dlc_ritual': 'Start Ritual', 'dlc_gauranlen': 'Gauranlen Pod', 'dlc_hacker_camp': 'Hacker Quest', 'dlc_insect_jelly': 'Insect Jelly', 'dlc_skylanterns': 'Skylanterns',
    'dlc_diabolus': 'Summon Diabolus', 'dlc_warqueen': 'Summon Warqueen', 'dlc_apocriton': 'Summon Apocriton',
    'dlc_wastepack': 'Drop Wastepacks', 'dlc_sanguophage': 'Sanguophage', 'dlc_genepack': 'Genepack Drop', 'dlc_polux_tree': 'Polux Tree', 'dlc_acidic_smog': 'Acidic Smog', 'dlc_wastepack_infestation': 'Wastepack Hive',
    'dlc_death_pall': 'Death Pall', 'dlc_blood_rain': 'Blood Rain', 'dlc_darkness': 'Unnatural Darkness',
    'dlc_shamblers': 'Shambler Swarm', 'dlc_fleshbeasts': 'Fleshbeasts', 'dlc_pit_gate': 'Pit Gate', 'dlc_chimera': 'Chimera Assault', 'dlc_nociosphere': 'Nociosphere', 'dlc_golden_cube': 'Golden Cube', 'dlc_metalhorror': 'Metalhorror',
    'dlc_gravship': 'Gravship Crash', 'dlc_drones': 'Explosive Drones', 'dlc_orbital_trader': 'Odyssey Trader', 'dlc_orbital_debris': 'Orbital Debris', 'dlc_mechanoid_signal': 'Mech Signal'
};

// QUEUE LOGIC

const queueList = document.getElementById('queue-list');
const btnSubmitRequest = document.getElementById('btn-submit-request');

// Fetch initial queue
function fetchQueueData(sessionId) {
    fetch(`/api/queue/${encodeURIComponent(sessionId)}`)
        .then(res => res.json())
        .then(data => {
            if (data.queue) updateQueueList(data.queue);
        })
        .catch(err => console.error('Error fetching queue:', err));
}

socket.on('queue-update', (data) => {
    if (data.queue) updateQueueList(data.queue);
});

function startQueueTimer(lastProcessedStr, durationSeconds) {
    const timerEl = document.getElementById('queue-timer');
    if (!timerEl) return;

    if (queueTimerInterval) clearInterval(queueTimerInterval);

    // Handle case where lastProcessed is missing (start now)
    const lastProcessed = lastProcessedStr ? new Date(lastProcessedStr).getTime() : Date.now();
    const durationMs = (durationSeconds || 600) * 1000;
    const targetTime = lastProcessed + durationMs;

    function update() {
        const now = Date.now();
        const remaining = targetTime - now;

        if (remaining <= 0) {
             timerEl.textContent = "EXECUTING...";
             return;
        }

        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        
        timerEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    update(); // Initial call
    queueTimerInterval = setInterval(update, 1000);
}

function updateQueueList(queue) {
    const requests = queue.requests || [];
    
    // Update Timer
    startQueueTimer(queue.lastProcessed, queue.settings?.voteDuration);
    
    if (!queueList) return;

    if (requests.length === 0) {
        queueList.innerHTML = `
            <div class="text-center py-10 border border-rat-border border-dashed rounded-lg bg-rat-panel">
                <i class="fa-solid fa-inbox text-4xl text-rat-text-dim mb-4"></i>
                <p class="font-mono text-rat-green">QUEUE EMPTY</p>
                <p class="text-sm text-rat-text-dim mt-2">Be the first to submit a request.</p>
            </div>
        `;
        return;
    }

    // Calculate net votes for each request
    requests.forEach(req => {
        req.upvotes = req.votes.filter(v => v.type === 'upvote').length;
        req.downvotes = req.votes.filter(v => v.type === 'downvote').length;
        req.netVotes = req.upvotes - req.downvotes;
    });

    // Sort by net votes (desc) then time (asc)
    requests.sort((a, b) => {
        if (b.netVotes !== a.netVotes) return b.netVotes - a.netVotes;
        return new Date(a.submittedAt) - new Date(b.submittedAt);
    });

    queueList.innerHTML = requests.map(req => {
        const userUpvoted = req.votes.some(v => v.username === username && v.type === 'upvote');
        const userDownvoted = req.votes.some(v => v.username === username && v.type === 'downvote');

        const upvoteBtnClass = userUpvoted ? 'bg-rat-green text-black' : 'bg-rat-dark text-rat-green border border-rat-green hover:bg-rat-green hover:text-black';
        const downvoteBtnClass = userDownvoted ? 'bg-rat-red text-black' : 'bg-rat-dark text-rat-red border border-rat-red hover:bg-rat-red hover:text-black';
        
        let label, subtext;
        
        if (req.type === 'suggestion') {
             label = req.data; // The idea text
             subtext = 'IDEA';
        } else {
             // Action Logic (fallback if still supporting action queues)
             const snakeKey = req.action.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
             label = prettyNames[snakeKey] || prettyNames[req.action] || req.action;
             subtext = `${req.cost}c`;
        }

        return `
        <div class="bg-rat-panel border border-rat-border rounded-lg p-4 flex justify-between items-center">
            <div class="flex-1 min-w-0 mr-4">
                <div class="flex flex-col gap-1 mb-1">
                    <span class="font-mono text-lg text-white break-words leading-tight">${label}</span>
                    <span class="text-xs bg-rat-dark border border-rat-border px-2 py-0.5 rounded text-rat-text-dim w-fit">${subtext}</span>
                </div>
                <div class="text-xs text-rat-text-dim font-mono">
                    BY: <span class="text-rat-green">${req.submittedBy}</span> • ${new Date(req.submittedAt).toLocaleTimeString()}
                </div>
            </div>
            
            <div class="flex flex-col items-center gap-2">
                <div class="text-center">
                    <div class="text-2xl font-mono font-bold text-white">${req.netVotes}</div>
                    <div class="text-[10px] text-rat-text-dim uppercase">NET VOTES</div>
                </div>
                <div class="flex gap-2">
                    <button class="btn-vote-up px-3 py-1 rounded font-mono font-bold transition-all ${upvoteBtnClass}" 
                        data-id="${req.id}">
                        <i class="fa-solid fa-thumbs-up"></i>
                    </button>
                    <button class="btn-vote-down px-3 py-1 rounded font-mono font-bold transition-all ${downvoteBtnClass}" 
                        data-id="${req.id}">
                        <i class="fa-solid fa-thumbs-down"></i>
                    </button>
                </div>
            </div>
        </div>
    `}).join('');
    
    // Attach listeners
    document.querySelectorAll('.btn-vote-up').forEach(btn => {
        btn.addEventListener('click', () => {
            const requestId = btn.dataset.id;
            // Optimistic update (for simplicity, just re-render queue immediately after)
            fetch(`/api/queue/${encodeURIComponent(currentSession)}/vote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId, username, voteType: 'upvote' })
            }).then(() => fetchQueueData(currentSession)); // Re-fetch to update UI
        });
    });

    document.querySelectorAll('.btn-vote-down').forEach(btn => {
        btn.addEventListener('click', () => {
            const requestId = btn.dataset.id;
            // Optimistic update
            fetch(`/api/queue/${encodeURIComponent(currentSession)}/vote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId, username, voteType: 'downvote' })
            }).then(() => fetchQueueData(currentSession)); // Re-fetch to update UI
        });
    });
}

// ADOPTION LOGIC

// ============================================================================
// MY PAWN UI UPDATER
// ============================================================================

function updateMyPawnView(gameState) {
    if (!myPawnId || !gameState.colonists) return;

    // Find our pawn
    const myPawnEntry = gameState.colonists.find(c => {
        const p = c.colonist || c;
        return String(p.id || p.pawn_id) == String(myPawnId);
    });

    if (!myPawnEntry) {
        document.getElementById('my-pawn-name').textContent = "SIGNAL LOST (PAWN NOT FOUND)";
        return;
    }

    const pawn = myPawnEntry.colonist || myPawnEntry;
    const workInfo = myPawnEntry.colonist_work_info || {};

    // 1. Header Info
    document.getElementById('my-pawn-name').textContent = (pawn.name || 'Unknown').toUpperCase();
    document.getElementById('my-pawn-job').textContent = `ACTIVITY: ${(pawn.current_activity || workInfo.current_job || 'Idle').toUpperCase()}`;
    const pos = pawn.position || {x:0, z:0};
    document.getElementById('my-pawn-location').textContent = `LOC: [${pos.x}, ${pos.z}]`;

    // 2. Vitals
    const health = pawn.health !== undefined ? pawn.health : 0;
    const mood = pawn.mood !== undefined ? pawn.mood : 0;
    
    document.getElementById('my-pawn-health-bar').style.width = `${health * 100}%`;
    document.getElementById('my-pawn-mood-bar').style.width = `${mood * 100}%`;

    // 3. Live Feed & Portrait
    const portraitContainer = document.getElementById('my-pawn-portrait-container');
    const liveViewPanel = document.getElementById('my-pawn-live-view-panel');
    const liveViewContainer = document.getElementById('my-pawn-live-view-container');
    
    const pawnViewData = gameState.pawn_views ? gameState.pawn_views[String(myPawnId)] : null;
    const portraitData = getColonistPortrait(String(myPawnId));

    // Always set header portrait if available (as fallback/identity)
    if (portraitData) {
        portraitContainer.innerHTML = `<img src="data:image/png;base64,${portraitData}" class="w-full h-full object-cover">`;
    } else {
        portraitContainer.innerHTML = `<div class="w-full h-full flex items-center justify-center text-xs text-rat-green animate-pulse">SCANNING</div>`;
    }

    if (liveViewPanel && liveViewContainer) {
        // Always Show Panel when adopted
        liveViewPanel.classList.remove('hidden');

        if (pawnViewData) {
             // Render Live Image
             liveViewContainer.innerHTML = `
                <img src="data:image/jpeg;base64,${pawnViewData}" class="w-full h-full object-cover">
                <div class="absolute inset-0 bg-black/50 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                    <span class="text-rat-green font-mono text-xs border border-rat-green px-2 py-1 rounded bg-black/80">CLICK TO ORDER</span>
                </div>
            `;
            
            // Attach Click Handler for Orders
            const img = liveViewContainer.querySelector('img');
            if (img) {
                img.onclick = (e) => {
                    e.stopPropagation();
                    const rect = img.getBoundingClientRect();
                    const relX = (e.clientX - rect.left) / rect.width;
                    const relY = (e.clientY - rect.top) / rect.height;
                    
                    // World Calculation (Ortho 15 -> Size 30)
                    const worldWidth = 30;
                    const worldHeight = 30;
                    
                    // Pawn is at center of the captured view
                    const targetX = Math.round(pos.x + (relX - 0.5) * worldWidth);
                    const targetZ = Math.round(pos.z + (0.5 - relY) * worldHeight); // Y screen down = Z world down (usually)

                    console.log(`Order: ${targetX}, ${targetZ}`);

                    sendAction('colonist_command', JSON.stringify({
                        type: 'order',
                        pawnId: myPawnId,
                        x: targetX,
                        z: targetZ
                    }));
                    
                    // Visual feedback (Ripple)
                    const ripple = document.createElement('div');
                    ripple.className = 'ping-ripple';
                    ripple.style.position = 'fixed';
                    ripple.style.left = e.clientX + 'px';
                    ripple.style.top = e.clientY + 'px';
                    document.body.appendChild(ripple);
                    setTimeout(() => ripple.remove(), 1000);
                    
                    showFeedback('success', 'COORDINATES TRANSMITTED');
                };
            }
        } else {
             // Render Placeholder (No Signal)
             liveViewContainer.innerHTML = `
                <div class="absolute inset-0 flex items-center justify-center text-rat-text-dim text-xs flex-col gap-2">
                    <i class="fa-solid fa-satellite-dish animate-pulse"></i>
                    <span>NO OPTICAL SIGNAL</span>
                </div>
            `;
        }
    }

    // 4. Needs
    const needsList = document.getElementById('my-pawn-needs-list');
    if (needsList) {
        const needs = [
            { label: 'NUTRITION', value: pawn.food || pawn.hunger },
            { label: 'REST', value: myPawnEntry.sleep }, // sleep is often top-level
            { label: 'RECREATION', value: pawn.joy || pawn.recreation },
            { label: 'COMFORT', value: myPawnEntry.comfort }
        ];

        needsList.innerHTML = needs.map(n => {
            if (n.value === undefined) return '';
            const pct = Math.round(n.value * 100);
            const colorClass = pct < 30 ? 'bg-rat-red' : (pct < 60 ? 'bg-rat-yellow' : 'bg-rat-green');
            return `
                <div>
                    <div class="flex justify-between text-xs font-mono mb-1 text-rat-text-dim">
                        <span>${n.label}</span>
                        <span>${pct}%</span>
                    </div>
                    <div class="h-1 bg-rat-border rounded-full overflow-hidden">
                        <div class="h-full ${colorClass}" style="width: ${pct}%"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // 5. Gear
    // Reuse existing gear logic if possible, or simplified version
    const gearContainer = document.getElementById('my-pawn-gear-layout');
    if (gearContainer && gameState.inventory) {
        // Fetch inventory
        let inv = gameState.inventory[String(myPawnId)];
        if (inv && inv.success && inv.data) inv = inv.data;
        
        let items = inv ? [...(inv.items || []), ...(inv.apparels || []), ...(inv.equipment || [])] : [];
        const equipment = { weapon: null, helmet: null, shirt: null, bodyArmor: null, pants: null, shield: null, belt: null };

        items.forEach(item => {
            const defName = (item.defName || item.def_name || '').toLowerCase();
            const label = (item.label || '').toLowerCase();
            const categories = item.categories || [];

            if (!equipment.weapon && (defName.includes('gun_') || defName.includes('weapon_') || defName.includes('melee') || categories.some(c => c.includes('weapon')))) equipment.weapon = item;
            else if (!equipment.helmet && (defName.includes('helmet') || defName.includes('hat') || label.includes('helmet'))) equipment.helmet = item;
            else if (!equipment.shield && (defName.includes('shield') || label.includes('shield'))) equipment.shield = item;
            else if (!equipment.belt && (defName.includes('belt') || label.includes('belt'))) equipment.belt = item;
            else if (!equipment.pants && (defName.includes('pants') || label.includes('pants'))) equipment.pants = item;
            else if (!equipment.shirt && (defName.includes('shirt') || label.includes('shirt'))) equipment.shirt = item;
            else if (!equipment.bodyArmor && (defName.includes('armor') || defName.includes('vest') || categories.some(c => c.includes('apparel')))) equipment.bodyArmor = item;
        });

        const renderSlot = (item, icon) => {
            if (!item) return `<div class="equip-slot empty"><div class="equip-placeholder">${icon}</div></div>`;
            const label = item.label || 'Unknown';
            // Try to find icon
            const def = item.defName || item.def_name;
            const iconData = itemIcons[def] || itemIcons[label];
            
            if (iconData) {
                return `<div class="equip-slot filled" title="${label}"><img src="data:image/png;base64,${iconData}" class="equip-icon"></div>`;
            }
            return `<div class="equip-slot filled" title="${label}"><div class="equip-placeholder">${icon}</div></div>`;
        };

        gearContainer.innerHTML = `
            <div class="equip-row">${renderSlot(equipment.helmet, '🪖')}</div>
            <div class="equip-row">
                ${renderSlot(equipment.shirt, '👕')}
                ${renderSlot(equipment.bodyArmor, '🦺')}
                ${renderSlot(equipment.weapon, '⚔️')}
            </div>
            <div class="equip-row">
                ${renderSlot(equipment.shield, '🛡️')}
                ${renderSlot(equipment.belt, '📿')}
                ${renderSlot(equipment.pants, '👖')}
            </div>
        `;
    }

    // 6. Work Priorities (Interactive)
    const workList = document.getElementById('my-pawn-work-list');
    const saveBtn = document.getElementById('btn-save-priorities');
    
    // Only render if list is empty or completely changed (to avoid wiping user input while typing)
    const hasInputs = workList.querySelector('input');
    
    if (workList && workInfo.work_priorities && !hasInputs) {
        // Sort by key for consistent order
        const entries = Object.entries(workInfo.work_priorities).sort((a, b) => a[0].localeCompare(b[0]));

        workList.innerHTML = entries.map(([job, rawPrio]) => {
            // Handle potentially complex priority objects (e.g. from RimAPI)
            let prio = rawPrio;
            if (typeof rawPrio === 'object' && rawPrio !== null) {
                prio = rawPrio.priority !== undefined ? rawPrio.priority : (rawPrio.value !== undefined ? rawPrio.value : 3);
            }
            
            return `
            <div class="flex justify-between items-center bg-rat-dark border border-rat-border px-2 py-1 rounded mb-1">
                <span class="text-xs text-rat-text-dim">${job}</span>
                <input type="number" min="0" max="4" value="${prio}" data-job="${job}" 
                    class="work-priority-input w-12 bg-black border border-rat-border text-center text-rat-green font-bold text-xs focus:border-rat-green outline-none">
            </div>
            `;
        }).join('');
        
        // Show save button
        if(saveBtn) {
            saveBtn.classList.remove('hidden');
            saveBtn.onclick = saveWorkPriorities;
        }
    }
}

async function saveWorkPriorities() {
    if (!currentSession || !username || !myPawnId) return;
    
    const inputs = document.querySelectorAll('.work-priority-input');
    const priorities = {};
    
    inputs.forEach(input => {
        const job = input.dataset.job;
        const val = parseInt(input.value);
        if (!isNaN(val)) {
            priorities[job] = val;
        }
    });

    const btn = document.getElementById('btn-save-priorities');
    btn.disabled = true;
    btn.textContent = 'TRANSMITTING...';

    try {
        const res = await fetch(`/api/adoptions/${encodeURIComponent(currentSession)}/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                username, 
                command: 'set_work_priorities', 
                data: { priorities } 
            })
        });

        if (res.ok) {
            showFeedback('success', 'PRIORITIES UPDATED');
        } else {
            showFeedback('error', 'UPDATE FAILED');
        }
    } catch (e) {
        console.error(e);
        showFeedback('error', 'NETWORK ERROR');
    } finally {
        btn.disabled = false;
        btn.textContent = 'SAVE PRIORITY CHANGES';
    }
}