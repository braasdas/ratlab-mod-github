import { STATE } from './state.js';
import { showFeedback } from './ui.js';
import { sendAction } from './interactions.js';

let isMyPawnInitialized = false;

export function initializeMyPawn() {
    if (isMyPawnInitialized) return;
    
    const adoptBtnMain = document.getElementById('btn-adopt-request-main');
    if (adoptBtnMain) {
        adoptBtnMain.onclick = async () => {
             if (!STATE.username) {
                 showFeedback('error', 'LOGIN REQUIRED');
                 return;
             }
             
             adoptBtnMain.disabled = true;
             const originalText = adoptBtnMain.innerHTML;
             adoptBtnMain.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> PROCESSING';
             
             try {
                // Request Adoption (Random/Next Available)
                const res = await fetch(`/api/adoptions/${encodeURIComponent(STATE.currentSession)}/request`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: STATE.username })
                });
                
                const result = await res.json();
                
                if (result.success) {
                    showFeedback('success', 'UPLINK ESTABLISHED');
                    // Force immediate status check if available, or wait for next poll/update
                    // We assume main loop will handle UI switch
                } else {
                    showFeedback('error', result.error || 'CONNECTION FAILED');
                }
             } catch (e) {
                 showFeedback('error', 'NETWORK ERROR');
                 console.error(e);
             } finally {
                 adoptBtnMain.disabled = false;
                 adoptBtnMain.innerHTML = originalText;
             }
        };
    }
    
    isMyPawnInitialized = true;
}

