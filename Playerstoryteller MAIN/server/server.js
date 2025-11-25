const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.raw({ type: ['image/png', 'image/jpeg'], limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Store active game sessions
const gameSessions = new Map();
// sessionId -> { screenshot: Buffer, gameState: Object, lastUpdate: Date, lastHeartbeat: Date, players: [] }

// Store connected viewers
const viewers = new Map();
// socketId -> { selectedGame: sessionId }

// Helper function to broadcast viewer count updates
function broadcastViewerCount(sessionId) {
    const session = gameSessions.get(sessionId);
    if (session) {
        io.emit('viewer-count-update', {
            sessionId,
            viewerCount: session.players.length
        });
    }
}

// API Routes

// Receive screenshot from RimWorld mod
app.post('/api/screenshot', (req, res) => {
    try {
        const sessionId = req.headers['session-id'] || 'default-session';
        const screenshot = req.body;

        // Validate screenshot data
        if (!screenshot || !Buffer.isBuffer(screenshot)) {
            console.error('Invalid screenshot data received:', typeof screenshot);
            return res.status(400).json({ error: 'Invalid screenshot data' });
        }

        const now = new Date();

        // Initialize session if it doesn't exist
        if (!gameSessions.has(sessionId)) {
            console.log(`New game session started: ${sessionId}`);
            gameSessions.set(sessionId, {
                screenshot: null,
                gameState: {},
                lastUpdate: now,
                lastHeartbeat: now,
                players: []
            });
        }

        const session = gameSessions.get(sessionId);
        session.screenshot = screenshot;
        session.lastUpdate = now;
        session.lastHeartbeat = now;

        // Convert to base64 string
        const screenshotBase64 = screenshot.toString('base64');

        console.log(`Screenshot received: ${sessionId}, ${screenshot.length} bytes, ${screenshotBase64.length} base64 chars`);

        // Broadcast to all connected viewers watching this session
        io.emit('screenshot-update', {
            sessionId,
            screenshot: screenshotBase64,
            timestamp: session.lastUpdate
        });

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error handling screenshot:', error);
        res.status(500).json({ error: error.message });
    }
});

// Receive game state from RimWorld mod
app.post('/api/gamestate', (req, res) => {
    try {
        const sessionId = req.headers['session-id'] || 'default-session';
        const gameState = req.body;

        const now = new Date();

        if (!gameSessions.has(sessionId)) {
            console.log(`New game session started: ${sessionId}`);
            gameSessions.set(sessionId, {
                screenshot: null,
                gameState: {},
                lastUpdate: now,
                lastHeartbeat: now,
                players: []
            });
        }

        const session = gameSessions.get(sessionId);
        session.gameState = gameState;
        session.lastUpdate = now;
        session.lastHeartbeat = now;

        // Broadcast game state to viewers
        io.emit('gamestate-update', {
            sessionId,
            gameState,
            timestamp: session.lastUpdate
        });

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error handling game state:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get list of active game sessions
app.get('/api/sessions', (req, res) => {
    try {
        const sessions = Array.from(gameSessions.entries()).map(([id, data]) => ({
            sessionId: id,
            colonistCount: data.gameState.colonistCount || 0,
            mapName: data.gameState.mapName || 'Unknown',
            wealth: data.gameState.wealth || 0,
            lastUpdate: data.lastUpdate,
            playerCount: data.players.length
        }));

        res.json({ sessions });
    } catch (error) {
        console.error('Error getting sessions:', error);
        res.status(500).json({ error: error.message });
    }
});

// Player action endpoint
app.post('/api/action', (req, res) => {
    try {
        const { sessionId, action, data } = req.body;

        // Broadcast action to the game (the RimWorld mod should listen for this)
        io.emit('player-action', {
            sessionId,
            action,
            data,
            timestamp: new Date()
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error handling action:', error);
        res.status(500).json({ error: error.message });
    }
});

// Network speed test endpoint
app.post('/api/speedtest', (req, res) => {
    try {
        const testData = req.body;
        const dataSize = Buffer.byteLength(JSON.stringify(testData));

        console.log(`Speed test: received ${dataSize} bytes`);

        // Echo back the data with server timestamp
        res.json({
            success: true,
            receivedSize: dataSize,
            serverTime: new Date().getTime(),
            echo: testData
        });
    } catch (error) {
        console.error('Error handling speed test:', error);
        res.status(500).json({ error: error.message });
    }
});

// Socket.IO for real-time communication
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Send current sessions list
    socket.emit('sessions-list', {
        sessions: Array.from(gameSessions.entries()).map(([id, data]) => ({
            sessionId: id,
            colonistCount: data.gameState.colonistCount || 0,
            mapName: data.gameState.mapName || 'Unknown',
            wealth: data.gameState.wealth || 0,
            lastUpdate: data.lastUpdate,
            playerCount: data.players.length
        }))
    });

    // Handle viewer selecting a game session
    socket.on('select-session', (sessionId) => {
        // Remove from previous session if any
        const previousViewer = viewers.get(socket.id);
        if (previousViewer && previousViewer.selectedGame) {
            const previousSession = gameSessions.get(previousViewer.selectedGame);
            if (previousSession) {
                previousSession.players = previousSession.players.filter(id => id !== socket.id);
                broadcastViewerCount(previousViewer.selectedGame);
                console.log(`Viewer ${socket.id} left session: ${previousViewer.selectedGame}`);
            }
        }

        // Add to new session
        viewers.set(socket.id, { selectedGame: sessionId });

        if (gameSessions.has(sessionId)) {
            const session = gameSessions.get(sessionId);

            // Only add if not already in the list
            if (!session.players.includes(socket.id)) {
                session.players.push(socket.id);
            }

            broadcastViewerCount(sessionId);
            console.log(`Viewer ${socket.id} joined session: ${sessionId} (${session.players.length} viewers)`);

            // Send current state
            if (session.screenshot) {
                socket.emit('screenshot-update', {
                    sessionId,
                    screenshot: session.screenshot.toString('base64'),
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
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);

        // Remove from viewers and game sessions
        const viewer = viewers.get(socket.id);
        if (viewer && viewer.selectedGame) {
            const session = gameSessions.get(viewer.selectedGame);
            if (session) {
                const previousCount = session.players.length;
                session.players = session.players.filter(id => id !== socket.id);

                if (previousCount !== session.players.length) {
                    broadcastViewerCount(viewer.selectedGame);
                    console.log(`Viewer ${socket.id} disconnected from session: ${viewer.selectedGame} (${session.players.length} viewers remaining)`);
                }
            }
        }
        viewers.delete(socket.id);
    });
});

// Clean up inactive game sessions
// A game is considered inactive if it hasn't sent any updates in 30 seconds
setInterval(() => {
    const now = new Date();
    for (const [sessionId, session] of gameSessions.entries()) {
        const timeDiff = (now - session.lastHeartbeat) / 1000; // seconds
        if (timeDiff > 30) {
            console.log(`Removing inactive game session: ${sessionId} (no updates for ${Math.round(timeDiff)}s)`);

            // Notify all viewers that this session ended
            io.emit('session-ended', {
                sessionId,
                timestamp: now
            });

            // Remove all players from this session
            session.players.forEach(playerId => {
                viewers.delete(playerId);
            });

            gameSessions.delete(sessionId);
        }
    }
}, 10000); // Check every 10 seconds

server.listen(PORT, () => {
    console.log(`Player Storyteller Server running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to view the interface`);
});
