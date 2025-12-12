import { STATE } from './state.js';
import { CONFIG } from './config.js';
import { showFeedback, hideLoading } from './ui.js';

// Local state for stream logic (mirrors the old global variables)
let stuckCounter = 0;
let lastVideoTime = 0;
let streamMonitorInterval = null;

export function initializeStream(sessionId) {
    if (STATE.useHLS) {
        initializeHLS(sessionId);
    } else {
        initializeWebSocket(sessionId);
    }
}

export function stopStream() {
    if (STATE.streamWebSocket) {
        STATE.streamWebSocket.close();
        STATE.streamWebSocket = null;
    }
    
    if (STATE.hls) {
        STATE.hls.destroy();
        STATE.hls = null;
    }

    if (streamMonitorInterval) {
        clearInterval(streamMonitorInterval);
        streamMonitorInterval = null;
    }

    cleanupMediaSource(true);
    STATE.streamConnected = false;
    updateStreamStatus(false);
}

// ============================================================================
// WEBSOCKET & MSE LOGIC
// ============================================================================

function initializeWebSocket(sessionId) {
    if (STATE.streamWebSocket) {
        STATE.streamWebSocket.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Direct WebSocket Stream (Binary fMP4)
    STATE.streamWebSocket = new WebSocket(`${protocol}//${window.location.host}/stream?session=${sessionId}`);
    STATE.streamWebSocket.binaryType = 'arraybuffer'; // Crucial for MSE

    STATE.streamWebSocket.onopen = () => {
        console.log('[Stream] WebSocket Connected');
        STATE.streamConnected = true;
        STATE.useWebSocket = true;
        updateStreamStatus(true);
        hideLoading();
        showFeedback('success', 'Live Stream Connected');
        
        // Initialize MSE immediately
        initializeMediaSource();
        startStreamMonitor();
    };

    STATE.streamWebSocket.onmessage = (event) => {
        // Direct binary data from server (relayed from go-sidecar)
        handleH264Data(event.data);
    };
    
    STATE.streamWebSocket.onclose = (event) => {
         console.log(`[Stream] WebSocket Closed (Code: ${event.code})`);
         STATE.streamConnected = false;
         updateStreamStatus(false);
         cleanupMediaSource(true);
         
         if (streamMonitorInterval) {
            clearInterval(streamMonitorInterval);
            streamMonitorInterval = null;
        }

         // Simple auto-reconnect
         if (STATE.currentSession && !STATE.useHLS) {
             setTimeout(() => {
                 console.log('[Stream] Attempting to reconnect...');
                 initializeWebSocket(sessionId);
             }, 2000);
         }
    };

    STATE.streamWebSocket.onerror = (error) => {
        console.error('[Stream] WebSocket Error:', error);
        showFeedback('error', 'Stream Connection Error');
    };
}

// ============================================================================
// MEDIA SOURCE EXTENSIONS (MSE)
// ============================================================================

function initializeMediaSource() {
    // Baseline Profile Level 3.0 (Most compatible)
    const mimeCodec = 'video/mp4; codecs="avc1.42E01E"'; 
    
    if (!window.MediaSource || !MediaSource.isTypeSupported(mimeCodec)) {
        console.error(`[MSE] MimeType ${mimeCodec} not supported`);
        showFeedback('error', 'Video streaming not supported');
        return;
    }
    
    if (STATE.mediaSource) {
        try {
            if (STATE.mediaSource.readyState === 'open') STATE.mediaSource.endOfStream();
        } catch(e) {}
        STATE.mediaSource = null;
    }

    STATE.mediaSource = new MediaSource();
    const video = document.getElementById('game-screenshot');

    if (video.src && video.src.startsWith('blob:')) {
        URL.revokeObjectURL(video.src);
    }
    video.src = URL.createObjectURL(STATE.mediaSource);
    video.style.display = 'block';
    
    // Force video element to be visible and ready
    video.controls = false;
    video.autoplay = true;
    video.muted = true; // Required for autoplay
    video.playsInline = true;

    const streamDisabledOverlay = document.getElementById('stream-disabled');
    if (streamDisabledOverlay) {
        streamDisabledOverlay.classList.remove('flex');
        streamDisabledOverlay.classList.add('hidden');
    }

    STATE.mediaSource.addEventListener('sourceopen', () => {
        console.log(`[MSE] Media Source opened (readyState: ${STATE.mediaSource.readyState})`);
        try {
            if (STATE.sourceBuffer) return; 

            STATE.sourceBuffer = STATE.mediaSource.addSourceBuffer(mimeCodec);
            STATE.sourceBuffer.mode = 'segments';
            
            STATE.sourceBuffer.addEventListener('updateend', () => {
                try {
                    if (STATE.sourceBuffer && !STATE.sourceBuffer.updating && STATE.mediaSource.readyState === 'open') {
                        const video = document.getElementById('game-screenshot');
                        // Automatically start playback when buffer is available
                        if (STATE.sourceBuffer.buffered.length > 0 && video.paused && video.readyState >= 2) {
                            video.play().catch(e => console.log('[MSE] Play prevented:', e));
                        }
                    }
                } catch(e) {
                     console.warn('[MSE] Error in updateend:', e);
                }
                processH264Queue();
            });

            STATE.sourceBuffer.addEventListener('error', (e) => {
                console.error('[MSE] SourceBuffer error:', e);
            });

            // Re-append Init Segment on restart/late join
            if (STATE.cachedInitSegment) {
                console.log(`[MSE] Restoring Init Segment (${STATE.cachedInitSegment.byteLength} bytes)`);
                STATE.h264Queue.unshift(STATE.cachedInitSegment);
            }

            if (STATE.stickyBuffer.length > 0) {
                parseAtoms();
            }
            
            if (STATE.h264Queue.length > 0) {
                processH264Queue();
            }
            
        } catch (error) {
            console.error('[MSE] Failed to create SourceBuffer:', error);
        }
    });
}

function handleH264Data(arrayBuffer) {
    try {
        // Recovery: Restart MediaSource if closed but we have buffer state
        if (!STATE.mediaSource || (STATE.mediaSource.readyState === 'closed' && STATE.sourceBuffer)) {
            console.warn('[MSE] MediaSource is closed. Attempting restart...');
            cleanupMediaSource();
            initializeMediaSource();
            STATE.stickyBuffer = new Uint8Array(0);
            STATE.initSegmentReceived = !!STATE.cachedInitSegment; 
            return;
        }

        if (STATE.mediaSource.readyState !== 'open') {
             const chunk = new Uint8Array(arrayBuffer);
             const newBuffer = new Uint8Array(STATE.stickyBuffer.length + chunk.length);
             newBuffer.set(STATE.stickyBuffer, 0);
             newBuffer.set(chunk, STATE.stickyBuffer.length);
             STATE.stickyBuffer = newBuffer;
             return;
        }

        // Diagnostic: First Packet
        if (!STATE.initSegmentReceived && STATE.stickyBuffer.length === 0) {
             const debugView = new Uint8Array(arrayBuffer.slice(0, 8));
             const asciiHeader = Array.from(debugView).map(b => b >= 32 && b <= 126 ? String.fromCharCode(b) : '.').join('');
             console.log(`[MSE DEBUG] First Packet Received (${arrayBuffer.byteLength} bytes). Header: ${asciiHeader}`);
        }

        const chunk = new Uint8Array(arrayBuffer);
        const newBuffer = new Uint8Array(STATE.stickyBuffer.length + chunk.length);
        newBuffer.set(STATE.stickyBuffer, 0);
        newBuffer.set(chunk, STATE.stickyBuffer.length);
        STATE.stickyBuffer = newBuffer;

        parseAtoms();

    } catch (error) {
        console.error('[MSE] handleH264Data error:', error);
    }
}

function parseAtoms() {
    while (true) {
        if (STATE.stickyBuffer.length < 8) break;

        const view = new DataView(STATE.stickyBuffer.buffer, STATE.stickyBuffer.byteOffset, STATE.stickyBuffer.byteLength);
        const atomSize = view.getUint32(0, false);

        if (atomSize === 0) {
            STATE.stickyBuffer = new Uint8Array(0);
            break;
        }
        
        if (STATE.stickyBuffer.length < atomSize) break;

        const atom = STATE.stickyBuffer.slice(0, atomSize);
        STATE.stickyBuffer = STATE.stickyBuffer.slice(atomSize);

        const atomType = String.fromCharCode(atom[4], atom[5], atom[6], atom[7]);
        
        if (atomType === 'ftyp' || atomType === 'moov') {
            console.log(`[MSE] Received Init Atom: ${atomType} (${atomSize} bytes)`);
            STATE.initSegmentReceived = true;

            if (atomType === 'ftyp') {
                STATE.cachedInitSegment = atom;
                continue; 
            } else if (STATE.cachedInitSegment && atomType === 'moov') {
                const newCache = new Uint8Array(STATE.cachedInitSegment.length + atom.length);
                newCache.set(STATE.cachedInitSegment, 0);
                newCache.set(atom, STATE.cachedInitSegment.length);
                STATE.cachedInitSegment = newCache;
                STATE.h264Queue.push(newCache);
                continue; 
            }
        } 
        else if (atomType === 'moof') {
             if (!STATE.initSegmentReceived && !STATE.cachedInitSegment) {
                 // Drop packet if no init segment yet
                 continue; 
             }
        }

        STATE.h264Queue.push(atom);
    }

    processH264Queue();
}

function processH264Queue() {
    if (!STATE.sourceBuffer || STATE.sourceBuffer.updating || STATE.h264Queue.length === 0) {
        return;
    }
    
    if (!STATE.mediaSource || STATE.mediaSource.readyState !== 'open') {
        return;
    }

    const nextChunk = STATE.h264Queue.shift();
    try {
        STATE.sourceBuffer.appendBuffer(nextChunk);
        
        const video = document.getElementById('game-screenshot');
        video.style.display = 'block';
        
        const lastUpdate = document.getElementById('last-update');
        if(lastUpdate) lastUpdate.textContent = `LAST UPDATE: ${new Date().toLocaleTimeString()} [LIVE FEED]`;
        
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
            STATE.h264Queue.unshift(nextChunk); // Retry
        } else if (err.name === 'InvalidStateError') {
            console.error('[MSE] Invalid State. Resetting.');
            cleanupMediaSource();
            initializeMediaSource();
        }
    }
}

