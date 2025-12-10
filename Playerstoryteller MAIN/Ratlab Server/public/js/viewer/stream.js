import { STATE } from './state.js';
import { CONFIG } from './config.js';
import { showFeedback, hideLoading } from './ui.js';
import { updateConnectionStatus } from './ui.js';

export function initializeStream(sessionId) {
    if (STATE.useHLS) {
        initializeHLS(sessionId);
    } else {
        // Fallback or explicit WebSocket/WebRTC (Currently WS/MSE is the primary low-latency method)
        // Note: The original app.js had WebRTC code, but based on recent memories/commits, 
        // the go-sidecar sends fMP4 via WebSocket. So we implement the WebSocket + MSE logic here.
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
    // The go-sidecar usually runs on a different port or proxied. 
    // Assuming the Node server proxies it or we connect to a known port.
    // Looking at original app.js, it might have been connecting to `location.host`.
    // Let's assume the Node server proxies /ws/stream or similar, OR we connect to the go-sidecar port.
    // WAIT: The memory says "go-sidecar sends fMP4 streams via WebSocket to Ratlab Server".
    // So the Client connects to Ratlab Server.
    
    // In original app.js, there was `videoSignalSocket` for WebRTC signaling.
    // But for direct fMP4 via WebSocket, we need the endpoint.
    // If the server forwards it, great. 
    // Let's assume a standard path or the same socket connection logic if it was built-in.
    
    // RE-READING APP.JS (from context memory/search):
    // It seems the original app.js had `videoSignalSocket` for WebRTC.
    // BUT, the go-sidecar memory says "fMP4 streams via WebSocket".
    // If we are strictly porting the working MSE logic found in `app.js` (lines 680+), 
    // we need to see how `handleH264Data` was called.
    // It was called from `webrtcDataChannel.onmessage` in the `app.js` snippet I read.
    // "webrtcDataChannel.onmessage = (e) => { handleH264Data(e.data); };"
    
    // SO: The current implementation uses WebRTC Data Channels to transport the fMP4 atoms.
    // We need to port the WebRTC setup too.
    
    initializeWebRTC(sessionId);
}

let webrtcPeerConnection = null;
let webrtcDataChannel = null;
let videoSignalSocket = null;

function initializeWebRTC(sessionId) {
    if (videoSignalSocket) {
        videoSignalSocket.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    videoSignalSocket = new WebSocket(`${protocol}//${window.location.host}/ws/stream?sessionId=${sessionId}`);

    videoSignalSocket.onopen = () => {
        console.log('[WebRTC] Signaling Connected');
    };

    videoSignalSocket.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'offer') {
            await handleSFUOffer(msg.offer, sessionId);
        }
    };
    
    videoSignalSocket.onclose = () => {
         console.log('[WebRTC] Signaling Closed');
    };
}

async function handleSFUOffer(offer, sessionId) {
    if (webrtcPeerConnection) {
        webrtcPeerConnection.close();
    }

    webrtcPeerConnection = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    });

    webrtcPeerConnection.onicecandidate = (event) => {
        if (event.candidate && videoSignalSocket.readyState === WebSocket.OPEN) {
            videoSignalSocket.send(JSON.stringify({
                type: 'ice-candidate',
                candidate: event.candidate,
                sessionId: sessionId
            }));
        }
    };

    webrtcPeerConnection.onconnectionstatechange = () => {
        console.log('[WebRTC] Connection State:', webrtcPeerConnection.connectionState);
        if (webrtcPeerConnection.connectionState === 'connected') {
            STATE.streamConnected = true;
            STATE.useWebSocket = true; // Use this flag to suppress socket.io screenshots
            hideLoading();
            updateStreamStatus(true);
            showFeedback('success', 'Live Stream Connected');
        } else if (['failed', 'disconnected', 'closed'].includes(webrtcPeerConnection.connectionState)) {
            STATE.streamConnected = false;
            STATE.useWebSocket = false;
            updateStreamStatus(false);
            cleanupMediaSource(true);
        }
    };

    webrtcPeerConnection.ondatachannel = (event) => {
        webrtcDataChannel = event.channel;
        webrtcDataChannel.binaryType = 'arraybuffer';

        webrtcDataChannel.onopen = () => {
            console.log('[WebRTC] Data Channel Open -> Init MSE');
            initializeMediaSource();
        };

        webrtcDataChannel.onmessage = (e) => {
            handleH264Data(e.data);
        };
    };

    await webrtcPeerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await webrtcPeerConnection.createAnswer();
    await webrtcPeerConnection.setLocalDescription(answer);

    if (videoSignalSocket.readyState === WebSocket.OPEN) {
        videoSignalSocket.send(JSON.stringify({
            type: 'answer',
            answer: answer,
            sessionId: sessionId
        }));
    }
}

