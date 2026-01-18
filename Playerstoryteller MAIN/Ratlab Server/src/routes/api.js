const express = require('express');
const router = express.Router();
const sessionStore = require('../store/sessionStore');
const log = require('../utils/logger');
const { checkUpdateRateLimit, checkActionRateLimit } = require('../middleware/security');
const fs = require('fs');
const path = require('path');

// ==========================================
// GLOBAL TEXTURE CACHE - Initialize at module load
// ==========================================
const CACHE_DIR = path.join(__dirname, '../../cache/textures');
try {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        log('info', `[TextureCache] Created cache directory: ${CACHE_DIR}`);
    } else {
        const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.png'));
        log('info', `[TextureCache] Cache directory exists with ${files.length} textures: ${CACHE_DIR}`);
    }
} catch (err) {
    log('error', `[TextureCache] Failed to create cache directory: ${err.message}`);
}

// Debounce mechanism for Socket.io broadcasts
const broadcastDebounce = {
    gamestate: new Map(), // sessionId -> { lastBroadcast: timestamp, pending: data, timeoutId }
    mapThings: new Map(),
    screenshot: new Map()
};

function debouncedBroadcast(io, sessionId, eventType, data, delay = 50) {
    let debounceMap;
    if (eventType === 'gamestate-update') {
        debounceMap = broadcastDebounce.gamestate;
    } else if (eventType === 'map-things-update') {
        debounceMap = broadcastDebounce.mapThings;
    } else if (eventType === 'screenshot-update') {
        debounceMap = broadcastDebounce.screenshot;
    } else {
        // Unknown event type, just broadcast immediately
        io.to(sessionId).emit(eventType, data);
        return;
    }

    const existing = debounceMap.get(sessionId);

    // Clear existing timeout if present
    if (existing && existing.timeoutId) {
        clearTimeout(existing.timeoutId);
    }

    // Schedule new broadcast
    const timeoutId = setTimeout(() => {
        const entry = debounceMap.get(sessionId);
        if (entry) {
            io.to(sessionId).emit(eventType, entry.pending);
            entry.lastBroadcast = Date.now();
            entry.pending = null;
            entry.timeoutId = null;
        }
    }, delay);

    debounceMap.set(sessionId, {
        lastBroadcast: existing ? existing.lastBroadcast : Date.now(),
        pending: data,
        timeoutId
    });
}

