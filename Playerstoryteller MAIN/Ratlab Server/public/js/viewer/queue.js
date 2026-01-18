import { STATE } from './state.js';
import { showFeedback } from './ui.js';
import { socket } from './socket.js';
import { escapeHtml, escapeAttr } from './sanitize.js';

let queueTimerInterval = null;

export function initializeQueue() {
    const btnOpenModal = document.getElementById('btn-submit-request');
    const modal = document.getElementById('queue-modal');
    const btnClose = document.getElementById('close-queue-modal');
    const btnSubmit = document.getElementById('submit-queue-btn');
    
    // Tab Logic
    const tabSuggestion = document.getElementById('qtab-suggestion');
    const tabMonument = document.getElementById('qtab-monument');
    const viewSuggestion = document.getElementById('qview-suggestion');
    const viewMonument = document.getElementById('qview-monument');
    
    let activeTab = 'suggestion';

    if (btnOpenModal && modal) {
        btnOpenModal.addEventListener('click', () => {
            if (!STATE.username) {
                showFeedback('error', 'LOGIN REQUIRED');
                return;
            }
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            
            // Default to suggestion
            activeTab = 'suggestion';
            updateTabs();
            document.getElementById('queue-input').focus();
        });
        
        // Close on X
        if (btnClose) {
            btnClose.addEventListener('click', () => {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            });
        }
        
        // Close on Submit
        if (btnSubmit) {
            btnSubmit.addEventListener('click', () => submitQueueRequest(activeTab));
        }
        
        // Close on Outside Click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }
        });

        // Tab Switching
        if (tabSuggestion && tabMonument) {
            tabSuggestion.onclick = () => { activeTab = 'suggestion'; updateTabs(); };
            tabMonument.onclick = () => { activeTab = 'monument'; updateTabs(); };
        }
    }

    function updateTabs() {
        if (activeTab === 'suggestion') {
            tabSuggestion.classList.add('text-rat-green', 'border-rat-green');
            tabSuggestion.classList.remove('text-rat-text-dim', 'border-transparent', 'hover:text-white');
            tabMonument.classList.remove('text-rat-green', 'border-rat-green');
            tabMonument.classList.add('text-rat-text-dim', 'border-transparent', 'hover:text-white');
            
            viewSuggestion.classList.remove('hidden');
            viewMonument.classList.add('hidden');
            if (btnSubmit) {
                btnSubmit.textContent = 'Submit to Vote';
                btnSubmit.disabled = false;
                btnSubmit.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        } else {
            tabMonument.classList.add('text-rat-green', 'border-rat-green');
            tabMonument.classList.remove('text-rat-text-dim', 'border-transparent', 'hover:text-white');
            tabSuggestion.classList.remove('text-rat-green', 'border-rat-green');
            tabSuggestion.classList.add('text-rat-text-dim', 'border-transparent', 'hover:text-white');
            
            viewMonument.classList.remove('hidden');
            viewSuggestion.classList.add('hidden');
            if (btnSubmit) {
                btnSubmit.textContent = 'Blueprint Uplink Offline';
                btnSubmit.disabled = true;
                btnSubmit.classList.add('opacity-50', 'cursor-not-allowed');
            }
        }
    }
    
    // Initial fetch if session is active
    if (STATE.currentSession) {
        fetchQueueData(STATE.currentSession);
    }
    
    // Listen for socket updates
    socket.on('queue-update', (data) => {
        if (data.queue) updateQueueList(data.queue);
    });
}

export function fetchQueueData(sessionId) {
    if (!sessionId) return;
    
    fetch(`/api/queue/${encodeURIComponent(sessionId)}`)
        .then(res => res.json())
        .then(data => {
            if (data.queue) updateQueueList(data.queue);
        })
        .catch(err => console.error('Error fetching queue:', err));
}

// ============================================
// INTERNAL LOGIC
// ============================================

