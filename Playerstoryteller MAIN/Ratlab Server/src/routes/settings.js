const express = require('express');
const router = express.Router();
const sessionStore = require('../store/sessionStore');
const log = require('../utils/logger');

module.exports = (io) => {

// AUTH MIDDLEWARE: Validate Stream Key
const requireStreamAuth = (req, res, next) => {
    const { sessionId } = req.params;
    const streamKey = req.headers['x-stream-key'] || req.body.streamKey;

    if (!streamKey) {
        return res.status(401).json({ error: 'Missing stream key' });
    }

    const session = sessionStore.getSession(sessionId);
    if (!session) {
        // If session doesn't exist, we can't validate owner, but usually settings are accessed for active sessions.
        // However, for the dashboard to work even if the game isn't running yet (cold start), 
        // we might need a persistent store. For now, assume session must exist (mod connected first).
        return res.status(404).json({ error: 'Session not active. Connect the mod first.' });
    }

    if (session.streamKey !== streamKey) {
        return res.status(403).json({ error: 'Invalid stream key' });
    }

    req.session = session; // Attach session to request
    next();
};

// GET Settings (Public/Mod Access)
// Mod polls this to apply changes
router.get('/api/settings/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = sessionStore.getSession(sessionId);
    
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    // Return relevant settings for the Mod
    res.json({
        settings: session.settings,
        economy: {
            coinRate: session.economy.coinRate,
            actionCosts: session.economy.actionCosts
        },
        meta: {
            isPublic: session.isPublic,
            hasPassword: !!session.interactionPassword
        }
    });
});

// POST Settings (Streamer Access - Protected)
router.post('/api/settings/:sessionId', requireStreamAuth, (req, res) => {
    const { settings, economy, meta } = req.body;
    const session = req.session; // from middleware

    // 1. Update General Settings
    if (settings) {
        // Deep merge or selective update? Selective is safer.
        if (settings.actions) {
            session.settings.actions = { ...session.settings.actions, ...settings.actions };
        }
        // Update specific numeric/bool fields
        ['fastDataInterval', 'slowDataInterval', 'staticDataInterval', 'enableLiveScreen', 'maxActionsPerMinute'].forEach(field => {
            if (settings[field] !== undefined) session.settings[field] = settings[field];
        });
    }

    // 2. Update Economy
    if (economy) {
        if (economy.coinRate !== undefined) session.economy.coinRate = parseInt(economy.coinRate);
        if (economy.actionCosts) {
            session.economy.actionCosts = { ...session.economy.actionCosts, ...economy.actionCosts };
        }
    }

    // 3. Update Meta (Session props)
    if (meta) {
        if (meta.isPublic !== undefined) session.isPublic = meta.isPublic;
        if (meta.interactionPassword !== undefined) session.interactionPassword = meta.interactionPassword;
    }

    log('info', `Settings updated for session ${req.params.sessionId}`);
    
    // Broadcast updates to viewers
    if (economy) {
        io.to(req.params.sessionId).emit('economy-config-update', {
            actionCosts: session.economy.actionCosts,
            coinRate: session.economy.coinRate
        });
    }

    res.json({ success: true, message: 'Settings saved' });
});

// VALIDATE Credentials (for Dashboard Login)
router.post('/api/settings/:sessionId/validate', (req, res) => {
    const { sessionId } = req.params;
    const { streamKey } = req.body;

    const session = sessionStore.getSession(sessionId);
    if (!session) {
        return res.status(404).json({ valid: false, message: 'Session not found' });
    }

    if (session.streamKey === streamKey) {
        res.json({ valid: true });
    } else {
        res.status(403).json({ valid: false, message: 'Invalid key' });
    }
});

return router;
};
