const sessionStore = require('../store/sessionStore');
const log = require('../utils/logger');

function setupSocketIO(io) {
    io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);

        // Send current sessions list (PUBLIC ONLY)
        sendSessionList(socket);

        socket.on('get-sessions', () => {
            sendSessionList(socket);
        });

        // Handle viewer selecting a game session
        socket.on('select-session', (payload) => {
            // Support both string (legacy) and object payloads
            const sessionId = typeof payload === 'object' ? payload.sessionId : payload;
            const username = typeof payload === 'object' ? payload.username : null;
            
            handleSessionSelection(socket, sessionId, username);
        });

        socket.on('disconnect', () => {
            handleDisconnect(socket);
        });
    });

    // Listen for session cleanup events
    sessionStore.on('session-ended', (sessionId) => {
        io.emit('session-ended', {
            sessionId,
            timestamp: new Date()
        });
    });
}

function sendSessionList(socket) {
    const sessions = Array.from(sessionStore.gameSessions.entries())
        .filter(([id, data]) => data.isPublic !== false)
        .map(([id, data]) => {
            const gameState = data.gameState || {};

            // Extract data from RIMAPI structure
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

    socket.emit('sessions-list', { sessions });
}

function handleSessionSelection(socket, sessionId, username = null) {
    // Remove from previous session if any
    const previousSessionId = sessionStore.removeViewer(socket.id);
    if (previousSessionId) {
        broadcastViewerCount(previousSessionId, socket.server); // socket.server is 'io'
        console.log(`Viewer ${socket.id} left session: ${previousSessionId}`);
    }

    // Add to new session (with username)
    sessionStore.addViewer(socket.id, sessionId, username);
    socket.join(sessionId); // Join the room
    
    // Get session data
    const session = sessionStore.getSession(sessionId);
    if (session) {
        broadcastViewerCount(sessionId, socket.server);
        console.log(`Viewer ${socket.id} joined session: ${sessionId} (${session.players.length} viewers)`);

        // Send current state
        if (session.screenshot) {
            socket.emit('screenshot-update', {
                sessionId,
                screenshot: session.screenshot,
                timestamp: session.lastUpdate
            });
        }
        if (session.gameState) {
            socket.emit('gamestate-update', {
                sessionId,
                gameState: session.gameState,
                timestamp: session.lastUpdate
            });
        }
        
        // Send economy data if username is present
        if (username && session.economy && session.economy.viewers.has(username)) {
            const coins = session.economy.viewers.get(username).coins;
            socket.emit('coin-update', { username, coins });
        }
    }
}

function handleDisconnect(socket) {
    console.log('Client disconnected:', socket.id);
    const previousSessionId = sessionStore.removeViewer(socket.id);
    if (previousSessionId) {
        broadcastViewerCount(previousSessionId, socket.server);
        const session = sessionStore.getSession(previousSessionId);
        const count = session ? session.players.length : 0;
        console.log(`Viewer ${socket.id} disconnected from session: ${previousSessionId} (${count} viewers remaining)`);
    }
}

function broadcastViewerCount(sessionId, io) {
    const session = sessionStore.getSession(sessionId);
    if (session && io) {
        io.emit('viewer-count-update', {
            sessionId,
            viewerCount: session.players.length
        });
    }
}

module.exports = setupSocketIO;
