import { STATE } from './state.js';
import { sendAction } from './interactions.js';
import { showFeedback } from './ui.js';

export async function loadActionPanel() {
    try {
        const response = await fetch('/components/action-panel.html');
        const html = await response.text();
        const container = document.getElementById('action-panel-container');
        if (container) {
            container.innerHTML = html;
            initializeActionPanel();
        }
    } catch (error) {
        console.error('Error loading action panel:', error);
    }
}

function initializeActionPanel() {
    const messageInput = document.getElementById('message-input');
    const charCount = document.getElementById('char-count');
    const sendMessageBtn = document.getElementById('send-message-btn');

    if (messageInput && charCount) {
        // Apply classes dynamically if they aren't in the HTML, 
        // mimicking original app.js behavior or ensuring consistency
        messageInput.classList.add('bg-rat-black', 'border', 'border-rat-border', 'text-white', 'p-2', 'rounded', 'w-full', 'mb-2');
        if(sendMessageBtn) sendMessageBtn.classList.add('bg-rat-green', 'text-black', 'uppercase', 'py-2', 'px-4', 'rounded', 'hover:bg-white', 'transition-colors');

        messageInput.addEventListener('input', () => {
            const length = messageInput.value.length;
            charCount.textContent = length;
            charCount.style.color = length > 450 ? '#ff3333' : '#888';
        });
        
        // Allow Enter key
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessageBtn.click();
            }
        });
    }

    if (sendMessageBtn) {
        sendMessageBtn.addEventListener('click', () => {
            const message = messageInput.value.trim();
            if (!STATE.currentSession) {
                showFeedback('error', 'Link not established');
                return;
            }
            if (message.length < 3) {
                showFeedback('warning', 'Message too short');
                return;
            }
            // Mapped to 'send_letter' usually or generic 'message' action
            // Original code sent 'sendLetter'
            sendAction('sendLetter', message, sendMessageBtn);
            messageInput.value = '';
            charCount.textContent = '0';
        });
    }

    document.querySelectorAll('.action-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            if (action) sendAction(action, {}, btn);
        });
    });

    loadActionItemIcons();
    updateActionButtonsCosts();
}

export function updateActionButtonsCosts() {
    document.querySelectorAll('.action-btn').forEach(btn => {
        const action = btn.dataset.action;
        let cost = STATE.actionCosts[action];

        // Fallback to snake_case if not found (e.g. healColonist -> heal_colonist)
        const snakeKey = action ? action.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`) : '';
        if (cost === undefined && snakeKey) {
            cost = STATE.actionCosts[snakeKey];
        }

        // Check if action is disabled
        const isDisabled = STATE.disabledActions.has(action) || STATE.disabledActions.has(snakeKey);

        // Update button visual state for disabled actions
        if (isDisabled) {
            btn.classList.add('opacity-50', 'cursor-not-allowed', 'grayscale');
            btn.disabled = true;
            btn.title = 'This action has been disabled by the streamer';

            // Add disabled badge
            let disabledBadge = btn.querySelector('.disabled-badge');
            if (!disabledBadge) {
                disabledBadge = document.createElement('span');
                disabledBadge.className = 'disabled-badge text-[9px] bg-rat-red/20 border border-rat-red text-rat-red px-1 rounded absolute top-1 left-1 uppercase font-bold';
                btn.style.position = 'relative';
                btn.appendChild(disabledBadge);
            }
            disabledBadge.textContent = 'DISABLED';
        } else {
            btn.classList.remove('opacity-50', 'cursor-not-allowed', 'grayscale');
            btn.disabled = false;
            btn.title = '';

            // Remove disabled badge if it exists
            const disabledBadge = btn.querySelector('.disabled-badge');
            if (disabledBadge) disabledBadge.remove();
        }

        // Check if badge already exists
        let badge = btn.querySelector('.cost-badge');

        if (cost > 0 && !isDisabled) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'cost-badge text-[10px] bg-rat-black border border-rat-yellow text-rat-yellow px-1 rounded absolute top-1 right-1';
                btn.style.position = 'relative';
                btn.appendChild(badge);
            }
            badge.textContent = `${cost}c`;
        } else {
            if (badge) badge.remove();
        }
    });
}

export function loadActionItemIcons() {
    const itemContainers = document.querySelectorAll('.item-icon-container[data-item-def]');
    for (const container of itemContainers) {
        const defName = container.dataset.itemDef;
        if (!defName) continue;
        const imageData = STATE.itemIcons[defName];
        if (imageData && !container.querySelector('img')) {
            const img = document.createElement('img');
            img.src = `data:image/png;base64,${imageData}`;
            img.alt = defName;
            img.className = 'w-8 h-8 object-contain';
            container.innerHTML = '';
            container.appendChild(img);
        }
    }
}
