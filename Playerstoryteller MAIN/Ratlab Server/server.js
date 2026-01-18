const http = require('http');
const socketIO = require('socket.io');
const url = require('url');
const { PORT, allowedOrigins } = require('./src/config/config');
const log = require('./src/utils/logger');
const sessionStore = require('./src/store/sessionStore');

// Services & App
const startModServer = require('./src/services/modServer');
const setupSocketIO = require('./src/services/socketio');
const setupStreamService = require('./src/services/streamer');
const economyManager = require('./src/services/economyManager');
const definitionManager = require('./src/services/DefinitionManager');
const createApp = require('./src/app');

// 1. Create the HTTP Server (without Express attached yet)
const appServer = http.createServer();

// 2. Initialize Socket.IO (Attaches to server)
const io = socketIO(appServer, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    }
});

// 3. Create Express App
const app = createApp();

// 4. Attach Routes (Now that we have IO)
const apiRoutes = require('./src/routes/api')(io, definitionManager);
const settingsRoutes = require('./src/routes/settings')(io);
app.use('/', apiRoutes);
app.use('/', settingsRoutes);

// 5. Manual Request Routing
// This prevents Express from conflicting with Socket.IO requests
appServer.on('request', (req, res) => {
    // If it's a Socket.IO request, let Socket.IO's internal listener handle it.
    // We just ignore it here so Express doesn't try to handle it too.
    if (req.url.startsWith('/socket.io/')) {
        return;
    }
    
    // Otherwise, pass to Express
    app(req, res);
});

// 6. Setup Services
setupSocketIO(io);
const streamWss = setupStreamService();
economyManager.start(io);

// 7. Upgrade Handling (WebSocket Streams)
appServer.on('upgrade', (request, socket, head) => {
    const pathname = url.parse(request.url).pathname;

    if (pathname === '/stream') {
        streamWss.handleUpgrade(request, socket, head, (ws) => {
            streamWss.emit('connection', ws, request);
        });
    }
    // Socket.IO handles its own upgrades automatically via attach()
});

// Queue Timer Loop
setInterval(() => {
    const now = new Date();
    
    for (const [sessionId, session] of sessionStore.gameSessions.entries()) {
        if (session.queue && session.queue.settings.autoExecute && session.queue.requests.length > 0) {
            
            if (!session.queue.lastProcessed) {
                session.queue.lastProcessed = now;
            }
            
            const intervalMs = (session.queue.settings.voteDuration || 600) * 1000;
            
            if (now - session.queue.lastProcessed >= intervalMs) {
                console.log(`[Queue] Auto-processing for session ${sessionId}`);
                
                session.queue.requests.sort((a, b) => {
                    const netVotesA = a.votes.filter(v => v.type === 'upvote').length - a.votes.filter(v => v.type === 'downvote').length;
                    const netVotesB = b.votes.filter(v => v.type === 'upvote').length - b.votes.filter(v => v.type === 'downvote').length;
                    return netVotesB - netVotesA; // Sort descending by net votes
                });

                const winner = session.queue.requests[0];
                
                if (winner) {
                    const winnerNetVotes = winner.votes.filter(v => v.type === 'upvote').length - winner.votes.filter(v => v.type === 'downvote').length;

                    if (winner.type === 'suggestion') {
                        session.actions.push({
                            action: 'sendLetter',
                            data: `Suggestion: ${winner.data} (Net Votes: ${winnerNetVotes})`,
                            timestamp: new Date()
                        });
                    } else {
                        session.actions.push({
                            action: winner.action,
                            data: winner.data,
                            timestamp: new Date()
                        });
                    }
                    
                    session.queue.requests.splice(0, 1);
                    session.queue.lastProcessed = now;
                    io.to(sessionId).emit('queue-update', { queue: session.queue });
                }
            }
        } else {
            if (session.queue && session.queue.requests.length === 0) {
                session.queue.lastProcessed = now; 
            }
        }
    }
}, 1000);

// 8. Start Mod Server (Port 3001)
startModServer(io);

// 9. Start Main Server (Port 3000)
appServer.listen(PORT, () => {
    log('info', `Player Storyteller Server running on port ${PORT}`);
    log('info', `Visit http://localhost:${PORT} to view the interface`);
    log('info', `Health check available at http://localhost:${PORT}/health`);
});
