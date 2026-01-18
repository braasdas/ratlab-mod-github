import { STATE } from './state.js';
import { updateConnectionStatus, showLoading, hideLoading } from './ui.js';
import { initializeStream, stopStream } from './stream.js';
import { socket } from './socket.js';
import { updateGameState } from './gameData.js';
import { loadActionPanel, updateActionButtonsCosts } from './actions.js';
import { escapeHtml, escapeAttr, escapeJs, sanitizeSessionId } from './sanitize.js';

export function renderSessionsList() {
    const sessionsList = document.getElementById('sessions-list');
    const noSessions = document.getElementById('no-sessions');
    
    if (!sessionsList) return;
    
    sessionsList.innerHTML = '';
    
    if (STATE.sessions.length === 0) {
        if(noSessions) noSessions.classList.remove('hidden');
        return;
    }
    
    if(noSessions) noSessions.classList.add('hidden');

    STATE.sessions.forEach(session => {
        const div = document.createElement('div');
        const playerCount = session.playerCount !== undefined ? session.playerCount : '?';
        const wealth = session.wealth ? `${(session.wealth/1000).toFixed(1)}k` : '?';
        const isLocked = session.requiresPassword;
        const region = escapeHtml(session.region || 'US-EAST');

        // Sanitize all user/server-controlled data
        const safeSessionId = sanitizeSessionId(session.sessionId);
        const safeMapName = escapeHtml(session.mapName || 'Unknown Colony');
        const safeColonistCount = parseInt(session.colonistCount) || 0;
        const safeUptime = escapeHtml(session.uptime || '00:00:00');

        div.innerHTML = `
        <div class="session-card group bg-rat-panel border border-rat-border hover:border-rat-green rounded-lg p-6 cursor-pointer transition-all relative overflow-hidden" onclick="window.selectSession('${escapeJs(safeSessionId)}')">

            <div class="flex justify-between items-start mb-4 relative z-10">
                <div>
                    <h3 class="font-bold text-xl text-white group-hover:text-rat-green transition-colors">${safeMapName}</h3>
                    <div class="text-xs font-mono text-rat-text-dim mt-1">ID: ${escapeHtml(safeSessionId)}</div>
                </div>
                <div class="flex flex-col items-end gap-2">
                    ${isLocked ? '<span class="px-2 py-1 rounded bg-rat-red/20 text-rat-red text-[10px] font-mono border border-rat-red/50"><i class="fa-solid fa-lock"></i> PRIVATE</span>' : '<span class="px-2 py-1 rounded bg-rat-green/20 text-rat-green text-[10px] font-mono border border-rat-green/50">PUBLIC</span>'}
                    <span class="text-[10px] font-mono text-rat-text-dim"><i class="fa-solid fa-globe"></i> ${region}</span>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-4 text-sm font-mono relative z-10">
                <div>
                    <div class="text-rat-text-dim text-xs">POPULATION</div>
                    <div class="text-white">${safeColonistCount} Subjects</div>
                </div>
                 <div>
                    <div class="text-rat-text-dim text-xs">WEALTH</div>
                    <div class="text-white">$${escapeHtml(wealth)}</div>
                </div>
                 <div>
                    <div class="text-rat-text-dim text-xs">VIEWERS</div>
                    <div class="text-white">${parseInt(playerCount) || '?'} Watching</div>
                </div>
                <div>
                    <div class="text-rat-text-dim text-xs">UPTIME</div>
                    <div class="text-white">${safeUptime}</div>
                </div>
            </div>

            <!-- Hover Effect -->
            <div class="absolute inset-0 bg-gradient-to-t from-rat-green/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
        </div>
        `;
        sessionsList.appendChild(div);
    });
}

export function selectSession(sessionId) {
    // Check for username first
    if (!STATE.username) {
        // Show username modal
        // window.pendingSessionId = sessionId; // This was global in original app.js
        // Since we are refactoring, let's assume openUsernameModal handles the global state or we pass it
        // Re-implement username check if needed or just alert
        const modal = document.getElementById('username-modal');
        if(modal) {
             modal.classList.remove('hidden');
             modal.dataset.pendingSessionId = sessionId;
             return;
        }
        // Fallback
        const user = prompt("ENTER ALIAS:");
        if(!user) return;
        localStorage.setItem('username', user);
        STATE.username = user;
    }

    startSessionConnection(sessionId);
}

function startSessionConnection(sessionId) {
    STATE.currentSession = sessionId;
    STATE.sessionPassword = null;

    document.getElementById('session-selection').classList.remove('active');
    document.getElementById('game-viewer').classList.add('active');
    
    showLoading("ESTABLISHING SECURE CONNECTION...");

    // Stop existing streams if any
    stopStream();

    socket.emit('select-session', { sessionId, username: STATE.username });
    
    // Load Action Panel
    loadActionPanel();
    
    // Check viewer count to decide protocol
    const session = STATE.sessions.find(s => s.sessionId === sessionId);
    const viewerCount = session ? session.playerCount : 0;
    const forceCDN = document.getElementById('force-cdn-toggle')?.checked;
    
    // Threshold: > 50 viewers -> HLS (Bunny CDN)
    if (viewerCount > 50 || forceCDN) {
        console.log(`[Protocol] Switching to HLS (Bunny CDN). Force: ${forceCDN}, Viewers: ${viewerCount}`);
        STATE.useHLS = true;
        initializeStream(sessionId);
    } else {
        console.log(`[Protocol] Low load (${viewerCount} viewers). Using WebSocket streaming.`);
        STATE.useHLS = false;
        initializeStream(sessionId);
    }

    // Initial Fetch
    fetch(`/api/session/${encodeURIComponent(sessionId)}`)
        .then(res => res.json())
        .then(data => {
            if (data.session) {
                STATE.sessionRequiresPassword = data.session.requiresPassword;
                const nameEl = document.getElementById('current-session-name');
                if(nameEl) {
                    const safeMapName = escapeHtml(data.session.mapName || 'Unknown Colony');
                    if (STATE.sessionRequiresPassword) {
                        nameEl.innerHTML = `${safeMapName} <i class="fa-solid fa-lock text-rat-red text-xs ml-2"></i>`;
                    } else {
                        nameEl.textContent = data.session.mapName;
                    }
                }
                const colCount = document.getElementById('colonist-count');
                if(colCount) colCount.textContent = data.session.colonistCount;
                
                const wealth = document.getElementById('wealth');
                if(wealth) wealth.textContent = `${(data.session.wealth / 1000).toFixed(1)}k`;
            }
        })
        .catch(err => console.error("Error:", err));

    fetchEconomyData(sessionId);
}

function fetchEconomyData(sessionId) {
    // Get prices
    fetch(`/api/economy/${encodeURIComponent(sessionId)}/prices`)
        .then(res => res.json())
        .then(data => {
            if (data.prices) {
                STATE.actionCosts = data.prices;
                updateActionButtonsCosts(); 
            }
        })
        .catch(e => console.error('Error fetching prices:', e));

    // Get balance
    if (STATE.username) {
        fetch(`/api/economy/${encodeURIComponent(sessionId)}/balance/${encodeURIComponent(STATE.username)}`)
            .then(res => res.json())
            .then(data => {
                if (data.coins !== undefined) {
                    const coinBalance = document.getElementById('coin-balance');
                    if (coinBalance) {
                        coinBalance.textContent = `💰 ${data.coins.toLocaleString()} CREDITS`;
                        coinBalance.classList.remove('hidden');
                    }
                }
            })
            .catch(e => console.error('Error fetching balance:', e));
    }
}