// ============================================================================
// MEDIA SOURCE EXTENSIONS (MSE)
// ============================================================================

function initializeMediaSource() {
    const mimeCodec = 'video/mp4; codecs="avc1.42E01E"'; 
    
    if (!window.MediaSource || !MediaSource.isTypeSupported(mimeCodec)) {
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
    video.controls = false;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;

    const streamDisabledOverlay = document.getElementById('stream-disabled');
    if (streamDisabledOverlay) {
        streamDisabledOverlay.classList.remove('flex');
        streamDisabledOverlay.classList.add('hidden');
    }

    STATE.mediaSource.addEventListener('sourceopen', () => {
        try {
            if (STATE.sourceBuffer) return; 

            STATE.sourceBuffer = STATE.mediaSource.addSourceBuffer(mimeCodec);
            STATE.sourceBuffer.mode = 'segments';
            
            STATE.sourceBuffer.addEventListener('updateend', () => {
                if (STATE.sourceBuffer && !STATE.sourceBuffer.updating && STATE.mediaSource.readyState === 'open') {
                    const video = document.getElementById('game-screenshot');
                    if (STATE.sourceBuffer.buffered.length > 0 && video.paused && video.readyState >= 2) {
                        video.play().catch(e => {});
                    }
                }
                processH264Queue();
            });

            // Re-append Init Segment on restart/late join
            if (STATE.cachedInitSegment) {
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
        if (!STATE.mediaSource || (STATE.mediaSource.readyState === 'closed' && STATE.sourceBuffer)) {
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
            removeOldBuffer();
            STATE.h264Queue.unshift(nextChunk);
        } else if (err.name === 'InvalidStateError') {
            cleanupMediaSource();
        }
    }
}

function removeOldBuffer() {
    if (STATE.sourceBuffer && !STATE.sourceBuffer.updating && STATE.sourceBuffer.buffered.length > 0) {
        try {
            const start = STATE.sourceBuffer.buffered.start(0);
            const end = STATE.sourceBuffer.buffered.end(0);
            if (end - start > 10) {
                STATE.sourceBuffer.remove(start, end - 5);
            }
        } catch (e) {}
    }
}

function cleanupMediaSource(full = false) {
    if (STATE.sourceBuffer) {
        try {
            if (STATE.mediaSource.readyState === 'open') {
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

function updateStreamStatus(active) {
    // Logic to update UI indicator if it exists
    // Currently handled mostly by feedback toasts
}

function initializeHLS(sessionId) {
    const video = document.getElementById('game-screenshot');
    const hlsUrl = `${CONFIG.BUNNY_PULL_ZONE}/${sessionId}/stream.m3u8`;

    if (Hls.isSupported()) {
        if (STATE.hls) STATE.hls.destroy();
        
        STATE.hls = new Hls({
            lowLatencyMode: true,
            backBufferLength: 90
        });
        
        STATE.hls.loadSource(hlsUrl);
        STATE.hls.attachMedia(video);
        
        STATE.hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().catch(() => {});
            hideLoading();
            showFeedback('success', 'HLS Stream Connected');
            STATE.streamConnected = true;
        });
        
        STATE.hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                 showFeedback('error', 'Stream Error');
                 STATE.streamConnected = false;
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