function submitQueueRequest(type) {
    if (!STATE.username) {
        showFeedback('error', 'LOGIN REQUIRED');
        return;
    }

    if (type === 'monument') {
        showFeedback('error', 'FEATURE DISABLED');
        return;
    }

    const input = document.getElementById('queue-input');
    const suggestion = input.value.trim();
    if (suggestion.length === 0) return;

    // Loading state
    const btn = document.getElementById('submit-queue-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'TRANSMITTING...';

    fetch(`/api/queue/${encodeURIComponent(STATE.currentSession)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: STATE.username,
            type: 'suggestion',
            data: suggestion
        })
    })
    .then(res => res.json())
    .then(result => {
        if (result.success) {
            showFeedback('success', 'REQUEST SUBMITTED');
            fetchQueueData(STATE.currentSession);
            
            // Clear and Close
            input.value = '';
            const modal = document.getElementById('queue-modal');
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        } else {
            showFeedback('error', result.error || 'SUBMISSION FAILED');
        }
    })
    .catch(e => {
        console.error(e);
        showFeedback('error', 'NETWORK ERROR');
    })
    .finally(() => {
        btn.disabled = false;
        btn.textContent = originalText;
    });
}

function updateQueueList(queue) {
    const queueList = document.getElementById('queue-list');
    if (!queueList) return;

    const requests = queue.requests || [];
    
    // Update Timer
    startQueueTimer(queue.lastProcessed, queue.settings?.voteDuration);

    if (requests.length === 0) {
        queueList.innerHTML = `
            <div class="text-center py-10 border border-rat-border border-dashed rounded-lg bg-rat-panel">
                <i class="fa-solid fa-inbox text-4xl text-rat-text-dim mb-4"></i>
                <p class="font-mono text-rat-green">QUEUE EMPTY</p>
                <p class="text-sm text-rat-text-dim mt-2">Be the first to submit a request.</p>
            </div>
        `;
        return;
    }

    // Calculate net votes for each request
    requests.forEach(req => {
        req.upvotes = req.votes.filter(v => v.type === 'upvote').length;
        req.downvotes = req.votes.filter(v => v.type === 'downvote').length;
        req.netVotes = req.upvotes - req.downvotes;
    });

    // Sort by net votes (desc) then time (asc)
    requests.sort((a, b) => {
        if (b.netVotes !== a.netVotes) return b.netVotes - a.netVotes;
        return new Date(a.submittedAt) - new Date(b.submittedAt);
    });

    queueList.innerHTML = requests.map(req => {
        const userUpvoted = req.votes.some(v => v.username === STATE.username && v.type === 'upvote');
        const userDownvoted = req.votes.some(v => v.username === STATE.username && v.type === 'downvote');

        const upvoteBtnClass = userUpvoted ? 'bg-rat-green text-black' : 'bg-rat-dark text-rat-green border border-rat-green hover:bg-rat-green hover:text-black';
        const downvoteBtnClass = userDownvoted ? 'bg-rat-red text-black' : 'bg-rat-dark text-rat-red border border-rat-red hover:bg-rat-red hover:text-black';

        let label, subtext;

        if (req.type === 'suggestion') {
             label = escapeHtml(req.data); // SANITIZE user input
             subtext = 'IDEA';
        } else {
             // Basic formatting for non-suggestion types (if any)
             label = escapeHtml(req.action || req.data);
             subtext = req.cost ? `${escapeHtml(req.cost)}c` : 'ACTION';
        }

        // Sanitize user-controlled fields
        const safeSubmittedBy = escapeHtml(req.submittedBy);
        const safeId = escapeAttr(req.id);

        return `
        <div class="bg-rat-panel border border-rat-border rounded-lg p-4 flex justify-between items-center">
            <div class="flex-1 min-w-0 mr-4">
                <div class="flex flex-col gap-1 mb-1">
                    <span class="font-mono text-lg text-white break-words leading-tight">${label}</span>
                    <span class="text-xs bg-rat-dark border border-rat-border px-2 py-0.5 rounded text-rat-text-dim w-fit">${subtext}</span>
                </div>
                <div class="text-xs text-rat-text-dim font-mono">
                    BY: <span class="text-rat-green">${safeSubmittedBy}</span> • ${new Date(req.submittedAt).toLocaleTimeString()}
                </div>
            </div>

            <div class="flex flex-col items-center gap-2">
                <div class="text-center">
                    <div class="text-2xl font-mono font-bold text-white">${req.netVotes}</div>
                    <div class="text-[10px] text-rat-text-dim uppercase">NET VOTES</div>
                </div>
                <div class="flex gap-2">
                    <button class="btn-vote-up px-3 py-1 rounded font-mono font-bold transition-all ${upvoteBtnClass}"
                        data-id="${safeId}">
                        <i class="fa-solid fa-thumbs-up"></i>
                    </button>
                    <button class="btn-vote-down px-3 py-1 rounded font-mono font-bold transition-all ${downvoteBtnClass}"
                        data-id="${safeId}">
                        <i class="fa-solid fa-thumbs-down"></i>
                    </button>
                </div>
            </div>
        </div>
    `}).join('');
    
    // Attach listeners
    document.querySelectorAll('.btn-vote-up').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!STATE.username) {
                showFeedback('error', 'LOGIN REQUIRED');
                return;
            }
            const requestId = btn.dataset.id;
            fetch(`/api/queue/${encodeURIComponent(STATE.currentSession)}/vote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId, username: STATE.username, voteType: 'upvote' })
            }).then(() => fetchQueueData(STATE.currentSession));
        });
    });

    document.querySelectorAll('.btn-vote-down').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!STATE.username) {
                showFeedback('error', 'LOGIN REQUIRED');
                return;
            }
            const requestId = btn.dataset.id;
            fetch(`/api/queue/${encodeURIComponent(STATE.currentSession)}/vote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId, username: STATE.username, voteType: 'downvote' })
            }).then(() => fetchQueueData(STATE.currentSession));
        });
    });
}

function startQueueTimer(lastProcessedStr, durationSeconds) {
    const timerEl = document.getElementById('queue-timer');
    if (!timerEl) return;

    if (queueTimerInterval) clearInterval(queueTimerInterval);

    // Handle case where lastProcessed is missing (start now)
    const lastProcessed = lastProcessedStr ? new Date(lastProcessedStr).getTime() : Date.now();
    const durationMs = (durationSeconds || 600) * 1000;
    const targetTime = lastProcessed + durationMs;

    function update() {
        const now = Date.now();
        const remaining = targetTime - now;

        if (remaining <= 0) {
             timerEl.textContent = "EXECUTING...";
             return;
        }

        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        
        timerEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    update(); // Initial call
    queueTimerInterval = setInterval(update, 1000);
}
