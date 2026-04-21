const express = require('express');
const router = express.Router();
const sessionStore = require('../store/sessionStore');
const settingsPersistence = require('../services/settingsPersistence');
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
router.post('/api/settings/:sessionId', requireStreamAuth, async (req, res) => {
    const { settings, economy, meta, queueSettings } = req.body;
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
    // Reject NaN/negative values — a single bad coinRate poisons every viewer's
    // balance via `profile.coins += NaN` in the 10s tick (NaN <= 0 is false, so
    // the early-return guard doesn't catch it).
    if (economy) {
        if (economy.coinRate !== undefined) {
            const rate = parseInt(economy.coinRate);
            if (Number.isFinite(rate) && rate >= 0) {
                session.economy.coinRate = rate;
            }
        }
        if (economy.actionCosts) {
            const clean = {};
            for (const [action, cost] of Object.entries(economy.actionCosts)) {
                const n = parseInt(cost);
                if (Number.isFinite(n) && n >= 0) clean[action] = n;
            }
            session.economy.actionCosts = { ...session.economy.actionCosts, ...clean };
        }
    }

    // 3. Update Queue Settings (live field is session.queue.settings)
    if (queueSettings && session.queue) {
        if (queueSettings.voteDuration !== undefined) session.queue.settings.voteDuration = queueSettings.voteDuration;
        if (queueSettings.autoExecute !== undefined) session.queue.settings.autoExecute = queueSettings.autoExecute;
    }

    // 4. Update Meta (Session props)
    if (meta) {
        if (meta.isPublic !== undefined) session.isPublic = meta.isPublic;
        if (meta.interactionPassword !== undefined) session.interactionPassword = meta.interactionPassword;
    }

    log('info', `Settings updated for session ${req.params.sessionId}`);

    // Persist settings to disk
    if (session.streamKey) {
        await settingsPersistence.saveSettings(session.streamKey, {
            settings: session.settings,
            economy: {
                coinRate: session.economy.coinRate,
                actionCosts: session.economy.actionCosts
            },
            meta: {
                isPublic: session.isPublic,
                interactionPassword: session.interactionPassword
            },
            queueSettings: session.queue ? session.queue.settings : {}
        });
    }

    // Broadcast updates to viewers. disabledActions is derived from merged
    // session state, not the request body — otherwise a partial update would
    // drop every action the current request didn't mention.
    if (economy || settings) {
        const sessionActions = session.settings.actions || {};
        io.to(req.params.sessionId).emit('economy-config-update', {
            actionCosts: session.economy.actionCosts,
            coinRate: session.economy.coinRate,
            disabledActions: Object.keys(sessionActions).filter(key => sessionActions[key] === false)
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
        // List active sessions to help diagnose mismatches
        const activeIds = Array.from(sessionStore.gameSessions.keys());
        log('warn', `[Validate] Session "${sessionId}" not found. Active sessions: [${activeIds.join(', ')}]`);
        return res.status(404).json({ valid: false, message: 'Session not found' });
    }

    if (session.streamKey === streamKey) {
        res.json({ valid: true });
    } else {
        log('warn', `[Validate] Key mismatch for session "${sessionId}". ` +
            `Provided key length: ${streamKey ? streamKey.length : 0}, ` +
            `Session key length: ${session.streamKey ? session.streamKey.length : 0}, ` +
            `Match: ${session.streamKey === streamKey}`);
        res.status(403).json({ valid: false, message: 'Invalid key' });
    }
});

return router;
};
