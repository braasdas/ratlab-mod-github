import { STATE } from './state.js';
import { showFeedback } from './ui.js';

export async function sendAction(action, data, buttonElement) {
    if (!STATE.currentSession) {
        showFeedback('error', 'NO SIGNAL');
        return;
    }

    if (STATE.sessionRequiresPassword && !STATE.sessionPassword) {
        // TODO: Implement password modal trigger
        showFeedback('error', 'SESSION PASSWORD REQUIRED');
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