function removeOldBuffer() {
    if (!STATE.sourceBuffer || STATE.sourceBuffer.updating) return;
    
    const video = document.getElementById('game-screenshot');
    if (!video) return;

    try {
        const buffered = STATE.sourceBuffer.buffered;
        if (buffered.length > 0) {
            const start = buffered.start(0);
            const currentTime = video.currentTime;
            
            // Keep last 30 seconds
            const removeUntil = Math.max(start, currentTime - 30);
            
            if (removeUntil > start) {
                console.log(`[MSE] Removing buffer from ${start.toFixed(2)} to ${removeUntil.toFixed(2)}`);
                STATE.sourceBuffer.remove(start, removeUntil);
            }
        }
    } catch (e) {
        console.error('[MSE] Error removing buffer:', e);
    }
}

function cleanupMediaSource(full = false) {
    console.log(`[MSE] Cleaning up (Full: ${full})`);
    if (STATE.sourceBuffer) {
        try {
            if (STATE.mediaSource && STATE.mediaSource.readyState === 'open') {
                STATE.mediaSource.removeSourceBuffer(STATE.sourceBuffer);
            }
        } catch(e) {}
        STATE.sourceBuffer = null;
    }
    STATE.h264Queue = [];
    if (full) {
        STATE.cachedInitSegment = null;
        STATE.initSegmentReceived = false;
        STATE.stickyBuffer = new Uint8Array(0);
    }
}

