const WebSocket = require('ws');
const url = require('url');
const sessionStore = require('../store/sessionStore');
const log = require('../utils/logger');

function setupStreamService() {
    const streamWss = new WebSocket.Server({ noServer: true });

    streamWss.on('connection', (ws, req) => {
        const params = url.parse(req.url, true).query;

        // SECURITY FIX: Accept session ID and stream key from headers (preferred) or query params (fallback)
        const sessionId = req.headers['session-id'] || params.session || 'default';

        let streamKey = params.key || '';
        const authHeader = req.headers['authorization'];
        if (authHeader && authHeader.startsWith('Bearer ')) {
            streamKey = authHeader.substring(7); // Extract token from "Bearer <token>"
        }

        const isStreamer = !!streamKey; // Streamers provide a key

        log('info', `[WS Stream] ${isStreamer ? 'Streamer' : 'Viewer'} connected to session: ${sessionId}`);

        // Get or create stream session (WebSocket references)
        if (!sessionStore.streamSessions.has(sessionId)) {
            sessionStore.streamSessions.set(sessionId, {
                streamer: null,
                viewers: new Set(),
                initPackets: []
            });
        }

        const streamSession = sessionStore.streamSessions.get(sessionId);

        if (isStreamer) {
            handleStreamer(ws, streamSession, sessionId);
        } else {
            handleViewer(ws, streamSession, sessionId);
        }

        ws.on('error', (error) => {
            console.error(`[WS Stream] WebSocket error:`, error);
        });
    });

    return streamWss;
}

function handleStreamer(ws, streamSession, sessionId) {
    // Register as streamer
    if (streamSession.streamer) {
        log('warn', `[WS Stream] Replacing existing streamer for session: ${sessionId}`);
        streamSession.streamer.close();
    }
    streamSession.streamer = ws;
    
    // Reset init packets on new streamer connection
    streamSession.initPackets = [];

    // Send initial segments to new viewers when they join
    let packetCount = 0;
    const MAX_BUFFERED_AMOUNT = 64 * 1024; // 64KB

    ws.on('message', (data) => {
        packetCount++;
        const isInitPacket = packetCount <= 30; // Increased to 30 to cover larger init segments

        // Heartbeat: Keep session alive every ~1 second (30 packets @ 30fps)
        if (packetCount % 30 === 0) {
            sessionStore.updateSession(sessionId, {});
        }

        // Cache initialization segments (first 15 packets)
        // This ensures late joiners get the 'ftyp' and 'moov' atoms
        if (isInitPacket) {
            streamSession.initPackets.push(data);
        }

        // Broadcast to all viewers
        streamSession.viewers.forEach(viewer => {
            if (viewer.readyState === WebSocket.OPEN) {
                // Backpressure: Check if viewer is keeping up
                if (!isInitPacket && viewer.bufferedAmount > MAX_BUFFERED_AMOUNT) {
                    // Drop frame for slow viewer
                    return;
                }

                viewer.send(data, { binary: true }, (err) => {
                     if (err) log('error', `[WS Stream] Send error: ${err.message}`);
                });
            }
        });
    });

    ws.on('close', () => {
        log('info', `[WS Stream] Streamer disconnected from session: ${sessionId}`);
        streamSession.streamer = null;
        streamSession.initPackets = []; // Clear cache

        // Clean up empty sessions
        if (streamSession.viewers.size === 0) {
            sessionStore.streamSessions.delete(sessionId);
        }
    });
}

function handleViewer(ws, streamSession, sessionId) {
    // Register as viewer
    streamSession.viewers.add(ws);
    log('info', `[WS Stream] Viewer added to session: ${sessionId} (${streamSession.viewers.size} total)`);

    // Send cached init segments immediately
    if (streamSession.initPackets && streamSession.initPackets.length > 0) {
        log('info', `[WS Stream] Sending cached init segments (${streamSession.initPackets.length}) to new viewer`);
        streamSession.initPackets.forEach(pkt => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(pkt, { binary: true });
            }
        });
    }

    ws.on('close', () => {
        log('info', `[WS Stream] Viewer disconnected from session: ${sessionId}`);
        streamSession.viewers.delete(ws);

        // Clean up empty sessions
        if (!streamSession.streamer && streamSession.viewers.size === 0) {
            sessionStore.streamSessions.delete(sessionId);
        }
    });
}

module.exports = setupStreamService;
