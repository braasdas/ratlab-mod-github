import { STATE } from './state.js';
import { showFeedback } from './ui.js';

export async function sendAction(action, data, buttonElement) {
    if (!STATE.currentSession) {
        showFeedback('error', 'NO SIGNAL');
        return;
    }

    if (STATE.sessionRequiresPassword && !STATE.sessionPassword) {
        // Show password modal and wait for user input
        showPasswordModal(action, data, buttonElement);
        return;
    }

    // Economy Check
    const cost = STATE.actionCosts[action] || 0;
    const coinBalance = document.getElementById('coin-balance');

    if (cost > 0) {
        const currentCoinText = coinBalance ? coinBalance.textContent.replace(/[^0-9]/g, '') : '0';
        const currentCoins = parseInt(currentCoinText);
        
        if (currentCoins < cost) {
            showFeedback('error', `INSUFFICIENT FUNDS (${cost} CREDITS)`);
            return;
        }
    }

    if (buttonElement) {
        buttonElement.disabled = true;
        buttonElement.classList.add('sending');
    }

    try {
        // Economy handled by server in /api/action now
        const response = await fetch('/api/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: STATE.currentSession,
                username: STATE.username,
                password: STATE.sessionPassword,
                action: action,
                data: typeof data === 'string' ? data : JSON.stringify(data)
            })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            showFeedback('success', 'COMMAND TRANSMITTED');
        } else {
            showFeedback('error', result.error || 'COMMAND FAILED');
        }

    } catch (error) {
        console.error('Action failed:', error);
        showFeedback('error', 'TRANSMISSION ERROR');
    } finally {
        if (buttonElement) {
            buttonElement.disabled = false;
            buttonElement.classList.remove('sending');
        }
    }
}

function showPasswordModal(action, data, buttonElement) {
    const modal = document.getElementById('password-modal');
    const input = document.getElementById('interaction-password-input');
    const submitBtn = document.getElementById('submit-password-btn');
    const closeBtn = document.getElementById('close-password-modal');
    const errorDiv = document.getElementById('password-error');

    if (!modal || !input || !submitBtn) {
        console.error('[Password Modal] Elements not found');
        showFeedback('error', 'PASSWORD MODAL ERROR');
        return;
    }

    // Reset modal state
    input.value = '';
    if (errorDiv) errorDiv.classList.add('hidden');

    // Show modal
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    // Focus input
    setTimeout(() => input.focus(), 100);

    // Handle password submission
    const handleSubmit = async () => {
        const password = input.value.trim();

        if (!password) {
            if (errorDiv) {
                errorDiv.textContent = 'Password Required';
                errorDiv.classList.remove('hidden');
            }
            return;
        }

        // Store password in STATE
        STATE.sessionPassword = password;

        // Hide modal
        modal.classList.add('hidden');
        modal.classList.remove('flex');

        // Retry the action with the password
        await sendAction(action, data, buttonElement);
    };

    // Submit button click handler
    const submitHandler = () => handleSubmit();
    submitBtn.onclick = submitHandler;

    // Enter key handler
    const enterHandler = (e) => {
        if (e.key === 'Enter') {
            handleSubmit();
        }
    };
    input.onkeypress = enterHandler;

    // Close button handler
    const closeHandler = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        if (buttonElement) {
            buttonElement.disabled = false;
            buttonElement.classList.remove('sending');
        }
    };
    if (closeBtn) closeBtn.onclick = closeHandler;
}
