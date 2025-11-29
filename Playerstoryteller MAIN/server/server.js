const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const path = require('path');
const zlib = require('zlib');

const app = express();
const server = http.createServer(app);

// SECURITY: Restrict CORS to specific origins
// In development, allow localhost. In production, restrict to your domain.
const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:9090',
    'http://127.0.0.1:9090',
    'http://75.127.14.105:9090',
    // Add your production domain here when deploying:
    // 'https://yourdomain.com',
    // 'https://www.yourdomain.com'
];

// Allow environment variable override for custom domains
if (process.env.ALLOWED_ORIGINS) {
    allowedOrigins.push(...process.env.ALLOWED_ORIGINS.split(','));
}

const io = socketIO(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    }
});

const PORT = process.env.PORT || 3000;

// LOGGING: Helper function for consistent logging with timestamps
function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

    if (level === 'error') {
        console.error(logMessage, data ? data : '');
    } else if (level === 'warn') {
        console.warn(logMessage, data ? data : '');
    } else {
        console.log(logMessage, data ? data : '');
    }
}

// Middleware - Restricted CORS
app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    credentials: true
}));

// First, capture all request bodies as raw buffers
app.use(express.raw({
    type: '*/*',
    limit: '3mb'
}));

// Then handle Gzip decompression and JSON parsing
app.use((req, res, next) => {
    // Skip if no body
    if (!req.body || req.body.length === 0) {
        return next();
    }

    // Check for gzip magic bytes (0x1f 0x8b) - most reliable way to detect gzip
    const isGzipped = req.body.length >= 2 &&
                      req.body[0] === 0x1f &&
                      req.body[1] === 0x8b;

    if (isGzipped) {
        // Decompress gzipped data
        zlib.gunzip(req.body, (err, decompressed) => {
            if (err) {
                console.error('Gzip decompression error:', err);
                console.error('First 20 bytes of compressed data:', req.body.slice(0, 20));
                return res.status(400).json({ error: 'Gzip decompression failed' });
            }

            // ZIP BOMB PROTECTION: Check decompressed size
            if (decompressed.length > 10 * 1024 * 1024) { // 10MB limit
                console.error(`[SECURITY] Zip bomb attempt detected! Compressed: ${req.body.length}, Decompressed: ${decompressed.length}`);
                return res.status(413).json({ error: 'Decompressed payload too large (Zip Bomb detected)' });
            }

            try {
                const bodyString = decompressed.toString('utf8');
                req.body = JSON.parse(bodyString);
                next();
            } catch (parseErr) {
                console.error('JSON parse error after decompression:', parseErr);
                console.error('First 200 chars of decompressed data:', bodyString.substring(0, 200));
                return res.status(400).json({ error: 'Invalid JSON after decompression' });
            }
        });
    } else if (req.headers['content-type']?.includes('application/json')) {
        // Parse regular JSON
        try {
            const bodyString = req.body.toString('utf8');
            req.body = JSON.parse(bodyString);
            next();
        } catch (parseErr) {
            console.error('JSON parse error:', parseErr);
            console.error('Content-Type:', req.headers['content-type']);
            console.error('Content-Encoding:', req.headers['content-encoding']);
            console.error('First 20 bytes:', req.body.slice(0, 20));
            return res.status(400).json({ error: 'Invalid JSON' });
        }
    } else {
        // Keep as buffer for other content types (images, etc.)
        next();
    }
});
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

// Store active game sessions
const gameSessions = new Map();
// sessionId -> { screenshot: Buffer, gameState: Object, lastUpdate: Date, lastHeartbeat: Date, players: [], isPublic: boolean }

// Store connected viewers
const viewers = new Map();
// socketId -> { selectedGame: sessionId }

// SECURITY: Rate limiting for actions
const actionRateLimits = new Map();
// socketId -> { lastAction: timestamp, actionCount: number }

// SECURITY: Rate limiting for update endpoint (prevent DoS)
const updateRateLimits = new Map();
// sessionId -> { lastUpdate: timestamp, updateCount: number }

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

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        activeSessions: gameSessions.size,
        connectedViewers: viewers.size
    });
});