export function updateMyPawnUI(gameState) {
    if (!STATE.myPawnId || !gameState.colonists) return;

    // Find our pawn
    const myPawnEntry = gameState.colonists.find(c => {
        const p = c.colonist || c;
        return String(p.id || p.pawn_id) == String(STATE.myPawnId);
    });

    if (!myPawnEntry) {
        const el = document.getElementById('my-pawn-name');
        if(el) el.textContent = "SIGNAL LOST (PAWN NOT FOUND)";
        return;
    }

    const pawn = myPawnEntry.colonist || myPawnEntry;
    const workInfo = myPawnEntry.colonist_work_info || {};

    // 1. Header Info
    const nameEl = document.getElementById('my-pawn-name');
    if(nameEl) nameEl.textContent = (pawn.name || 'Unknown').toUpperCase();
    
    const jobEl = document.getElementById('my-pawn-job');
    if(jobEl) jobEl.textContent = `ACTIVITY: ${(pawn.current_activity || workInfo.current_job || 'Idle').toUpperCase()}`;
    
    const pos = pawn.position || {x:0, z:0};
    const locEl = document.getElementById('my-pawn-location');
    if(locEl) locEl.textContent = `LOC: [${pos.x}, ${pos.z}]`;

    // 2. Vitals
    const health = pawn.health !== undefined ? pawn.health : 0;
    const mood = pawn.mood !== undefined ? pawn.mood : 0;
    
    const healthBar = document.getElementById('my-pawn-health-bar');
    if(healthBar) healthBar.style.width = `${health * 100}%`;
    
    const moodBar = document.getElementById('my-pawn-mood-bar');
    if(moodBar) moodBar.style.width = `${mood * 100}%`;

    // 3. Live Feed & Portrait
    const portraitContainer = document.getElementById('my-pawn-portrait-container');
    const liveViewPanel = document.getElementById('my-pawn-live-view-panel');
    const liveViewContainer = document.getElementById('my-pawn-live-view-container');
    
    const pawnViewData = gameState.pawn_views ? gameState.pawn_views[String(STATE.myPawnId)] : null;
    const portraitData = STATE.colonistPortraits[String(STATE.myPawnId)];

    // Always set header portrait if available (as fallback/identity)
    if (portraitData && portraitContainer) {
        portraitContainer.innerHTML = `<img src="data:image/png;base64,${portraitData}" class="w-full h-full object-cover">`;
    } else if (portraitContainer) {
        portraitContainer.innerHTML = `<div class="w-full h-full flex items-center justify-center text-xs text-rat-green animate-pulse">SCANNING</div>`;
    }

    if (liveViewPanel && liveViewContainer) {
        // Always Show Panel when adopted
        liveViewPanel.classList.remove('hidden');

        if (pawnViewData) {
             // Render Live Image
             liveViewContainer.innerHTML = `
                <img src="data:image/jpeg;base64,${pawnViewData}" class="w-full h-full object-cover">
                <div class="absolute inset-0 bg-black/50 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                    <span class="text-rat-green font-mono text-xs border border-rat-green px-2 py-1 rounded bg-black/80">CLICK TO ORDER</span>
                </div>
            `;
            
            // Attach Click Handler for Orders
            const img = liveViewContainer.querySelector('img');
            if (img) {
                img.onclick = (e) => {
                    e.stopPropagation();
                    const rect = img.getBoundingClientRect();
                    const relX = (e.clientX - rect.left) / rect.width;
                    const relY = (e.clientY - rect.top) / rect.height;
                    
                    // World Calculation (Ortho 15 -> Size 30)
                    const worldWidth = 30;
                    const worldHeight = 30;
                    
                    // Pawn is at center of the captured view
                    const targetX = Math.round(pos.x + (relX - 0.5) * worldWidth);
                    const targetZ = Math.round(pos.z + (0.5 - relY) * worldHeight); // Y screen down = Z world down (usually)

                    console.log(`Order: ${targetX}, ${targetZ}`);

                    sendAction('colonist_command', JSON.stringify({
                        type: 'order',
                        pawnId: STATE.myPawnId,
                        x: targetX,
                        z: targetZ
                    }));
                    
                    // Visual feedback (Ripple)
                    const ripple = document.createElement('div');
                    ripple.className = 'ping-ripple';
                    ripple.style.position = 'fixed';
                    ripple.style.left = e.clientX + 'px';
                    ripple.style.top = e.clientY + 'px';
                    document.body.appendChild(ripple);
                    setTimeout(() => ripple.remove(), 1000);
                    
                    showFeedback('success', 'COORDINATES TRANSMITTED');
                };
            }
        } else {
             // Render Placeholder (No Signal)
             liveViewContainer.innerHTML = `
                <div class="absolute inset-0 flex items-center justify-center text-rat-text-dim text-xs flex-col gap-2">
                    <i class="fa-solid fa-satellite-dish animate-pulse"></i>
                    <span>NO OPTICAL SIGNAL</span>
                </div>
            `;
        }
    }

    // 4. Needs
    const needsList = document.getElementById('my-pawn-needs-list');
    if (needsList) {
        const needs = [
            { label: 'NUTRITION', value: pawn.food || pawn.hunger },
            { label: 'REST', value: myPawnEntry.sleep }, // sleep is often top-level
            { label: 'RECREATION', value: pawn.joy || pawn.recreation },
            { label: 'COMFORT', value: myPawnEntry.comfort }
        ];

        needsList.innerHTML = needs.map(n => {
            if (n.value === undefined) return '';
            const pct = Math.round(n.value * 100);
            const colorClass = pct < 30 ? 'bg-rat-red' : (pct < 60 ? 'bg-rat-yellow' : 'bg-rat-green');
            return `
                <div>
                    <div class="flex justify-between text-xs font-mono mb-1 text-rat-text-dim">
                        <span>${n.label}</span>
                        <span>${pct}%</span>
                    </div>
                    <div class="h-1 bg-rat-border rounded-full overflow-hidden">
                        <div class="h-full ${colorClass}" style="width: ${pct}%"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // 5. Gear
    const gearContainer = document.getElementById('my-pawn-gear-layout');
    if (gearContainer && gameState.inventory) {
        // Fetch inventory
        let inv = gameState.inventory[String(STATE.myPawnId)];
        if (inv && inv.success && inv.data) inv = inv.data;
        
        let items = inv ? [...(inv.items || []), ...(inv.apparels || []), ...(inv.equipment || [])] : [];
        const equipment = { weapon: null, helmet: null, shirt: null, bodyArmor: null, pants: null, shield: null, belt: null };

        items.forEach(item => {
            const defName = (item.defName || item.def_name || '').toLowerCase();
            const label = (item.label || '').toLowerCase();
            const categories = item.categories || [];

            if (!equipment.weapon && (defName.includes('gun_') || defName.includes('weapon_') || defName.includes('melee') || categories.some(c => c.includes('weapon')))) equipment.weapon = item;
            else if (!equipment.helmet && (defName.includes('helmet') || defName.includes('hat') || label.includes('helmet'))) equipment.helmet = item;
            else if (!equipment.shield && (defName.includes('shield') || label.includes('shield'))) equipment.shield = item;
            else if (!equipment.belt && (defName.includes('belt') || label.includes('belt'))) equipment.belt = item;
            else if (!equipment.pants && (defName.includes('pants') || label.includes('pants'))) equipment.pants = item;
            else if (!equipment.shirt && (defName.includes('shirt') || label.includes('shirt'))) equipment.shirt = item;
            else if (!equipment.bodyArmor && (defName.includes('armor') || defName.includes('vest') || categories.some(c => c.includes('apparel')))) equipment.bodyArmor = item;
        });

        const renderSlot = (item, icon) => {
            if (!item) return `<div class="equip-slot empty"><div class="equip-placeholder">${icon}</div></div>`;
            const label = item.label || 'Unknown';
            // Try to find icon
            const def = item.defName || item.def_name;
            const iconData = STATE.itemIcons[def] || STATE.itemIcons[label];
            
            if (iconData) {
                return `<div class="equip-slot filled" title="${label}"><img src="data:image/png;base64,${iconData}" class="equip-icon"></div>`;
            }
            return `<div class="equip-slot filled" title="${label}"><div class="equip-placeholder">${icon}</div></div>`;
        };

        gearContainer.innerHTML = `
            <div class="equip-row">${renderSlot(equipment.helmet, '🪖')}</div>
            <div class="equip-row">
                ${renderSlot(equipment.shirt, '👕')}
                ${renderSlot(equipment.bodyArmor, '🦺')}
                ${renderSlot(equipment.weapon, '⚔️')}
            </div>
            <div class="equip-row">
                ${renderSlot(equipment.shield, '🛡️')}
                ${renderSlot(equipment.belt, '📿')}
                ${renderSlot(equipment.pants, '👖')}
            </div>
        `;
    }

    // 6. Work Priorities
    const workList = document.getElementById('my-pawn-work-list');
    const saveBtn = document.getElementById('btn-save-priorities');
    
    // Only render if list is empty or completely changed (to avoid wiping user input while typing)
    const hasInputs = workList.querySelector('input');
    
    if (workList && workInfo.work_priorities && !hasInputs) {
        // Sort by key for consistent order
        const entries = Object.entries(workInfo.work_priorities).sort((a, b) => a[0].localeCompare(b[0]));

        workList.innerHTML = entries.map(([job, rawPrio]) => {
            let prio = rawPrio;
            if (typeof rawPrio === 'object' && rawPrio !== null) {
                prio = rawPrio.priority !== undefined ? rawPrio.priority : (rawPrio.value !== undefined ? rawPrio.value : 3);
            }
            
            return `
            <div class="flex justify-between items-center bg-rat-dark border border-rat-border px-2 py-1 rounded mb-1">
                <span class="text-xs text-rat-text-dim">${job}</span>
                <input type="number" min="0" max="4" value="${prio}" data-job="${job}" 
                    class="work-priority-input w-12 bg-black border border-rat-border text-center text-rat-green font-bold text-xs focus:border-rat-green outline-none">
            </div>
            `;
        }).join('');
        
        // Show save button
        if(saveBtn) {
            saveBtn.classList.remove('hidden');
            saveBtn.onclick = saveWorkPriorities;
        }
    }
}

async function saveWorkPriorities() {
    if (!STATE.currentSession || !STATE.username || !STATE.myPawnId) return;
    
    const inputs = document.querySelectorAll('.work-priority-input');
    const priorities = {};
    
    inputs.forEach(input => {
        const job = input.dataset.job;
        const val = parseInt(input.value);
        if (!isNaN(val)) {
            priorities[job] = val;
        }
    });

    const btn = document.getElementById('btn-save-priorities');
    btn.disabled = true;
    btn.textContent = 'TRANSMITTING...';

    try {
        const res = await fetch(`/api/adoptions/${encodeURIComponent(STATE.currentSession)}/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                username: STATE.username, 
                command: 'set_work_priorities', 
                data: { priorities } 
            })
        });

        if (res.ok) {
            showFeedback('success', 'PRIORITIES UPDATED');
        } else {
            showFeedback('error', 'UPDATE FAILED');
        }
    } catch (e) {
        console.error(e);
        showFeedback('error', 'NETWORK ERROR');
    } finally {
        btn.disabled = false;
        btn.textContent = 'SAVE PRIORITY CHANGES';
    }
}
