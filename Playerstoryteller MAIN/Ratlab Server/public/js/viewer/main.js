import { STATE } from './state.js';
import { updateConnectionStatus, switchTab, showFeedback } from './ui.js';
import { socket } from './socket.js';
import { updateGameState } from './gameData.js';
import { handleMapImageUpdate, initializeMapControls } from './map.js';
import { sendAction } from './interactions.js';
import { selectSession, renderSessionsList } from './session.js';
import { openContentBrowser, closeContentBrowser, selectBrowserItem } from './contentBrowser.js';
import { updateActionButtonsCosts } from './actions.js';
import { initializeMyPawn } from './mypawn.js';
import { initializeQueue } from './queue.js';

// ============================================
// GLOBAL EVENT LISTENERS
// ============================================

// Window Load
window.addEventListener('load', () => {
    // Initialize My Pawn module (button listeners)
    initializeMyPawn();
    
    // Initialize Queue module
    initializeQueue();

    // Initialize Map Controls
    initializeMapControls();

    // Check for direct session link
    const urlParams = new URLSearchParams(window.location.search);
    const directSessionId = urlParams.get('session');

    // Initialize tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab(btn.dataset.tab);
        });
    });

    // Load saved tab
    const savedTab = localStorage.getItem('activeTab');
    if (savedTab && savedTab !== 'queue') {
        const targetPane = document.getElementById(`tab-${savedTab}`);
        if (targetPane) switchTab(savedTab);
        else switchTab('stream');
    } else {
        switchTab('stream');
    }

    // View Mode Switcher (Camera/Map)
    document.querySelectorAll('.view-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            
            document.querySelectorAll('.view-mode-btn').forEach(b => {
                if (b.dataset.mode === mode) {
                    b.classList.add('active', 'text-rat-green', 'bg-rat-dark');
                    b.classList.remove('hover:text-white');
                } else {
                    b.classList.remove('active', 'text-rat-green', 'bg-rat-dark');
                    b.classList.add('hover:text-white');
                }
            });

            const viewCamera = document.getElementById('view-camera');
            const viewMap = document.getElementById('view-map');
            const mapControls = document.getElementById('map-controls');

            if (mode === 'camera') {
                viewCamera.classList.remove('hidden');
                viewMap.classList.add('hidden');
                if (mapControls) mapControls.classList.add('hidden');
            } else {
                viewCamera.classList.add('hidden');
                viewMap.classList.remove('hidden');
                if (mapControls) mapControls.classList.remove('hidden');
            }
        });
    });
});


// ============================================
// SOCKET LISTENERS
// ============================================

socket.on('sessions-list', (data) => {
    STATE.sessions = data.sessions;
    renderSessionsList();

    const urlParams = new URLSearchParams(window.location.search);
    const directSessionId = urlParams.get('session');

    if (directSessionId && !STATE.currentSession) {
        const existingSession = STATE.sessions.find(s => s.sessionId === directSessionId);
        if (existingSession) {
            selectSession(directSessionId);
        } else {
             // Private session fetch attempt
             fetch(`/api/session/${encodeURIComponent(directSessionId)}`)
                .then(r => r.ok ? r.json() : null)
                .then(data => {
                    if (data && data.session) {
                        if (!STATE.sessions.find(s => s.sessionId === data.session.sessionId)) {
                            STATE.sessions.push(data.session);
                        }
                        selectSession(directSessionId);
                    } else {
                        // Invalid
                         const url = new URL(window.location);
                        url.searchParams.delete('session');
                        window.history.replaceState({}, '', url);
                    }
                });
        }
    }
});

socket.on('gamestate-update', (data) => {
    if (STATE.currentSession && data.sessionId === STATE.currentSession) {
        updateGameState(data.gameState);
    }
});

socket.on('map-image-update', handleMapImageUpdate);

socket.on('screenshot-update', (data) => {
    // Legacy support for socket.io screenshots (fallback)
    if (!STATE.useWebSocket && !STATE.useHLS && STATE.currentSession && data.sessionId === STATE.currentSession) {
        const video = document.getElementById('game-screenshot');
        if (data.screenshot) {
            video.style.display = 'block';
             if (video.src.startsWith('blob:')) {
                URL.revokeObjectURL(video.src);
            }
            if (typeof data.screenshot === 'string') {
                 video.src = `data:image/jpeg;base64,${data.screenshot}`;
            } else {
                const blob = new Blob([data.screenshot], { type: 'image/jpeg' });
                video.src = URL.createObjectURL(blob);
            }
             const lastUpdate = document.getElementById('last-update');
             if(lastUpdate) lastUpdate.textContent = `LAST UPDATE: ${new Date(data.timestamp).toLocaleTimeString()}`;
        }
    }
});

socket.on('coin-update', (data) => {
    if (data.username === STATE.username) {
        const coinBalance = document.getElementById('coin-balance');
        if (coinBalance) {
            coinBalance.textContent = `💰 ${data.coins.toLocaleString()} CREDITS`;
            coinBalance.classList.remove('hidden');
        }
    }
});

socket.on('economy-config-update', (data) => {
    if (data.actionCosts) {
        STATE.actionCosts = data.actionCosts;
        updateActionButtonsCosts(); 
    }
});

socket.on('viewer-count-update', (data) => {
    if (STATE.currentSession && data.sessionId === STATE.currentSession) {
        const countEl = document.getElementById('viewer-count');
        if (countEl) countEl.textContent = `${data.viewerCount} WATCHING`;
    }
});


// ============================================
// EXPOSE TO WINDOW (for HTML onclick)
// ============================================

window.selectSession = selectSession;
window.openContentBrowser = openContentBrowser;
window.closeContentBrowser = closeContentBrowser;
window.selectBrowserItem = selectBrowserItem;
window.switchTab = switchTab;

window.addEventListener('ratlab:action', (e) => {
    const { action, data, cost } = e.detail;
    // We can handle confirmation here or just send
    sendAction(action, data);
});

// Expose generic action sender for static buttons
window.triggerAction = (action, data = {}, cost = 0) => {
    sendAction(action, data);
};