function startStreamMonitor() {
    if (streamMonitorInterval) clearInterval(streamMonitorInterval);

    stuckCounter = 0;
    lastVideoTime = 0;

    streamMonitorInterval = setInterval(() => {
        const video = document.getElementById('game-screenshot');
        if (!video || !STATE.sourceBuffer || !STATE.useWebSocket) return;

        try {
            const buffered = STATE.sourceBuffer.buffered;
            if (buffered.length > 0) {
                const bufferEnd = buffered.end(buffered.length - 1);
                const currentTime = video.currentTime;
                const latency = bufferEnd - currentTime;

                // Detect stuck playback
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
                    // Try to auto-resume if paused
                    console.log('[MSE] Video paused with buffer. Attempting play...');
                    video.play().catch(() => {
                        if (!video.muted) {
                             video.muted = true;
                             video.play().catch(() => {});
                        }
                    });
                    
                    if (latency > 1.0) {
                        video.currentTime = bufferEnd - 0.1;
                    }
                }
                lastVideoTime = currentTime;

                // Aggressive latency control
                if (latency > 0.6 && !video.paused) {
                    console.log(`[MSE] Latency high (${latency.toFixed(2)}s), seeking to live edge`);
                    video.currentTime = bufferEnd - 0.1;
                }
            }
        } catch (e) {
            // console.error('[MSE] Monitor error:', e);
        }
    }, 1000);
}

function updateStreamStatus(active) {
    // Logic to update UI indicator
}

function initializeHLS(sessionId) {
    const video = document.getElementById('game-screenshot');
    // Using sessionId as the stream key (folder name) in Pull Zone
    const hlsUrl = `${CONFIG.BUNNY_PULL_ZONE}/${sessionId}/playlist.m3u8`;

    if (Hls.isSupported()) {
        if (STATE.hls) STATE.hls.destroy();
        
        STATE.hls = new Hls({
            lowLatencyMode: false, // Stable mode
            backBufferLength: 60,
            maxBufferLength: 60,
            maxMaxBufferLength: 120,
            manifestLoadingTimeOut: 10000
        });
        
        STATE.hls.loadSource(hlsUrl);
        STATE.hls.attachMedia(video);
        
        STATE.hls.on(Hls.Events.MEDIA_ATTACHED, () => {
             video.muted = true;
             video.play().catch(() => {});
        });

        STATE.hls.on(Hls.Events.MANIFEST_PARSED, () => {
            hideLoading();
            showFeedback('success', 'CDN Stream Connected');
            STATE.streamConnected = true;
        });
        
        STATE.hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                 switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        console.log('[HLS] Network error, trying to recover...');
                        STATE.hls.startLoad();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        console.log('[HLS] Media error, trying to recover...');
                        STATE.hls.recoverMediaError();
                        break;
                    default:
                        STATE.hls.destroy();
                        break;
                }
            }
        });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = hlsUrl;
        video.addEventListener('loadedmetadata', () => {
            video.play();
            hideLoading();
        });
    }
}