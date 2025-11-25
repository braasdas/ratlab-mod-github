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
app.use(express.raw({ type: 'image/png', limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Store active game sessions
const gameSessions = new Map();
// sessionId -> { screenshot: Buffer, gameState: Object, lastUpdate: Date, players: [] }

// Store connected viewers
const viewers = new Map();
// socketId -> { selectedGame: sessionId }

// API Routes

// Receive screenshot from RimWorld mod
app.post('/api/screenshot', (req, res) => {
    try {
        const sessionId = req.headers['session-id'] || 'default-session';
        const screenshot = req.body;

        // Initialize session if it doesn't exist
        if (!gameSessions.has(sessionId)) {
            gameSessions.set(sessionId, {
                screenshot: null,
                gameState: {},
                lastUpdate: new Date(),
                players: []
            });
        }

        const session = gameSessions.get(sessionId);
        session.screenshot = screenshot;
        session.lastUpdate = new Date();

        // Broadcast to all connected viewers watching this session
        io.emit('screenshot-update', {
            sessionId,
            screenshot: screenshot.toString('base64'),
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

        if (!gameSessions.has(sessionId)) {
            gameSessions.set(sessionId, {
                screenshot: null,
                gameState: {},
                lastUpdate: new Date(),
                players: []
            });
        }

        const session = gameSessions.get(sessionId);
        session.gameState = gameState;
        session.lastUpdate = new Date();

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
        viewers.set(socket.id, { selectedGame: sessionId });

        if (gameSessions.has(sessionId)) {
            const session = gameSessions.get(sessionId);
            session.players.push(socket.id);

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
                session.players = session.players.filter(id => id !== socket.id);
            }
        }
        viewers.delete(socket.id);
    });
});

// Clean up old sessions (older than 5 minutes)
setInterval(() => {
    const now = new Date();
    for (const [sessionId, session] of gameSessions.entries()) {
        const timeDiff = (now - session.lastUpdate) / 1000 / 60; // minutes
        if (timeDiff > 5) {
            console.log(`Removing inactive session: ${sessionId}`);
            gameSessions.delete(sessionId);
        }
    }
}, 60000); // Check every minute

server.listen(PORT, () => {
    console.log(`Player Storyteller Server running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to view the interface`);
});