// SECURITY: HTML sanitization for user-controlled strings
function sanitizeHtml(str) {
    if (str === null || str === undefined) return '';
    if (typeof str !== 'string') str = String(str);

    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// SECURITY: Username sanitization
function sanitizeUsername(username) {
    if (!username || typeof username !== 'string') return 'Anonymous';

    // Remove any HTML/script tags
    let clean = username.replace(/<[^>]*>/g, '');

    // Limit to reasonable characters (alphanumeric, underscore, dash, space)
    clean = clean.replace(/[^a-zA-Z0-9_\- ]/g, '');

    // Trim and limit length
    clean = clean.trim().slice(0, 32);

    return clean || 'Anonymous';
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

module.exports = (io, definitionManager) => {

    // Health check
    router.get('/health', (req, res) => {
        res.status(200).json({
            status: 'healthy',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            activeSessions: sessionStore.gameSessions.size,
            connectedViewers: sessionStore.viewers.size
        });
    });

    // Get Definitions (From Cache)
    router.get('/api/definitions/:sessionId', (req, res) => {
        const { sessionId } = req.params;
        if (!definitionManager) {
            return res.status(503).json({ error: 'Definition service unavailable' });
        }

        const defs = definitionManager.getDefinitions(sessionId);
        if (!defs) {
            // Fallback: Return empty structure or error.
            // Client handles empty/null gracefully.
            return res.json({});
        }
        res.json(defs);
    });

    // Map terrain ingest (from Mod)
    router.post('/api/v1/map/terrain/:sessionId', (req, res) => {
        const { sessionId } = req.params;
        const streamKey = req.headers['x-stream-key'];

        let session = sessionStore.getSession(sessionId);
        if (!session) {
            // Create a session placeholder so terrain can arrive before first heartbeat
            session = sessionStore.createSession(sessionId, { streamKey, isPublic: true });
        }

        if (session.streamKey && session.streamKey !== streamKey) {
            return res.status(403).json({ error: 'Invalid stream key' });
        }

        const { width, height, palette, grid, textures } = req.body || {};
        if (!width || !height || !Array.isArray(palette) || !Array.isArray(grid)) {
            return res.status(400).json({ error: 'Invalid terrain payload' });
        }

        const textureMap = {};
        if (textures && typeof textures === 'object') {
            Object.entries(textures).forEach(([name, b64]) => {
                try {
                    // Validate base64 - should start with PNG header when decoded
                    const buffer = Buffer.from(b64, 'base64');
                    // PNG magic number: 89 50 4E 47
                    if (buffer.length > 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
                        textureMap[name] = buffer;
                    } else {
                        console.warn(`[Terrain] Invalid PNG data for texture ${name} (got ${buffer.length} bytes, header: ${buffer.slice(0, 4).toString('hex')})`);
                    }
                } catch (e) {
                    console.warn('[Terrain] Failed to decode texture', name, e?.message);
                }
            });
        }

        session.mapTerrain = { width, height, palette, grid, textures: textureMap };
        sessionStore.updateSession(sessionId, { mapTerrain: session.mapTerrain });
        // console.log(`[Terrain] Stored terrain for ${sessionId} (${width}x${height}), palette=${palette.length}, textures=${Object.keys(textureMap).length}`);
        res.json({ success: true });
    });

    // Map terrain fetch (viewer)
    router.get('/api/v1/map/terrain', (req, res) => {
        const { sessionId } = req.query;
        const session = sessionStore.getSession(sessionId);
        if (!session || !session.mapTerrain) {
            return res.status(404).json({ error: 'Terrain not available' });
        }

        res.json({
            width: session.mapTerrain.width,
            height: session.mapTerrain.height,
            palette: session.mapTerrain.palette,
            grid: session.mapTerrain.grid
        });
    });

    // Map terrain texture fetch (viewer)
    router.get('/api/v1/map/terrain/image', (req, res) => {
        const { sessionId, name } = req.query;
        const session = sessionStore.getSession(sessionId);
        if (!session || !session.mapTerrain || !session.mapTerrain.textures) {
            return res.status(404).json({ error: 'Terrain textures not available' });
        }

        const tex = session.mapTerrain.textures[name];
        if (!tex) return res.status(404).json({ error: 'Texture not found' });

        res.setHeader('Content-Type', 'image/png');
        res.send(tex);
    });

    // Map things ingest (from Mod) - plants, trees, buildings, objects with textures
    router.post('/api/v1/map/things/:sessionId', (req, res) => {
        const { sessionId } = req.params;
        const streamKey = req.headers['x-stream-key'];

        let session = sessionStore.getSession(sessionId);
        if (!session) {
            session = sessionStore.createSession(sessionId, { streamKey, isPublic: true });
        }

        if (session.streamKey && session.streamKey !== streamKey) {
            return res.status(403).json({ error: 'Invalid stream key' });
        }

        const payload = req.body;
        if (!payload) {
            return res.status(400).json({ error: 'Invalid things payload' });
        }

        // New format: {things: [...], textures: {DefName: base64, ...}}
        // Old format: raw array or {data: [...]}
        let things, textures;

        if (payload.things && payload.textures) {
            // New bundled format
            things = payload.things;
            textures = payload.textures;
        } else {
            // Legacy format - just things data
            things = payload.data || payload;
            textures = {};
        }

        // Convert texture base64 strings to buffers
        const textureBuffers = {};
        if (textures && typeof textures === 'object') {
            Object.entries(textures).forEach(([defName, base64]) => {
                try {
                    const buffer = Buffer.from(base64, 'base64');
                    // Validate PNG header
                    if (buffer.length > 4 && buffer[0] === 0x89 && buffer[1] === 0x50) {
                        textureBuffers[defName] = buffer;
                    }
                } catch (e) {
                    console.warn(`[Things] Invalid texture for ${defName}`);
                }
            });
        }

        // Initialize mapThings if missing
        if (!session.mapThings) {
            session.mapThings = { things: [], textures: {} };
        }

        // Server stores latest things snapshot; clients manage persistence via exploration
        // Textures are accumulated server-side for new client initialization
        session.mapThings.things = things;
        session.mapThings.textures = { ...session.mapThings.textures, ...textureBuffers };

        sessionStore.updateSession(sessionId, { mapThings: session.mapThings });
        // console.log(`[Things] Stored ${Array.isArray(things) ? things.length : 'N/A'} things, merged ${Object.keys(textureBuffers).length} new textures for ${sessionId}`);

        // Broadcast update to viewers with debouncing
        // Convert NEW texture buffers back to base64 for transport
        const texturesB64 = {};
        Object.entries(textureBuffers).forEach(([k, v]) => {
            texturesB64[k] = v.toString('base64');
        });

        debouncedBroadcast(io, sessionId, 'map-things-update', {
            things: things,
            textures: texturesB64,
            focus_zones: payload.focus_zones // Pass through focus zones for cleanup
        }, 50);

        res.json({ success: true });
    });

    // Map things fetch (viewer) - returns things array only
    router.get('/api/v1/map/things', (req, res) => {
        const { sessionId } = req.query;
        const session = sessionStore.getSession(sessionId);
        if (!session || !session.mapThings) {
            return res.status(404).json({ error: 'Things not available' });
        }

        // Return just the things array (backwards compatible)
        const things = session.mapThings.things || session.mapThings;
        res.json(things);
    });

    // Map thing texture fetch (viewer) - serves cached textures (Memory -> Disk Fallback)
    router.get('/api/v1/map/thing/image', (req, res) => {
        const { sessionId, name } = req.query;
        if (!name) {
            return res.status(400).json({ error: 'Missing name parameter' });
        }

        // 1. Try Session Memory
        const session = sessionStore.getSession(sessionId);
        if (session && session.mapThings && session.mapThings.textures) {
            const texture = session.mapThings.textures[name];
            if (texture) {
                res.setHeader('Content-Type', 'image/png');
                res.setHeader('Cache-Control', 'public, max-age=86400');
                return res.send(texture);
            }
        }

        // 2. Try Disk Cache (Fallback)
        const safeName = name.replace(/[^a-zA-Z0-9_\-]/g, '');
        const filePath = path.join(CACHE_DIR, `${safeName}.png`);

        if (fs.existsSync(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.sendFile(filePath);
        }

        // 3. Not Found
        res.status(404).json({ error: 'Texture not found' });
    });

    // Upload Definitions (From Mod)
    router.post('/api/definitions/:sessionId', (req, res) => {
        const { sessionId } = req.params;
        const streamKey = req.headers['x-stream-key'];

        // Basic auth check (Session must exist and key must match if set)
        // We allow creating a session implicitly here if it's the startup sequence?
        // Better to require session existence or just stream key validation.

        let session = sessionStore.getSession(sessionId);
        if (session && session.streamKey && session.streamKey !== streamKey) {
            return res.status(403).json({ error: 'Invalid stream key' });
        }

        // If session doesn't exist, we might be too early. Mod should ensure session creation first?
        // Actually, Mod calls /api/update usually first. 
        // But let's be permissive: if key is valid (or new session), accept it.

        if (!definitionManager) return res.status(503).json({ error: 'Service unavailable' });

        try {
            const data = req.body; // Expecting the full JSON from /def/all
            definitionManager.processAndStore(sessionId, data);
            res.json({ success: true });
        } catch (e) {
            console.error("Error processing definitions:", e);
            res.status(500).json({ error: e.message });
        }
    });

    // Receive combined update from RimWorld mod (HTTP POST fallback)
    router.post('/api/update', (req, res) => {
        try {
            const sessionId = req.headers['session-id'] || 'default-session';
            const streamKey = req.headers['x-stream-key'];
            const interactionPassword = req.headers['x-interaction-password'];
            const isPublic = req.headers['is-public'] !== 'false';

            if (!streamKey) {
                return res.status(401).json({ error: 'Missing stream key' });
            }

            // Rate Limit
            if (!checkUpdateRateLimit(sessionId)) {
                return res.status(429).json({ error: 'Too many updates. Maximum 30 per second.' });
            }

            // NOTE: req.body is already parsed JSON thanks to express.json() middleware
            const { screenshot, gameState } = req.body;

            if (screenshot === undefined || screenshot === null) {
                return res.status(400).json({ error: 'Missing screenshot data' });
            }
            if (!gameState) {
                return res.status(400).json({ error: 'Missing gameState data' });
            }

            // Create or Update Session
            let session = sessionStore.getSession(sessionId);

            if (!session) {
                log('info', `New game session started: ${sessionId} (${isPublic ? 'PUBLIC' : 'PRIVATE'})`);
                session = sessionStore.createSession(sessionId, {
                    streamKey, interactionPassword, isPublic
                });
            } else {
                // Security Check
                if (session.streamKey && session.streamKey !== streamKey) {
                    log('warn', `[SECURITY] Hijack attempt on session ${sessionId}`);
                    return res.status(403).json({ error: 'Invalid stream key' });
                }
                sessionStore.updateSession(sessionId, { interactionPassword, isPublic });
            }

            // Handle Screenshot buffer
            if (typeof screenshot === 'string') {
                session.screenshot = Buffer.from(screenshot, 'base64');
            } else {
                session.screenshot = screenshot;
            }

            // Handle GameState
            // FIX: Removed redundant JSON.parse(gameState)
            // If the client sends gameState as a string inside JSON, we might need to parse it.
            // But if the client sends a nested JSON object, express.json() handles it.
            // Let's be robust:
            if (typeof gameState === 'string') {
                try {
                    session.gameState = JSON.parse(gameState);
                } catch (e) {
                    console.error("Error parsing inner gameState JSON string:", e);
                    // Fallback: treat as empty or error
                    session.gameState = {};
                }
            } else {
                session.gameState = gameState;
            }

            // Logging (throttled)
            const now = Date.now();
            if (!session.lastLogTime || (now - session.lastLogTime) > 10000) {
                session.lastLogTime = now;
                console.log('Received gameState structure:', {
                    hasColonists: !!session.gameState.colonists,
                    colonistsCount: session.gameState.colonists?.length || 0,
                });
            }

            session.lastUpdate = new Date();
            session.lastHeartbeat = new Date();

            // Broadcast with debouncing to reduce Socket.io overhead
            // Use io.to(sessionId) to only broadcast to clients in this session room
            debouncedBroadcast(io, sessionId, 'screenshot-update', {
                sessionId,
                screenshot: session.screenshot,
                timestamp: session.lastUpdate
            }, 50);

            // Use 16ms debounce for gamestate (one frame) to minimize position update lag
            debouncedBroadcast(io, sessionId, 'gamestate-update', {
                sessionId,
                gameState: session.gameState,
                timestamp: session.lastUpdate
            }, 16);

            res.status(200).json({ success: true });

        } catch (error) {
            log('error', 'Error handling update:', error);
            // Check if headers sent to avoid crashing
            if (!res.headersSent) {
                res.status(500).json({ error: error.message });
            }
        }
    });

    // Get specific session
    router.get('/api/session/:sessionId', (req, res) => {
        try {
            const { sessionId } = req.params;
            const data = sessionStore.getSession(sessionId);

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
                mapName: gameState.mapName || 'Colony',
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

            res.json({ session });
        } catch (error) {
            console.error('Error getting session:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/settings/:sessionId
    router.get('/api/settings/:sessionId', (req, res) => {
        const { sessionId } = req.params;
        const session = sessionStore.getSession(sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        res.json({
            settings: session.settings,
            economy: session.economy,
            queueSettings: session.queue ? session.queue.settings : {},
            meta: {
                isPublic: session.isPublic,
                hasPassword: !!session.interactionPassword,
                activeDlcs: session.gameState ? session.gameState.active_dlcs : null
            }
        });
    });

    // POST /api/settings/:sessionId
    router.post('/api/settings/:sessionId', (req, res) => {
        const { sessionId } = req.params;
        const streamKey = req.headers['x-stream-key'];
        const session = sessionStore.getSession(sessionId);

        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (session.streamKey && session.streamKey !== streamKey) {
            return res.status(403).json({ error: 'Invalid stream key' });
        }

        const { settings, economy, meta, queueSettings } = req.body;

        if (settings) {
            // Deep merge or replace settings
            if (settings.fastDataInterval) session.settings.fastDataInterval = settings.fastDataInterval;
            if (settings.slowDataInterval) session.settings.slowDataInterval = settings.slowDataInterval;
            if (settings.staticDataInterval) session.settings.staticDataInterval = settings.staticDataInterval;
            if (settings.enableLiveScreen !== undefined) session.settings.enableLiveScreen = settings.enableLiveScreen;
            if (settings.maxActionsPerMinute) session.settings.maxActionsPerMinute = settings.maxActionsPerMinute;
            if (settings.actions) session.settings.actions = { ...session.settings.actions, ...settings.actions };
        }

        if (economy) {
            if (economy.coinRate) session.economy.coinRate = economy.coinRate;
            if (economy.actionCosts) session.economy.actionCosts = { ...session.economy.actionCosts, ...economy.actionCosts };

            // Notify viewers of price changes
            io.to(sessionId).emit('economy-config-update', { actionCosts: session.economy.actionCosts });
        }

        if (queueSettings && session.queue) {
            if (queueSettings.voteDuration !== undefined) session.queue.settings.voteDuration = queueSettings.voteDuration;
            if (queueSettings.autoExecute !== undefined) session.queue.settings.autoExecute = queueSettings.autoExecute;
        }

        if (meta) {
            if (meta.isPublic !== undefined) session.isPublic = meta.isPublic;
            if (meta.interactionPassword !== undefined) session.interactionPassword = meta.interactionPassword;
        }

        res.json({ success: true });
    });

    // POST /api/settings/:sessionId/validate
    router.post('/api/settings/:sessionId/validate', (req, res) => {
        const { sessionId } = req.params;
        const { streamKey } = req.body;
        const session = sessionStore.getSession(sessionId);

        if (!session) return res.status(404).json({ error: 'Session not found' });

        const isValid = session.streamKey === streamKey;
        res.json({ valid: isValid });
    });

    // Get active sessions
    router.get('/api/sessions', (req, res) => {
        try {
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

            res.json({ sessions });
        } catch (error) {
            console.error('Error getting sessions:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Player Action
    router.post('/api/action', (req, res) => {
        try {
            const { sessionId, action, data, password, username } = req.body;
            const clientIp = req.ip || req.connection.remoteAddress;

            // Rate Limit
            const rateCheck = checkActionRateLimit(clientIp);
            if (!rateCheck.allowed) {
                log('warn', `Rate limit exceeded for ${clientIp}`);
                return res.status(429).json({ success: false, message: rateCheck.message });
            }

            if (!action) {
                return res.status(400).json({ success: false, message: 'Action field is required.' });
            }

            const session = sessionStore.getSession(sessionId);

            if (session) {
                // Password Check
                if (session.interactionPassword) {
                    if (!password || password !== session.interactionPassword) {
                        return res.status(401).json({ success: false, message: 'Invalid password for this session.' });
                    }
                }

                // Check if action is enabled (settings check)
                const settingKey = action.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);

                if (session.settings && session.settings.actions) {
                    if (session.settings.actions[settingKey] === false || session.settings.actions[action] === false) {
                        return res.status(403).json({ success: false, message: 'Action disabled by streamer.' });
                    }
                }

                // === ECONOMY CHECK === (ALWAYS run this, regardless of settings)
                if (session.economy && username) {
                    const costs = session.economy.actionCosts || {};
                    let cost = costs[action] !== undefined ? costs[action] : (costs[settingKey] !== undefined ? costs[settingKey] : 0);

                    // Dynamic Pricing (Server-Side Validation)
                    if (cost === 0 && definitionManager) {
                        const defs = definitionManager.getDefinitions(sessionId);
                        if (defs) {
                            if (action === 'spawn_pawn_dynamic') {
                                const animal = defs.animals ? defs.animals.find(a => a.defName === data) : null;
                                if (animal) {
                                    cost = Math.max(100, Math.floor((animal.combatPower || 10) * 2));
                                } else {
                                    // If def not found, maybe deny? For now, fallback or deny.
                                    // If we allow free, it defeats the purpose.
                                    // Let's log warning and deny if strict, or fallback to base price?
                                    // Fallback base price to prevent free spam:
                                    cost = 100;
                                }
                            } else if (action === 'trigger_incident_dynamic') {
                                cost = 1000;
                            } else if (action === 'change_weather_dynamic') {
                                cost = 500;
                            }
                        }
                    }

                    if (cost > 0) {
                        const profile = session.economy.viewers.get(username);
                        if (!profile) {
                            return res.status(400).json({ success: false, message: 'User wallet not found. Please log in.' });
                        }
                        if (profile.coins < cost) {
                            return res.status(402).json({ success: false, message: `Insufficient funds. Required: ${cost}, Balance: ${profile.coins}` });
                        }

                        // Deduct funds
                        profile.coins -= cost;
                        io.to(sessionId).emit('coin-update', { username, coins: profile.coins });
                    }
                }

                // Validation
                const validation = validateActionData(action, data);
                if (!validation.valid) {
                    return res.status(400).json({ success: false, message: validation.message });
                }

                session.actions.push({
                    action,
                    data: typeof data === 'string' ? data : JSON.stringify(data),
                    timestamp: new Date()
                });

                console.log(`Action queued for session ${sessionId}: ${action} (User: ${username || 'Anon'})`);
                res.json({ success: true, message: 'Action queued.' });
            } else {
                res.status(404).json({ success: false, message: 'Session not found.' });
            }
        } catch (error) {
            console.error('Error handling action:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Poll actions (Used by Mod)
    router.get('/api/actions/:sessionId', (req, res) => {
        try {
            const { sessionId } = req.params;
            const session = sessionStore.getSession(sessionId);

            if (session) {
                const actions = [...session.actions];
                session.actions = []; // Clear queue
                res.json({ success: true, actions: actions });
            } else {
                res.status(404).json({ success: false, message: 'Session not found.' });
            }
        } catch (error) {
            console.error('Error getting actions:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Network speed test
    router.post('/api/speedtest', (req, res) => {
        try {
            const testData = req.body;
            const dataSize = Buffer.byteLength(JSON.stringify(testData));
            res.json({
                success: true,
                receivedSize: dataSize,
                serverTime: new Date().getTime(),
                echo: testData
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // === ECONOMY ENDPOINTS ===

    // Get Balance
    router.get('/api/economy/:sessionId/balance/:username', (req, res) => {
        const { sessionId, username } = req.params;
        const session = sessionStore.getSession(sessionId);

        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!session.economy) return res.status(400).json({ error: 'Economy not initialized' });

        const profile = session.economy.viewers.get(username);
        const balance = profile ? profile.coins : 0;

        res.json({ username, coins: balance });
    });

    // Get Prices
    router.get('/api/economy/:sessionId/prices', (req, res) => {
        const { sessionId } = req.params;
        const session = sessionStore.getSession(sessionId);

        if (!session) return res.status(404).json({ error: 'Session not found' });

        res.json({
            prices: session.economy ? session.economy.actionCosts : {},
            coinRate: session.economy ? session.economy.coinRate : 0
        });
    });

    // Purchase Action
    router.post('/api/economy/:sessionId/purchase', (req, res) => {
        const { sessionId } = req.params;
        const { username, action, cost } = req.body;

        const session = sessionStore.getSession(sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        if (!session.economy || !session.economy.viewers.has(username)) {
            return res.status(400).json({ error: 'User has no wallet' });
        }

        const profile = session.economy.viewers.get(username);

        let finalCost = cost;
        // Verify cost if action is known
        if (action && session.economy.actionCosts[action] !== undefined) {
            finalCost = session.economy.actionCosts[action];
        }

        // Security: Prevent negative/zero cost exploits
        if (!finalCost || isNaN(finalCost) || finalCost <= 0) {
            return res.status(400).json({ error: 'Invalid cost' });
        }

        if (profile.coins < finalCost) {
            return res.status(402).json({ error: 'Insufficient funds', current: profile.coins, required: finalCost });
        }

        profile.coins -= finalCost;

        // Emit update
        io.to(sessionId).emit('coin-update', { username, coins: profile.coins });

        res.json({ success: true, newBalance: profile.coins });
    });

    // === QUEUE ENDPOINTS ===

    // Get Queue
    router.get('/api/queue/:sessionId', (req, res) => {
        const session = sessionStore.getSession(req.params.sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        res.json({ queue: session.queue });
    });

    // Submit Request
    router.post('/api/queue/:sessionId/submit', (req, res) => {
        const { sessionId } = req.params;
        const { username, type, data } = req.body;
        let { action } = req.body;

        const session = sessionStore.getSession(sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        // For suggestions, action is optional (defaults to 'suggestion')
        if (type === 'suggestion') {
            if (!action) action = 'suggestion';
        } else {
            if (!action || typeof action !== 'string') {
                return res.status(400).json({ error: 'Invalid action specified' });
            }
        }

        // Check cost (only if economy is enabled)
        let cost = 0;
        if (session.economy) {
            const actionCosts = session.economy.actionCosts || {};
            cost = actionCosts[action] || 0;

            if (cost > 0) {
                const profile = session.economy.viewers.get(username);

                if (!profile) {
                    return res.status(400).json({ error: 'User wallet not found' });
                }

                if (profile.coins < cost) {
                    return res.status(402).json({ error: 'Insufficient funds', required: cost, balance: profile.coins });
                }

                // Deduct cost
                profile.coins -= cost;
                io.to(sessionId).emit('coin-update', { username, coins: profile.coins });
            }
        }

        // SECURITY: Sanitize user-controlled fields before storing
        const safeUsername = sanitizeUsername(username);
        const safeData = (type === 'suggestion' && data) ? sanitizeHtml(data) : data;

        const request = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            type: type || 'action',
            action,
            submittedBy: safeUsername,
            submittedAt: new Date(),
            votes: [],
            cost,
            status: 'pending',
            data: safeData
        };

        session.queue.requests.push(request);
        io.to(sessionId).emit('queue-update', { queue: session.queue });

        res.json({ success: true, request });
    });

    // Vote
    router.post('/api/queue/:sessionId/vote', (req, res) => {
        const { sessionId } = req.params;
        const { requestId, username, voteType } = req.body; // voteType: 'upvote' or 'downvote'

        const session = sessionStore.getSession(sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        const reqItem = session.queue.requests.find(r => r.id === requestId);
        if (!reqItem) return res.status(404).json({ error: 'Request not found' });

        // Ensure votes array stores objects
        if (!Array.isArray(reqItem.votes) || !reqItem.votes.every(v => typeof v === 'object' && v.username && v.type)) {
            // Migrate old votes (which were just usernames) to upvotes, or initialize
            reqItem.votes = reqItem.votes.map(v => ({ username: v, type: 'upvote' }));
        }

        const existingVoteIndex = reqItem.votes.findIndex(v => v.username === username);

        if (existingVoteIndex !== -1) {
            // User has voted before
            if (reqItem.votes[existingVoteIndex].type === voteType) {
                // Same vote type, so unvote (remove vote)
                reqItem.votes.splice(existingVoteIndex, 1);
            } else {
                // Changed vote type (e.g., upvote to downvote, or vice versa)
                reqItem.votes[existingVoteIndex].type = voteType;
            }
        } else {
            // New vote
            reqItem.votes.push({ username, type: voteType });
        }

        io.to(sessionId).emit('queue-update', { queue: session.queue });

        res.json({ success: true });
    });

    // Force Trigger Queue (Streamer)
    router.post('/api/queue/:sessionId/force-trigger', (req, res) => {
        const { sessionId } = req.params;
        const streamKey = req.headers['x-stream-key'];

        const session = sessionStore.getSession(sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (session.streamKey && session.streamKey !== streamKey) return res.status(403).json({ error: 'Unauthorized' });

        // Find top voted request
        const pending = session.queue.requests.filter(r => r.status === 'pending');
        if (pending.length === 0) return res.json({ success: true, message: 'Queue empty' });

        // Sort by votes (descending)
        pending.sort((a, b) => {
            const votesA = a.votes ? a.votes.filter(v => v.type === 'upvote').length - a.votes.filter(v => v.type === 'downvote').length : 0;
            const votesB = b.votes ? b.votes.filter(v => v.type === 'upvote').length - b.votes.filter(v => v.type === 'downvote').length : 0;
            return votesB - votesA;
        });

        const winner = pending[0];
        const index = session.queue.requests.indexOf(winner);

        if (index !== -1) {
            // Validate Action (Suggestion type is special case)
            if (winner.type === 'suggestion') {
                const votes = winner.votes ? winner.votes.filter(v => v.type === 'upvote').length - winner.votes.filter(v => v.type === 'downvote').length : 0;
                session.actions.push({
                    action: 'sendLetter',
                    data: `Suggestion: ${winner.data} (Net Votes: ${votes})`,
                    timestamp: new Date()
                });
                log('info', `Queue forced: Sent suggestion letter for session ${sessionId}`);
            } else if (!winner.action) {
                log('warn', `Queue forced: Skipped invalid request ${winner.id} (missing action)`);
            } else {
                // Execute Action
                session.actions.push({
                    action: winner.action,
                    data: winner.data,
                    timestamp: new Date()
                });
                log('info', `Queue forced: Executed ${winner.action} for session ${sessionId}`);
            }

            // Remove from queue
            session.queue.requests.splice(index, 1);

            // Broadcast update
            io.to(sessionId).emit('queue-update', { queue: session.queue, triggered: true });
        }

        res.json({ success: true });
    });

    // Approve (Streamer)
    router.post('/api/queue/:sessionId/approve/:requestId', (req, res) => {
        const { sessionId, requestId } = req.params;
        const streamKey = req.headers['x-stream-key'];

        const session = sessionStore.getSession(sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (session.streamKey && session.streamKey !== streamKey) return res.status(403).json({ error: 'Unauthorized' });

        const index = session.queue.requests.findIndex(r => r.id === requestId);
        if (index === -1) return res.status(404).json({ error: 'Request not found' });

        const reqItem = session.queue.requests[index];

        // Execute Action
        session.actions.push({
            action: reqItem.action,
            data: reqItem.data,
            timestamp: new Date()
        });

        // Remove from queue
        session.queue.requests.splice(index, 1);
        io.to(sessionId).emit('queue-update', { queue: session.queue });

        res.json({ success: true });
    });

    // Reject (Streamer)
    router.post('/api/queue/:sessionId/reject/:requestId', (req, res) => {
        const { sessionId, requestId } = req.params;
        const streamKey = req.headers['x-stream-key'];

        const session = sessionStore.getSession(sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (session.streamKey && session.streamKey !== streamKey) return res.status(403).json({ error: 'Unauthorized' });

        const index = session.queue.requests.findIndex(r => r.id === requestId);
        if (index === -1) return res.status(404).json({ error: 'Request not found' });

        const reqItem = session.queue.requests[index];

        // Refund (only if economy is initialized)
        if (session.economy) {
            const profile = session.economy.viewers.get(reqItem.submittedBy);
            if (profile) {
                profile.coins += reqItem.cost;
                io.to(sessionId).emit('coin-update', { username: reqItem.submittedBy, coins: profile.coins });
            }
        }

        // Remove from queue
        session.queue.requests.splice(index, 1);
        io.to(sessionId).emit('queue-update', { queue: session.queue });

        res.json({ success: true });
    });

    // Get Active Session by Stream Key (For dashboard recovery)
    router.post('/api/streamer/get-active-session', (req, res) => {
        const { streamKey } = req.body;
        if (!streamKey) return res.status(400).json({ error: 'Missing stream key' });

        const sessionId = sessionStore.streamKeyToSessionId.get(streamKey);

        if (sessionId) {
            const session = sessionStore.getSession(sessionId);
            // Security check: verify mapping is still valid
            if (session && session.streamKey === streamKey) {
                return res.json({
                    sessionId: sessionId,
                    isPublic: session.isPublic
                });
            }
        }

        return res.status(404).json({ error: 'No active session found for this key' });
    });

    // === ADOPTION ENDPOINTS ===

    // Check if a pawn is already adopted
    router.get('/api/adoptions/:sessionId/pawn/:pawnId', (req, res) => {
        const { sessionId, pawnId } = req.params;
        const session = sessionStore.getSession(sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        // Check if any user has adopted this pawn
        for (const [username, adoption] of session.adoptions.active) {
            if (String(adoption.pawnId) === String(pawnId)) {
                return res.json({ isAdopted: true, adoptedBy: username });
            }
        }
        res.json({ isAdopted: false });
    });

    // Get Adoption Status
    router.get('/api/adoptions/:sessionId/status/:username', (req, res) => {
        const { sessionId, username } = req.params;
        const session = sessionStore.getSession(sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        const adoption = session.adoptions.active.get(username);
        if (adoption) {
            // find current stats from gameState
            let pawnData = null;
            if (session.gameState && session.gameState.colonists) {
                pawnData = session.gameState.colonists.find(c =>
                    (c.colonist && (c.colonist.id == adoption.pawnId || c.colonist.pawn_id == adoption.pawnId)) ||
                    (c.id == adoption.pawnId || c.pawn_id == adoption.pawnId)
                );
            }
            res.json({ hasAdopted: true, adoption, pawnData });
        } else {
            res.json({ hasAdopted: false, cost: session.adoptions.settings.cost });
        }
    });

    // Request Adoption
    router.post('/api/adoptions/:sessionId/request', (req, res) => {
        const { sessionId } = req.params;
        const { username, nickname } = req.body;

        const session = sessionStore.getSession(sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        // 1. Check if already adopted
        if (session.adoptions.active.has(username)) {
            return res.status(400).json({ error: 'You already have a colonist!' });
        }

        // 2. Check funds
        const profile = session.economy.viewers.get(username);
        const cost = session.adoptions.settings.cost;

        if (!profile || profile.coins < cost) {
            return res.status(402).json({ error: `Insufficient funds. Cost: ${cost}` });
        }

        // 3. Process Transaction
        profile.coins -= cost;
        io.to(sessionId).emit('coin-update', { username, coins: profile.coins });

        // 4. Send Action to Game (Spawn new pawn)
        // Payload: username and optional nickname
        const payload = {
            username: username,
            nickname: nickname || null
        };

        session.actions.push({
            action: 'buyPawn',
            data: JSON.stringify(payload),
            timestamp: new Date()
        });

        // We don't set the adoption record yet. 
        // The game will spawn the pawn -> send GameState -> modServer will reconcile and link the ID.

        res.json({ success: true, message: 'Request transmitted. Stand by for orbital drop.' });
    });

    // Send Command
    router.post('/api/adoptions/:sessionId/command', (req, res) => {
        const { sessionId } = req.params;
        const { username, command, target, data } = req.body; // command: 'draft', 'set_work_priorities', etc.

        const session = sessionStore.getSession(sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        const adoption = session.adoptions.active.get(username);
        if (!adoption) {
            return res.status(403).json({ error: 'You do not have an adopted colonist.' });
        }

        // Rate limit commands specifically?
        // For now, rely on global action limit or trusting the polling speed.

        // Construct payload supporting complex data (like priorities)
        const payload = {
            pawnId: adoption.pawnId,
            type: command,
            target: target,
            ...data // Merge extra data like 'priorities'
        };

        session.actions.push({
            action: 'colonist_command',
            data: JSON.stringify(payload),
            timestamp: new Date()
        });

        res.json({ success: true });
    });

    // ==========================================
    // GLOBAL TEXTURE CACHE ROUTES (CACHE_DIR defined at module level)
    // ==========================================

    // GET Manifest: Returns list of cached DefNames
    router.get('/textures/manifest', (req, res) => {
        fs.readdir(CACHE_DIR, (err, files) => {
            if (err) return res.status(500).json([]);
            // Return filenames without extension
            const manifest = files
                .filter(f => f.endsWith('.png'))
                .map(f => f.replace('.png', ''));
            res.json(manifest);
        });
    });

    // POST Batch: Saves new textures
    router.post('/textures', express.json({ limit: '50mb' }), (req, res) => {
        // NOTE: We need large body limit for texture batches.
        // If app.use(json) is global it might conflict, but router-level middleware is safer.
        const { textures } = req.body; // { DefName: Base64String, ... }

        log('info', `[TextureCache] POST /textures received. Body keys: ${Object.keys(req.body || {}).join(', ')}, textures: ${textures ? Object.keys(textures).length : 'null'}`);

        if (!textures) return res.status(400).json({ error: 'No textures provided' });

        let saved = 0;
        Object.entries(textures).forEach(([defName, base64]) => {
            if (!defName || !base64) return;

            // Validate filename (basic sanitization)
            const safeName = defName.replace(/[^a-zA-Z0-9_\-]/g, '');
            if (!safeName) return;

            const filePath = path.join(CACHE_DIR, `${safeName}.png`);

            // Don't overwrite if exists (Global Cache - First Come First Serve)
            if (!fs.existsSync(filePath)) {
                try {
                    const buffer = Buffer.from(base64, 'base64');
                    fs.writeFileSync(filePath, buffer);
                    saved++;
                } catch (e) {
                    console.error(`Failed to save texture ${safeName}:`, e);
                }
            }
        });

        if (saved > 0) log('info', `[TextureCache] Cached ${saved} new textures.`);
        res.json({ success: true, saved });
    });

    // GET Texture: Serves the image
    router.get('/texture/:name', (req, res) => {
        const name = req.params.name.replace(/[^a-zA-Z0-9_\-]/g, '');
        const filePath = path.join(CACHE_DIR, `${name}.png`);

        if (fs.existsSync(filePath)) {
            res.sendFile(filePath, { maxAge: '7d' }); // Cache for 7 days
        } else {
            res.status(404).send('Not found');
        }
    });

    return router;
};