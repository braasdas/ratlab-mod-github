const sessionStore = require('../store/sessionStore');
const log = require('../utils/logger');

class EconomyManager {
    constructor() {
        this.interval = null;
    }

    start(io) {
        if (this.interval) clearInterval(this.interval);
        
        // Tick every 10 seconds (faster feedback)
        this.interval = setInterval(() => {
            this.tick(io);
        }, 10000); 
        
        log('info', 'Economy Manager started (10s tick)');
    }

    tick(io) {
        const now = new Date();
        
        sessionStore.gameSessions.forEach((session, sessionId) => {
            if (!session.economy) return;

            // Identify active users in this session
            const activeUsernames = new Set();
            session.players.forEach(socketId => {
                const viewer = sessionStore.viewers.get(socketId);
                if (viewer && viewer.username) {
                    activeUsernames.add(viewer.username);
                }
            });
            
            // Update coins
            const coinsPerTick = session.economy.coinRate / 6; // 10s is 1/6th of a minute

            if (coinsPerTick <= 0) return;

            activeUsernames.forEach(username => {
                let profile = session.economy.viewers.get(username);
                
                // Create profile if missing
                if (!profile) {
                    profile = { coins: 0, watchStart: now, lastSeen: now };
                    session.economy.viewers.set(username, profile);
                }

                profile.coins += coinsPerTick;
                profile.lastSeen = now;
                
                // Emit update (round for display, but keep precision in state?)
                // Let's send the float, frontend handles display formatting
                io.to(sessionId).emit('coin-update', { 
                    username: username, 
                    coins: Math.floor(profile.coins) 
                });
            });
        });
    }
    
    stop() {
        if (this.interval) clearInterval(this.interval);
    }
}

module.exports = new EconomyManager();
