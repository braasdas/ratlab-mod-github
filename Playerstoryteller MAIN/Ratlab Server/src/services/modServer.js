const WebSocket = require('ws');
const url = require('url');
const sessionStore = require('../store/sessionStore');
const log = require('../utils/logger');
const { MOD_PORT } = require('../config/config');

function startModServer(io) {
    const modWss = new WebSocket.Server({ port: MOD_PORT });

    modWss.on('connection', (ws, req) => {
        // Parse query params for fallback auth
        const params = url.parse(req.url, true).query;
        
        let sessionId = req.headers['session-id'] || params.sessionId;
        let streamKey = params.streamKey;
        
        // Extract Bearer token if available
        const authHeader = req.headers['authorization'];
        if (authHeader && authHeader.startsWith('Bearer ')) {
            streamKey = authHeader.substring(7);
        }

        const interactionPassword = req.headers['x-interaction-password'] || params.interactionPassword;
        
        // Logic: Default to PUBLIC unless explicitly set to 'false'
        const headerPublic = req.headers['is-public'];
        const paramPublic = params.isPublic;
        const isPublic = (headerPublic !== 'false') && (paramPublic !== 'false');

        if (!sessionId || !streamKey) {
            log('warn', `[WS Mod] Rejected connection. Missing params/headers. ID: ${sessionId}, Key: ${streamKey ? '***' : 'null'}`);
            ws.close();
            return;
        }

        // Initialize or Update Session in Store
        let session = sessionStore.getSession(sessionId);
        
        if (!session) {
            log('info', `[WS Mod] New game session started: ${sessionId} (${isPublic ? 'PUBLIC' : 'PRIVATE'})`);
            session = sessionStore.createSession(sessionId, {
                streamKey, interactionPassword, isPublic
            });
            // Broadcast new session list
            broadcastSessionList(io);
        } else {
            // SECURITY CHECK
            if (session.streamKey && session.streamKey !== streamKey) {
                log('warn', `[WS Mod] Hijack attempt on session ${sessionId}`);
                ws.close();
                return;
            }
            // Update session details
            log('info', `[WS Mod] Updating session: ${sessionId} (${isPublic ? 'PUBLIC' : 'PRIVATE'})`);
            sessionStore.updateSession(sessionId, { 
                interactionPassword, 
                isPublic,
                streamKey // Ensure map is updated
            });
            // Broadcast updated session list (e.g. status change)
            broadcastSessionList(io);
        }

        log('info', `[WS Mod] Connected for session: ${sessionId}`);

        ws.on('message', (message) => {
            processModMessage(message, sessionId, io);
        });

        ws.on('close', () => {
            log('info', `[WS Mod] Disconnected: ${sessionId}`);
        });
        
        ws.on('error', (err) => {
             log('error', `[WS Mod] Socket error for ${sessionId}:`, err);
        });
    });

    log('info', `Mod WebSocket Server running on port ${MOD_PORT}`);
    return modWss;
}

