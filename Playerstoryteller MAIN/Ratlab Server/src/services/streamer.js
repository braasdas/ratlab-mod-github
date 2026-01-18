const WebSocket = require('ws');
const url = require('url');
const sessionStore = require('../store/sessionStore');
const log = require('../utils/logger');

/**
 * Stream Service for fMP4 WebSocket relay.
 *
 * The Rust sidecar sends properly formatted fMP4 segments:
 * - Init Segment: ftyp + moov (combined, starts with 'ftyp')
 * - Media Segments: moof + mdat (combined, starts with 'moof')
 *
 * This service:
 * 1. Receives segments from streamer (Rust sidecar)
 * 2. Identifies and caches the init segment for late joiners
 * 3. Relays all segments to connected viewers
 * 4. Handles backpressure for slow viewers
 */

function setupStreamService() {
    const streamWss = new WebSocket.Server({ noServer: true });

    streamWss.on('connection', (ws, req) => {
        const params = url.parse(req.url, true).query;

        const sessionId = req.headers['session-id'] || params.session || 'default';

        let streamKey = params.key || '';
        const authHeader = req.headers['authorization'];
        if (authHeader && authHeader.startsWith('Bearer ')) {
            streamKey = authHeader.substring(7);
        }

        const isStreamer = !!streamKey;

        log('info', `[Stream] ${isStreamer ? 'Streamer' : 'Viewer'} connected to session: ${sessionId}`);

        if (!sessionStore.streamSessions.has(sessionId)) {
            sessionStore.streamSessions.set(sessionId, {
                streamer: null,
                viewers: new Set(),
                initSegment: null  // Single init segment (ftyp + moov)
            });
        }

        const streamSession = sessionStore.streamSessions.get(sessionId);

        if (isStreamer) {
            handleStreamer(ws, streamSession, sessionId);
        } else {
            handleViewer(ws, streamSession, sessionId);
        }

        ws.on('error', (error) => {
            log('error', `[Stream] WebSocket error: ${error.message}`);
        });
    });

    return streamWss;
}

/**
 * Identify segment type by checking the first atom's type.
 * ftyp (0x66747970) = Init segment
 * moof (0x6D6F6F66) = Media segment
 */
function identifySegmentType(data) {
    if (data.length < 8) return 'unknown';

    // Atom type is at bytes 4-7
    const atomType = data.slice(4, 8).toString('ascii');

    if (atomType === 'ftyp') {
        return 'init';
    } else if (atomType === 'moof') {
        return 'media';
    }

    return 'unknown';
}

function handleStreamer(ws, streamSession, sessionId) {
    // Register as streamer (replace existing if any)
    if (streamSession.streamer) {
        log('warn', `[Stream] Replacing existing streamer for session: ${sessionId}`);
        try {
            streamSession.streamer.close();
        } catch (e) {}
    }
    streamSession.streamer = ws;

    // Clear cached init segment on new streamer connection
    streamSession.initSegment = null;

    let packetCount = 0;
    const MAX_BUFFERED_AMOUNT = 64 * 1024; // 64KB backpressure threshold

    ws.on('message', (data) => {
        packetCount++;
        const buf = Buffer.from(data);

        // Identify segment type
        const segmentType = identifySegmentType(buf);

        if (segmentType === 'init') {
            // Cache the init segment (replaces any previous)
            log('info', `[Stream] Received init segment (${buf.length} bytes) for session: ${sessionId}`);
            streamSession.initSegment = data;
        }

        // Heartbeat: Keep session alive every ~1 second (30 packets @ 30fps)
        if (packetCount % 30 === 0) {
            sessionStore.updateSession(sessionId, {});
        }

        // Broadcast to all viewers
        const viewerCount = streamSession.viewers.size;
        if (viewerCount > 0) {
            streamSession.viewers.forEach(viewer => {
                if (viewer.readyState === WebSocket.OPEN) {
                    // Backpressure: Drop media frames for slow viewers (but never drop init)
                    if (segmentType === 'media' && viewer.bufferedAmount > MAX_BUFFERED_AMOUNT) {
                        return; // Skip this viewer for this frame
                    }

                    viewer.send(data, { binary: true }, (err) => {
                        if (err) log('error', `[Stream] Send error: ${err.message}`);
                    });
                }
            });
        }
    });

    ws.on('close', () => {
        log('info', `[Stream] Streamer disconnected from session: ${sessionId}`);
        streamSession.streamer = null;

        // Keep init segment cached for potential reconnects
        // Only clear when session is fully cleaned up

        // Clean up empty sessions
        if (streamSession.viewers.size === 0) {
            sessionStore.streamSessions.delete(sessionId);
        }
    });
}

function handleViewer(ws, streamSession, sessionId) {
    // Register as viewer
    streamSession.viewers.add(ws);
    log('info', `[Stream] Viewer joined session: ${sessionId} (${streamSession.viewers.size} viewers)`);

    // Debug: Log the state of init segment cache
    log('info', `[Stream] Init segment cached: ${streamSession.initSegment ? 'YES (' + streamSession.initSegment.length + ' bytes)' : 'NO'}`);

    // Send cached init segment immediately if available
    if (streamSession.initSegment) {
        log('info', `[Stream] Sending cached init segment (${streamSession.initSegment.length} bytes) to new viewer`);
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(streamSession.initSegment, { binary: true }, (err) => {
                if (err) log('error', `[Stream] Error sending init segment: ${err.message}`);
                else log('info', `[Stream] Init segment sent successfully to viewer`);
            });
        } else {
            log('warn', `[Stream] WebSocket not open when trying to send init segment (state: ${ws.readyState})`);
        }
    } else {
        log('warn', `[Stream] No init segment cached for session: ${sessionId} - viewer must wait for next init`);
    }


    ws.on('close', () => {
        log('info', `[Stream] Viewer left session: ${sessionId}`);
        streamSession.viewers.delete(ws);

        // Clean up empty sessions
        if (!streamSession.streamer && streamSession.viewers.size === 0) {
            sessionStore.streamSessions.delete(sessionId);
        }
    });
}

module.exports = setupStreamService;
