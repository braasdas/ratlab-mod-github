import { destroyMyPawn } from './mypawn.js';

export function showLoading(message = "INITIALIZING...") {
    const loadingText = document.getElementById('loading-text');
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingText) loadingText.textContent = message;
    if (loadingScreen) {
        loadingScreen.classList.add('active');
        loadingScreen.classList.remove('hidden');
    }
}

export function hideLoading() {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
        loadingScreen.classList.remove('active');
        loadingScreen.classList.add('hidden');
    }
}

export function showFeedback(type, message) {
    const toast = document.createElement('div');
    toast.className = `feedback-toast ${type}`;

    // Create icon element
    const icon = document.createElement('i');
    icon.className = type === 'success' ? 'fa-solid fa-check' : 'fa-solid fa-triangle-exclamation';

    // Create text node (safe - no HTML injection)
    const text = document.createTextNode(' ' + (message || ''));

    toast.appendChild(icon);
    toast.appendChild(text);
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Track current tab to detect when leaving my-pawn
let currentTab = localStorage.getItem('activeTab') || 'stream';

export function switchTab(tabId) {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    // FIX: Cleanup when leaving my-pawn tab to prevent memory leak
    if (currentTab === 'my-pawn' && tabId !== 'my-pawn') {
        destroyMyPawn();
    }
    currentTab = tabId;

    // Update buttons
    tabButtons.forEach(btn => {
        if (btn.dataset.tab === tabId) {
            btn.classList.add('active', 'bg-rat-dark', 'border-rat-border', 'text-rat-green');
            btn.classList.remove('border-transparent', 'text-rat-text-dim');
        } else {
            btn.classList.remove('active', 'bg-rat-dark', 'border-rat-border', 'text-rat-green');
            btn.classList.add('border-transparent', 'text-rat-text-dim');
        }
    });

    // Update panes
    tabPanes.forEach(pane => {
        if (pane.id === `tab-${tabId}`) {
            pane.classList.add('active');
        } else {
            pane.classList.remove('active');
        }
    });

    // Save to storage
    localStorage.setItem('activeTab', tabId);

    // Fix: Trigger resize for MapRenderer if switching to my-pawn
    if (tabId === 'my-pawn') {
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 50);
    }

    // Fix: Restore video viewport dimensions when switching back to stream tab
    if (tabId === 'stream') {
        setTimeout(() => {
            const video = document.getElementById('game-screenshot');
            const viewport = document.getElementById('visual-viewport');
            if (viewport && video && video.videoWidth && video.videoHeight) {
                // Recalculate height based on viewport width and video aspect ratio
                const aspectRatio = video.videoHeight / video.videoWidth;
                const viewportWidth = viewport.offsetWidth;
                const newHeight = Math.round(viewportWidth * aspectRatio);
                viewport.style.height = `${newHeight}px`;
                viewport.classList.add('has-video');
                console.log(`[UI] Restored viewport: ${viewportWidth}x${newHeight}`);
            }
        }, 50);
    }
}

export function updateConnectionStatus(connected) {
    const connectionStatus = document.getElementById('connection-status');
    if (!connectionStatus) return;
    const statusDot = connectionStatus.querySelector('.status-dot');
    const statusText = connectionStatus.querySelector('.status-text');

    if (connected) {
        connectionStatus.classList.remove('disconnected');
        connectionStatus.classList.add('connected');
        connectionStatus.classList.add('text-rat-green');
        statusDot.classList.remove('bg-rat-red');
        statusDot.classList.add('bg-rat-green');
        statusDot.classList.add('shadow-[0_0_10px_#00ff41]');
        statusText.textContent = 'LINK ESTABLISHED';
    } else {
        connectionStatus.classList.remove('connected');
        connectionStatus.classList.add('disconnected');
        connectionStatus.classList.remove('text-rat-green');
        statusDot.classList.remove('bg-rat-green');
        statusDot.classList.remove('shadow-[0_0_10px_#00ff41]');
        statusDot.classList.add('bg-rat-red');
        statusText.textContent = 'NO SIGNAL';
    }
}
