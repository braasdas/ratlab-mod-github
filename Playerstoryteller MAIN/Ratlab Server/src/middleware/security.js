const cors = require('cors');
const { allowedOrigins } = require('../config/config');
const log = require('../utils/logger');

// In-memory stores for rate limiting
const actionRateLimits = new Map();
const updateRateLimits = new Map();

// CORS Middleware Configuration
const corsMiddleware = cors({
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
});

// Update Rate Limiter (30/sec per session)
function checkUpdateRateLimit(sessionId) {
    const nowMs = Date.now();
    let limit = updateRateLimits.get(sessionId);

    if (limit) {
        // Reset counter every second
        if (nowMs - limit.windowStart > 1000) {
            limit.windowStart = nowMs;
            limit.updateCount = 1;
        } else {
            // Maximum 30 updates per second (generous for 30 FPS)
            if (limit.updateCount >= 30) {
                log('warn', `[SECURITY] Rate limit exceeded for session ${sessionId}`);
                return false;
            }
            limit.updateCount++;
        }
    } else {
        updateRateLimits.set(sessionId, {
            windowStart: nowMs,
            updateCount: 1
        });
    }
    return true;
}

// Action Rate Limiter (30/min per IP)
function checkActionRateLimit(identifier) {
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

module.exports = {
    corsMiddleware,
    checkUpdateRateLimit,
    checkActionRateLimit
};
