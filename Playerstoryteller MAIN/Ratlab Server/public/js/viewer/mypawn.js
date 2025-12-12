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
                    checkAdoptionStatus(); // Immediate check
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
    
    // Start Polling
    setInterval(checkAdoptionStatus, 5000);
    
    // Initialize Action Buttons
    initializeActionButtons();

    isMyPawnInitialized = true;
}

function initializeActionButtons() {
    document.querySelectorAll('.btn-cmd').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!STATE.myPawnId) return;
            
            const cmd = btn.dataset.cmd;
            let type = 'draft'; 
            // Map cmd to type/action
            if (cmd === 'draft') type = 'draft'; // Toggle
            else if (cmd === 'goto') type = 'order_move'; // Requires target? usually context sensitive
            else if (cmd === 'attack') type = 'order_attack';
            else if (cmd === 'medical') type = 'order_tend';

            // For 'goto' and 'attack', usually we need a target.
            // If the user clicks the button, maybe we enter a "targeting mode"?
            // For now, let's assume 'draft' is a toggle and others might trigger a generic "Fire/Go" or need args.
            // Based on legacy logic, 'draft' is a simple toggle. 
            // 'goto' might expect a click on the map/live view (which is handled in updateMyPawnUI).
            // Let's implement 'draft' specifically and generic others.
            
            if (cmd === 'draft') {
                 sendAction('colonist_command', JSON.stringify({
                    type: 'draft',
                    pawnId: STATE.myPawnId
                }));
                showFeedback('info', 'TOGGLING DRAFT STATUS...');
            } else if (cmd === 'medical') {
                 sendAction('colonist_command', JSON.stringify({
                    type: 'job',
                    job: 'tend_self',
                    pawnId: STATE.myPawnId
                }));
                showFeedback('info', 'MEDICAL OVERRIDE INITIATED');
            } else {
                showFeedback('info', 'SELECT TARGET ON LIVE FEED');
                // Set a state? For now just feedback.
            }
        });
    });

    const btnForceEquip = document.getElementById('btn-force-equip');
    if (btnForceEquip) {
        btnForceEquip.addEventListener('click', () => {
             if (!STATE.myPawnId) return;
             // Open browser or prompt?
             // For now, simple feedback as placeholder or browser open
             window.openContentBrowser('weapons'); // Assuming weapons category exists
        });
    }
}

export async function checkAdoptionStatus() {
    if (!STATE.currentSession || !STATE.username) return;

    try {
        const res = await fetch(`/api/adoptions/${encodeURIComponent(STATE.currentSession)}/status/${encodeURIComponent(STATE.username)}`);
        const data = await res.json();
        
        const cta = document.getElementById('adoption-cta');
        const interfaceEl = document.getElementById('adoption-interface');

        if (data.hasAdopted && data.adoption && data.adoption.pawnId) {
            STATE.myPawnId = data.adoption.pawnId;
            
            if (cta) cta.classList.add('hidden');
            if (interfaceEl) {
                interfaceEl.classList.remove('hidden');
                interfaceEl.classList.add('flex');
            }
            
            // Also update tab button text if needed
            const navBtnText = document.querySelector('[data-tab="my-pawn"] span');
            if (navBtnText) navBtnText.textContent = "MY PAWN";

        } else {
            STATE.myPawnId = null;
            
            if (interfaceEl) {
                interfaceEl.classList.add('hidden');
                interfaceEl.classList.remove('flex');
            }
            if (cta) cta.classList.remove('hidden');
             
            const navBtnText = document.querySelector('[data-tab="my-pawn"] span');
            if (navBtnText) navBtnText.textContent = "ADOPT";
        }
    } catch (e) {
        console.error('Adoption check failed:', e);
    }
}

// Standard RimWorld Work Types Mapping (Display Names)
const WORK_TYPE_MAPPING = {
    "1": "Firefight",
    "2": "Patient",
    "3": "Doctor",
    "4": "Bed Rest",
    "5": "Haul+",
    "6": "Basic",
    "7": "Warden",
    "8": "Handle",
    "9": "Cook",
    "10": "Hunt",
    "11": "Construct",
    "12": "Grow",
    "13": "Mine",
    "14": "Plant Cut",
    "15": "Smith",
    "16": "Tailor",
    "17": "Art",
    "18": "Craft",
    "19": "Haul",
    "20": "Clean",
    "21": "Research"
};

// RimWorld WorkTypeDef Names (Backend Keys)
const WORK_DEF_MAPPING = {
    "1": "Firefighter",
    "2": "Patient",
    "3": "Doctor",
    "4": "PatientBedRest",
    "5": "HaulUrgent", // Common modded work type (Allow Tool)
    "6": "BasicWorker",
    "7": "Warden",
    "8": "Handling",
    "9": "Cooking",
    "10": "Hunting",
    "11": "Construction",
    "12": "Growing",
    "13": "Mining",
    "14": "PlantCutting",
    "15": "Smithing",
    "16": "Tailoring",
    "17": "Art",
    "18": "Crafting",
    "19": "Hauling",
    "20": "Cleaning",
    "21": "Research"
};

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
    const hasInputs = workList.querySelector('.work-priority-input');
    
    if (workList && workInfo.work_priorities && !hasInputs) {
        // Sort by key for consistent order
        // Use numeric sort if keys are numbers
        const entries = Object.entries(workInfo.work_priorities).sort((a, b) => {
             const nA = parseInt(a[0]);
             const nB = parseInt(b[0]);
             if (!isNaN(nA) && !isNaN(nB)) return nA - nB;
             return a[0].localeCompare(b[0]);
        });

        workList.innerHTML = entries.map(([job, rawPrio]) => {
            let prio = rawPrio;
            if (typeof rawPrio === 'object' && rawPrio !== null) {
                prio = rawPrio.priority !== undefined ? rawPrio.priority : (rawPrio.value !== undefined ? rawPrio.value : 3);
            }
            
            // Map Job Name
            const jobName = WORK_TYPE_MAPPING[job] || job;
            
            return `
            <div class="flex justify-between items-center bg-rat-dark border border-rat-border px-2 py-1 rounded mb-1">
                <span class="text-xs text-rat-text-dim">${jobName}</span>
                <select data-job="${job}" 
                    class="work-priority-input w-12 bg-black border border-rat-border text-center text-rat-green font-bold text-xs focus:border-rat-green outline-none appearance-none">
                    <option value="0" ${prio == 0 ? 'selected' : ''}>-</option>
                    <option value="1" ${prio == 1 ? 'selected' : ''}>1</option>
                    <option value="2" ${prio == 2 ? 'selected' : ''}>2</option>
                    <option value="3" ${prio == 3 ? 'selected' : ''}>3</option>
                    <option value="4" ${prio == 4 ? 'selected' : ''}>4</option>
                </select>
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
            // Translate the numeric ID (from frontend) to the DefName (for backend)
            // If no mapping found, fallback to original key (though unlikely to work if backend needs DefName)
            const defName = WORK_DEF_MAPPING[job] || job;
            priorities[defName] = val;
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