function processModMessage(message, sessionId, io) {
    try {
        // Binary Protocol:
        // [0]: Type (1=Image, 2=JSON)
        // [1]: SessionID Length (N)
        // [2..2+N]: SessionID (Ignored as we use connection scope)
        // [2+N..]: Payload

        if (!Buffer.isBuffer(message) || message.length < 3) return;

        const msgType = message[0];
        const idLength = message[1];
        
        // Offset where payload begins
        const payloadStart = 2 + idLength;
        
        if (message.length < payloadStart) return;

        const session = sessionStore.getSession(sessionId);
        if (!session) {
            return;
        }

        session.lastUpdate = new Date();
        session.lastHeartbeat = new Date();

        // TYPE 1: IMAGE (JPEG)
        if (msgType === 1) {
            // OPTIMIZATION: Keep as Buffer, don't convert to Base64 string
            const imageBuffer = message.slice(payloadStart);
            
            // Store the raw buffer
            session.screenshot = imageBuffer;

            io.emit('screenshot-update', {
                sessionId,
                screenshot: session.screenshot, // Sending Buffer directly
                timestamp: session.lastUpdate
            });
        }
        // TYPE 2: GAME STATE (JSON)
        else if (msgType === 2) {
            const jsonBuffer = message.slice(payloadStart);
            const jsonString = jsonBuffer.toString('utf8');
            try {
                session.gameState = JSON.parse(jsonString);
                
                // 1. SYNC: Process explicit adoptions from Mod (Manual & Auto)
                if (session.gameState.adoptions && Array.isArray(session.gameState.adoptions)) {
                    session.gameState.adoptions.forEach(adopt => {
                        if (adopt.username && adopt.pawnId) {
                            if (!session.adoptions.active.has(adopt.username)) {
                                console.log(`[WS Mod] Syncing adoption: ${adopt.username} -> ${adopt.pawnId}`);
                                session.adoptions.active.set(adopt.username, {
                                    pawnId: adopt.pawnId,
                                    name: 'Adopted Pawn', // Mod doesn't send name here, but frontend fetches it via ID
                                    adoptedAt: new Date()
                                });
                            }
                        }
                    });
                }

                // 2. RECONCILIATION: Check for spawned viewers (Legacy/Fallback)
                if (session.gameState.colonists && Array.isArray(session.gameState.colonists)) {
                    session.gameState.colonists.forEach(c => {
                        const colonist = c.colonist || c;
                        const nickname = colonist.name ? (colonist.name.nick || colonist.name) : null;
                        const pawnId = colonist.id || colonist.pawn_id;

                        if (nickname && pawnId) {
                            // Check if this pawn is named after a viewer who isn't registered as adopting yet
                            // (e.g. they bought the pawn, action sent, pawn spawned, now we link them)
                            
                            // We check if the nickname matches a known viewer profile
                            // AND if that viewer doesn't already have an active adoption record linked
                            
                            if (session.economy.viewers.has(nickname) && !session.adoptions.active.has(nickname)) {
                                console.log(`[WS Mod] Auto-linking viewer ${nickname} to pawn ${pawnId}`);
                                session.adoptions.active.set(nickname, {
                                    pawnId: pawnId,
                                    name: colonist.name,
                                    adoptedAt: new Date()
                                });
                            }
                            
                            // Self-healing: Update ID if name matches but ID changed (e.g. save reload?)
                            if (session.adoptions.active.has(nickname)) {
                                const record = session.adoptions.active.get(nickname);
                                if (String(record.pawnId) !== String(pawnId)) {
                                    // console.log(`[WS Mod] Updating ID for ${nickname}: ${record.pawnId} -> ${pawnId}`);
                                    record.pawnId = pawnId;
                                    record.name = colonist.name;
                                }
                            }
                        }
                    });
                }

                io.emit('gamestate-update', {
                    sessionId,
                    gameState: session.gameState,
                    timestamp: session.lastUpdate
                });
            } catch (jsonErr) {
                console.error('[WS Mod] JSON Parse Error:', jsonErr);
            }
        }
        // TYPE 3: FULL MAP IMAGE (JPEG)
        else if (msgType === 3) {
            const imageBuffer = message.slice(payloadStart);
            session.mapImage = imageBuffer;
            
            io.emit('map-image-update', {
                sessionId,
                image: session.mapImage,
                timestamp: session.lastUpdate
            });
        }
    } catch (e) {
        console.error('[WS Mod] Error processing message:', e);
    }
}

function broadcastSessionList(io) {
    const sessions = Array.from(sessionStore.gameSessions.entries())
        .filter(([id, data]) => data.isPublic !== false)
        .map(([id, data]) => {
            const gameState = data.gameState || {};
            const colonists = gameState.colonists || [];
            const resources = gameState.resources || {};
            const power = gameState.power || {};
            const creatures = gameState.creatures || {};
            const research = gameState.research || {};

            return {
                sessionId: id,
                isPrivate: false,
                requiresPassword: !!data.interactionPassword,
                colonistCount: colonists.length || creatures.colonists_count || 0,
                mapName: gameState.mapName || 'Colony',
                wealth: resources.total_market_value || 0,
                lastUpdate: data.lastUpdate,
                playerCount: data.players.length,
                networkQuality: gameState.networkQuality || 'medium',
                powerGenerated: power.current_power || 0,
                powerConsumed: power.total_consumption || 0,
                enemiesCount: creatures.enemies_count || 0,
                currentResearch: research.label || research.name || 'None'
            };
        });

    io.emit('sessions-list', { sessions });
}

module.exports = startModServer;