// Receive combined update from RimWorld mod
app.post('/api/update', (req, res) => {
    try {
        const sessionId = req.headers['session-id'] || 'default-session';
        const streamKey = req.headers['x-stream-key'];
        const interactionPassword = req.headers['x-interaction-password']; // Optional
        const isPublic = req.headers['is-public'] !== 'false'; // Default to public if not specified

        if (!streamKey) {
            return res.status(401).json({ error: 'Missing stream key' });
        }

        // SECURITY: Rate limiting - max 30 updates per second per session
        const nowMs = Date.now();
        const limit = updateRateLimits.get(sessionId);

        if (limit) {
            // Reset counter every second
            if (nowMs - limit.windowStart > 1000) {
                limit.windowStart = nowMs;
                limit.updateCount = 1;
            } else {
                // Maximum 30 updates per second (generous for 30 FPS)
                if (limit.updateCount >= 30) {
                    log('warn', `[SECURITY] Rate limit exceeded for session ${sessionId}`);
                    return res.status(429).json({ error: 'Too many updates. Maximum 30 per second.' });
                }
                limit.updateCount++;
            }
        } else {
            updateRateLimits.set(sessionId, {
                windowStart: nowMs,
                updateCount: 1
            });
        }

        const { screenshot, gameState } = req.body;

        // Allow empty string for screenshot (disabled stream)
        if (screenshot === undefined || screenshot === null) {
            return res.status(400).json({ error: 'Missing screenshot data' });
        }
        if (!gameState) {
            return res.status(400).json({ error: 'Missing gameState data' });
        }

        const now = new Date();

        if (!gameSessions.has(sessionId)) {
            log('info', `New game session started: ${sessionId} (${isPublic ? 'PUBLIC' : 'PRIVATE'})`);
            console.log(`[PASSWORD DEBUG] New session - interactionPassword header: "${interactionPassword}"`);
            gameSessions.set(sessionId, {
                streamKey: streamKey, // Store the owner's key
                interactionPassword: interactionPassword,
                screenshot: null,
                gameState: {},
                lastUpdate: now,
                lastHeartbeat: now,
                players: [],
                actions: [],
                isPublic: isPublic
            });
        } else {
            const session = gameSessions.get(sessionId);

            // SECURITY CHECK: Verify stream key matches owner
            if (session.streamKey && session.streamKey !== streamKey) {
                log('warn', `[SECURITY] Hijack attempt on session ${sessionId} with wrong key`);
                return res.status(403).json({ error: 'Invalid stream key for this session' });
            }

            // Update session details
            session.isPublic = isPublic;
            
            // Only update password if it changed
            if (session.interactionPassword !== interactionPassword) {
                console.log(`[PASSWORD DEBUG] Session ${sessionId} password changed: "${session.interactionPassword}" -> "${interactionPassword}"`);
                session.interactionPassword = interactionPassword;
            }
        }

        const session = gameSessions.get(sessionId);
        session.screenshot = screenshot; // Already a base64 string
        try {
            session.gameState = JSON.parse(gameState);

            // Only log on first update or every 10 seconds to reduce spam
            if (!session.lastLogTime || (now - session.lastLogTime) > 10000) {
                session.lastLogTime = now;
                console.log('Received gameState structure:', {
                    hasColonists: !!session.gameState.colonists,
                    colonistsCount: session.gameState.colonists?.length || 0,
                    hasResources: !!session.gameState.resources,
                    hasPower: !!session.gameState.power,
                    hasCreatures: !!session.gameState.creatures,
                    hasResearch: !!session.gameState.research,
                    hasFactions: !!session.gameState.factions,
                    factionsCount: session.gameState.factions?.length || 0,
                });
            }
        } catch (e) {
            console.error("Error parsing gameState JSON:", e);
            console.error("Raw gameState:", gameState.substring(0, 500));
            // Handle error, maybe send a specific error response
            // For now, we'll just log it and the gameState will remain as it was
        }
        session.lastUpdate = now;
        session.lastHeartbeat = now;

        // Broadcast to all connected viewers watching this session
        io.emit('screenshot-update', {
            sessionId,
            screenshot: session.screenshot,
            timestamp: session.lastUpdate
        });
        io.emit('gamestate-update', {
            sessionId,
            gameState: session.gameState,
            timestamp: session.lastUpdate
        });

        res.status(200).json({ success: true });
    } catch (error) {
        log('error', 'Error handling update:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get a specific session by ID (works for both public and private)
app.get('/api/session/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;
        const data = gameSessions.get(sessionId);

        if (!data) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const gameState = data.gameState || {};
        const colonists = gameState.colonists || [];
        const resources = gameState.resources || {};
        const power = gameState.power || {};
        const creatures = gameState.creatures || {};
        const research = gameState.research || {};

        const session = {
            sessionId: sessionId,
            colonistCount: colonists.length || creatures.colonists_count || 0,
            mapName: 'Colony',
            wealth: resources.total_market_value || 0,
            lastUpdate: data.lastUpdate,
            playerCount: data.players.length,
            networkQuality: gameState.networkQuality || 'medium',
            powerGenerated: power.current_power || 0,
            powerConsumed: power.total_consumption || 0,
            enemiesCount: creatures.enemies_count || 0,
            currentResearch: research.label || research.name || 'None',
            isPublic: data.isPublic !== false,
            requiresPassword: !!data.interactionPassword
        };

        console.log(`[PASSWORD DEBUG] /api/session/${sessionId} - interactionPassword: "${data.interactionPassword}", requiresPassword: ${!!data.interactionPassword}`);
        res.json({ session });
    } catch (error) {
        console.error('Error getting session:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get list of active game sessions (public only)
app.get('/api/sessions', (req, res) => {
    try {
        // Filter to only show public sessions
        const sessions = Array.from(gameSessions.entries())
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
                colonistCount: colonists.length || creatures.colonists_count || 0,
                mapName: 'Colony',
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

        res.json({ sessions });
    } catch (error) {
        console.error('Error getting sessions:', error);
        res.status(500).json({ error: error.message });
    }
});

// SECURITY: Rate limiting helper
function checkRateLimit(identifier) {
    const now = Date.now();
    const limit = actionRateLimits.get(identifier);

    if (!limit) {
        actionRateLimits.set(identifier, {
            lastAction: now,
            actionCount: 1,
            windowStart: now
        });
        return { allowed: true };
    }

    // Reset counter every 60 seconds
    if (now - limit.windowStart > 60000) {
        limit.windowStart = now;
        limit.actionCount = 1;
        limit.lastAction = now;
        return { allowed: true };
    }

    // Maximum 30 actions per minute
    if (limit.actionCount >= 30) {
        return {
            allowed: false,
            message: 'Rate limit exceeded. Maximum 30 actions per minute.'
        };
    }

    // Minimum 500ms between actions
    if (now - limit.lastAction < 500) {
        return {
            allowed: false,
            message: 'Too fast. Please wait at least 500ms between actions.'
        };
    }

    limit.actionCount++;
    limit.lastAction = now;
    return { allowed: true };
}

// SECURITY: Input validation
function validateActionData(action, data) {
    // Validate action name (alphanumeric + underscores only)
    if (!/^[a-zA-Z0-9_]+$/.test(action)) {
        return { valid: false, message: 'Invalid action name. Only letters, numbers, and underscores allowed.' };
    }

    // Validate data length
    if (data && typeof data === 'string' && data.length > 500) {
        return { valid: false, message: 'Action data too long. Maximum 500 characters.' };
    }

    // Sanitize message actions
    if (action === 'sendLetter' || action === 'showMessage') {
        if (!data || typeof data !== 'string') {
            return { valid: false, message: 'Message actions require string data.' };
        }

        // Check for empty or whitespace-only messages
        if (data.trim().length === 0) {
            return { valid: false, message: 'Message cannot be empty.' };
        }

        // Minimum length for messages
        if (data.trim().length < 3) {
            return { valid: false, message: 'Message too short. Minimum 3 characters.' };
        }
    }

    return { valid: true };
}

// Player action endpoint
app.post('/api/action', (req, res) => {
    try {
        const { sessionId, action, data, password } = req.body;
        const clientIp = req.ip || req.connection.remoteAddress;

        // SECURITY: Rate limiting check
        const rateCheck = checkRateLimit(clientIp);
        if (!rateCheck.allowed) {
            log('warn', `Rate limit exceeded for ${clientIp}`);
            return res.status(429).json({ success: false, message: rateCheck.message });
        }

        // Validate that action exists
        if (!action) {
            console.error('Rejected action with missing action field:', req.body);
            return res.status(400).json({ success: false, message: 'Action field is required.' });
        }

        const session = gameSessions.get(sessionId);

        if (session) {
            // SECURITY CHECK: Password protection
            if (session.interactionPassword) {
                if (!password || password !== session.interactionPassword) {
                    return res.status(401).json({ success: false, message: 'Invalid password for this session.' });
                }
            }

            // SECURITY: Input validation
            const validation = validateActionData(action, data);
            if (!validation.valid) {
                console.warn(`Invalid action data from ${clientIp}: ${validation.message}`);
                return res.status(400).json({ success: false, message: validation.message });
            }

            session.actions.push({
                action,
                data: typeof data === 'string' ? data : JSON.stringify(data),
                timestamp: new Date()
            });
            console.log(`Action queued for session ${sessionId}: ${action}`);
            res.json({ success: true, message: 'Action queued.' });
        } else {
            res.status(404).json({ success: false, message: 'Session not found.' });
        }
    } catch (error) {
        console.error('Error handling action:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint for the mod to get pending actions
app.get('/api/actions/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = gameSessions.get(sessionId);

        if (session) {
            const actions = [...session.actions];
            session.actions = []; // Clear the actions queue
            res.json({ success: true, actions: actions });
        } else {
            res.status(404).json({ success: false, message: 'Session not found.' });
        }
    } catch (error) {
        console.error('Error getting actions:', error);
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

    // Send current sessions list (PUBLIC ONLY)
    const allSessions = Array.from(gameSessions.entries());
    const publicSessions = allSessions.filter(([id, data]) => data.isPublic !== false);
    const privateSessions = allSessions.length - publicSessions.length;

    if (privateSessions > 0) {
        console.log(`Sending ${publicSessions.length} public sessions (hiding ${privateSessions} private)`);
    }

    socket.emit('sessions-list', {
        sessions: publicSessions.map(([id, data]) => {
                const gameState = data.gameState || {};

                // Extract data from RIMAPI structure
                const colonists = gameState.colonists || [];
                const resources = gameState.resources || {};
                const power = gameState.power || {};
                const creatures = gameState.creatures || {};
                const research = gameState.research || {};

                return {
                    sessionId: id,
                    isPrivate: data.isPublic === false,
                    requiresPassword: !!data.interactionPassword,
                    colonistCount: colonists.length || creatures.colonists_count || 0,
                    mapName: 'Colony',
                    wealth: resources.total_market_value || 0,
                    lastUpdate: data.lastUpdate,
                    playerCount: data.players.length,
                    networkQuality: gameState.networkQuality || 'medium',
                    powerGenerated: power.current_power || 0,
                    powerConsumed: power.total_consumption || 0,
                    enemiesCount: creatures.enemies_count || 0,
                    currentResearch: research.label || research.name || 'None'
                };
            })
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
                    screenshot: session.screenshot, // Already a base64 string
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
    log('info', `Player Storyteller Server running on port ${PORT}`);
    log('info', `Visit http://localhost:${PORT} to view the interface`);
    log('info', `Health check available at http://localhost:${PORT}/health`);
    log('info', `Allowed CORS origins:`, allowedOrigins);
});
