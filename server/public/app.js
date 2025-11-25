// Socket.IO connection
const socket = io();

// State management
let currentSession = null;
let sessions = [];

// DOM Elements
const sessionSelection = document.getElementById('session-selection');
const gameViewer = document.getElementById('game-viewer');
const sessionsList = document.getElementById('sessions-list');
const gameScreenshot = document.getElementById('game-screenshot');
const colonistsList = document.getElementById('colonists-list');
const connectionStatus = document.getElementById('connection-status');
const backButton = document.getElementById('back-button');
const currentSessionName = document.getElementById('current-session-name');
const colonistCount = document.getElementById('colonist-count');
const wealthDisplay = document.getElementById('wealth');
const viewerCount = document.getElementById('viewer-count');
const lastUpdate = document.getElementById('last-update');

// Socket event handlers
socket.on('connect', () => {
    console.log('Connected to server');
    updateConnectionStatus(true);
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    updateConnectionStatus(false);
});

socket.on('sessions-list', (data) => {
    sessions = data.sessions;
    renderSessionsList();
});

socket.on('screenshot-update', (data) => {
    if (currentSession && data.sessionId === currentSession) {
        gameScreenshot.src = `data:image/png;base64,${data.screenshot}`;
        const now = new Date(data.timestamp);
        lastUpdate.textContent = `Last update: ${now.toLocaleTimeString()}`;
    }
});

socket.on('gamestate-update', (data) => {
    if (currentSession && data.sessionId === currentSession) {
        updateGameState(data.gameState);
    }
});

// UI Functions
function updateConnectionStatus(connected) {
    if (connected) {
        connectionStatus.classList.remove('disconnected');
        connectionStatus.classList.add('connected');
        connectionStatus.querySelector('.status-text').textContent = 'Connected';
    } else {
        connectionStatus.classList.remove('connected');
        connectionStatus.classList.add('disconnected');
        connectionStatus.querySelector('.status-text').textContent = 'Disconnected';
    }
}

function renderSessionsList() {
    if (sessions.length === 0) {
        sessionsList.innerHTML = `
            <div class="no-sessions">
                <p>No active game sessions found</p>
                <p class="hint">Start RimWorld with the Player Storyteller mod to begin</p>
            </div>
        `;
        return;
    }

    sessionsList.innerHTML = sessions.map(session => `
        <div class="session-card" onclick="selectSession('${session.sessionId}')">
            <h3>${session.mapName}</h3>
            <div class="stat">
                <span>Colonists:</span>
                <span>${session.colonistCount}</span>
            </div>
            <div class="stat">
                <span>Wealth:</span>
                <span>$${session.wealth.toLocaleString()}</span>
            </div>
            <div class="stat">
                <span>Viewers:</span>
                <span>${session.playerCount}</span>
            </div>
            <div class="stat">
                <span>Last Update:</span>
                <span>${new Date(session.lastUpdate).toLocaleTimeString()}</span>
            </div>
        </div>
    `).join('');
}

function selectSession(sessionId) {
    currentSession = sessionId;

    // Switch to game viewer screen
    sessionSelection.classList.remove('active');
    gameViewer.classList.add('active');

    // Notify server
    socket.emit('select-session', sessionId);

    // Update session info
    const session = sessions.find(s => s.sessionId === sessionId);
    if (session) {
        currentSessionName.textContent = session.mapName;
        colonistCount.textContent = `${session.colonistCount} colonists`;
        wealthDisplay.textContent = `Wealth: $${session.wealth.toLocaleString()}`;
    }
}

function updateGameState(gameState) {
    // Update header stats
    colonistCount.textContent = `${gameState.colonistCount || 0} colonists`;
    wealthDisplay.textContent = `Wealth: $${(gameState.wealth || 0).toLocaleString()}`;
    currentSessionName.textContent = gameState.mapName || 'Unknown';

    // Update colonists list
    if (gameState.colonists && gameState.colonists.length > 0) {
        colonistsList.innerHTML = gameState.colonists.map(colonist => `
            <div class="colonist-card">
                <h4>${colonist.name || 'Unknown'}</h4>
                <div class="colonist-stat">
                    <span>Health:</span>
                    <span>${Math.round((colonist.health || 0) * 100)}%</span>
                </div>
                <div class="health-bar">
                    <div class="health-bar-fill" style="width: ${(colonist.health || 0) * 100}%"></div>
                </div>
                <div class="colonist-stat">
                    <span>Mood:</span>
                    <span>${Math.round((colonist.mood || 0) * 100)}%</span>
                </div>
                <div class="mood-bar">
                    <div class="mood-bar-fill" style="width: ${(colonist.mood || 0) * 100}%"></div>
                </div>
                <div class="colonist-stat">
                    <span>Position:</span>
                    <span>(${colonist.position?.x || 0}, ${colonist.position?.z || 0})</span>
                </div>
            </div>
        `).join('');
    } else {
        colonistsList.innerHTML = '<p class="loading">No colonist data available</p>';
    }
}

// Event listeners
backButton.addEventListener('click', () => {
    currentSession = null;
    gameViewer.classList.remove('active');
    sessionSelection.classList.add('active');

    // Clear screenshot
    gameScreenshot.src = '';
});

// Action buttons
document.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const action = btn.dataset.action;

        if (!currentSession) {
            alert('No session selected');
            return;
        }

        // Send action to server
        fetch('/api/action', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sessionId: currentSession,
                action: action,
                data: {}
            })
        })
        .then(response => response.json())
        .then(data => {
            console.log('Action sent:', action);
            // Visual feedback
            btn.style.background = 'var(--success)';
            setTimeout(() => {
                btn.style.background = '';
            }, 500);
        })
        .catch(error => {
            console.error('Error sending action:', error);
            alert('Failed to send action');
        });
    });
});

// Refresh sessions list periodically
setInterval(() => {
    if (!currentSession) {
        fetch('/api/sessions')
            .then(response => response.json())
            .then(data => {
                sessions = data.sessions;
                renderSessionsList();
            })
            .catch(error => console.error('Error fetching sessions:', error));
    }
}, 5000);
