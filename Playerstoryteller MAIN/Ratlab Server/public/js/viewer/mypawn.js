import { STATE } from './state.js';
import { showFeedback } from './ui.js';
import { sendAction } from './interactions.js';
import { MapRenderer } from './mapRenderer.js';
import { socket } from './socket.js';

const PROFANITY_LIST = ['admin', 'system', 'moderator', 'nigger', 'faggot', 'retard', 'kike', 'spic', 'chink']; // Basic filter

function containsProfanity(text) {
    const lower = text.toLowerCase();
    return PROFANITY_LIST.some(word => lower.includes(word));
}

let isMyPawnInitialized = false;
let mapRenderer = null;
let mapRendererInitPromise = null;

/**
 * Destroy the MapRenderer when leaving My Pawn tab.
 * This stops the animation loop and releases all cached resources.
 * MUST be called when switching away from the My Pawn tab to prevent memory leaks.
 */
export function destroyMyPawn() {
    if (mapRenderer) {
        console.log('[MyPawn] Destroying mapRenderer to release memory');
        mapRenderer.destroy();
        mapRenderer = null;
        mapRendererInitPromise = null;
    }
}

export function initializeMyPawn() {
    if (isMyPawnInitialized) return;

    // Listen for map updates
    socket.on('map-things-update', (data) => {
        console.log('[MyPawn] Socket map-things-update received, mapRenderer exists:', !!mapRenderer, 'things count:', data?.things?.length || 0);
        if (mapRenderer) {
            mapRenderer.handleThingsUpdate(data);
        } else {
            console.warn('[MyPawn] mapRenderer not yet initialized, things update lost');
        }
    });

    const adoptBtnMain = document.getElementById('btn-adopt-request-main');
    if (adoptBtnMain) {
        adoptBtnMain.onclick = async () => {
            if (!STATE.username) {
                showFeedback('error', 'LOGIN REQUIRED');
                return;
            }

            const nicknameInput = document.getElementById('adoption-nickname');
            let nickname = nicknameInput ? nicknameInput.value.trim() : null;

            if (nickname && containsProfanity(nickname)) {
                showFeedback('error', 'INVALID NAME DETECTED');
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
                    body: JSON.stringify({
                        username: STATE.username,
                        nickname: nickname
                    })
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

    // Initialize Camera Toggle
    initializeCameraToggle();

    isMyPawnInitialized = true;
}

function initializeCameraToggle() {
    const btnFollow = document.getElementById('btn-camera-follow');
    const btnFree = document.getElementById('btn-camera-free');

    if (btnFollow && btnFree) {
        btnFollow.onclick = () => {
            if (mapRenderer) {
                mapRenderer.isFollowing = true;

                // Immediately center camera on my pawn when activating follow mode
                if (STATE.myPawnId) {
                    const dotId = mapRenderer.pawnIdToDotId.get(String(STATE.myPawnId));
                    if (dotId) {
                        const dot = mapRenderer.trackedDots.get(dotId);
                        if (dot) {
                            mapRenderer.setCameraTarget(dot.x, dot.z);
                        }
                    }
                }

                btnFollow.classList.add('bg-rat-green', 'text-black');
                btnFollow.classList.remove('hover:bg-rat-dark/50');
                btnFree.classList.remove('bg-rat-green', 'text-black');
                btnFree.classList.add('hover:bg-rat-dark/50');
            }
        };

        btnFree.onclick = () => {
            if (mapRenderer) {
                mapRenderer.isFollowing = false;
                btnFree.classList.add('bg-rat-green', 'text-black');
                btnFree.classList.remove('hover:bg-rat-dark/50');
                btnFollow.classList.remove('bg-rat-green', 'text-black');
                btnFollow.classList.add('hover:bg-rat-dark/50');
            }
        };
    }
}

function updateDraftButtonVisual(btn, isDrafted) {
    if (isDrafted) {
        // Drafted state - red button
        btn.classList.remove('hover:bg-rat-red', 'hover:text-white');
        btn.classList.add('bg-rat-red', 'text-white', 'hover:bg-rat-red/80');
        btn.innerHTML = `<i class="fa-solid fa-person-military-rifle mb-1 block text-lg"></i>UNDRAFT`;
    } else {
        // Undrafted state - green button
        btn.classList.remove('bg-rat-red', 'text-white', 'hover:bg-rat-red/80');
        btn.classList.add('hover:bg-rat-green', 'hover:text-black');
        btn.innerHTML = `<i class="fa-solid fa-person-military-rifle mb-1 block text-lg"></i>DRAFT`;
    }
}

function ensureMapRenderer(mapId = 0) {
    const sessionId = STATE.currentSession;
    if (mapRenderer) {
        mapRenderer.textureManager.setSession(sessionId);
        if (mapRenderer.sessionId !== sessionId) {
            mapRendererInitPromise = mapRenderer.initialize(mapId, sessionId);
        }
        return mapRendererInitPromise;
    }

    const container = document.getElementById('my-pawn-live-view-container');
    if (!container) return null;

    mapRenderer = new MapRenderer(container, {
        onOrder: (x, z) => {
            if (!STATE.myPawnId) return;
            sendAction('colonist_command', JSON.stringify({
                type: 'order',
                pawnId: STATE.myPawnId,
                x,
                z
            }));
            showFeedback('success', 'COORDINATES TRANSMITTED');
        }
    });

    mapRendererInitPromise = mapRenderer.initialize(mapId, sessionId);
    return mapRendererInitPromise;
}

function initializeActionButtons() {
    // Rename Button
    const btnRename = document.getElementById('btn-rename-pawn');
    if (btnRename) {
        btnRename.onclick = () => {
            if (!STATE.myPawnId) return;
            const newName = prompt("ENTER NEW IDENTITY ALIAS:");
            if (newName) {
                const cleanName = newName.trim();
                if (cleanName.length < 2 || cleanName.length > 16) {
                    showFeedback('error', 'INVALID LENGTH (2-16 CHARS)');
                    return;
                }
                if (containsProfanity(cleanName)) {
                    showFeedback('error', 'NAME REJECTED BY PROTOCOL');
                    return;
                }

                sendAction('colonist_command', JSON.stringify({
                    type: 'rename',
                    pawnId: STATE.myPawnId,
                    newName: cleanName
                }));
                showFeedback('info', 'TRANSMITTING ALIAS UPDATE...');
            }
        };
    }

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
                // Get current draft status
                const isDrafted = btn.dataset.drafted === 'true';

                sendAction('colonist_command', JSON.stringify({
                    type: isDrafted ? 'undraft' : 'draft',
                    pawnId: STATE.myPawnId
                }));

                // Toggle visual state immediately for responsiveness
                btn.dataset.drafted = (!isDrafted).toString();
                updateDraftButtonVisual(btn, !isDrafted);

                showFeedback('info', isDrafted ? 'RELEASING FROM DRAFT...' : 'DRAFTING COLONIST...');
            } else if (cmd === 'medical') {
                sendAction('colonist_command', JSON.stringify({
                    type: 'job',
                    job: 'tend_self',
                    pawnId: STATE.myPawnId
                }));
                showFeedback('info', 'MEDICAL OVERRIDE INITIATED');
            } else if (cmd === 'ignite') {
                showFeedback('info', 'SELECT TARGET AREA TO IGNITE');
                if (mapRenderer) {
                    mapRenderer.canvas.style.cursor = 'crosshair';
                    mapRenderer.onOrder = (x, z) => {
                        sendAction('setFire', JSON.stringify({
                            x, z, pawnId: STATE.myPawnId
                        }));
                        showFeedback('success', 'IGNITION ORDER SENT');
                        // Reset order handler
                        mapRenderer.onOrder = null;
                        mapRenderer.canvas.style.cursor = 'default';
                    };
                }
            } else if (cmd === 'smash') {
                showFeedback('info', 'SELECT OBJECT TO DESTROY');
                if (mapRenderer) {
                    mapRenderer.canvas.style.cursor = 'crosshair';
                    mapRenderer.onOrder = (x, z) => {
                        sendAction('destroyObject', JSON.stringify({
                            x, z, pawnId: STATE.myPawnId
                        }));
                        showFeedback('success', 'DESTRUCTION ORDER SENT');
                        mapRenderer.onOrder = null;
                        mapRenderer.canvas.style.cursor = 'default';
                    };
                }
            } else if (cmd === 'fight') {
                showFeedback('info', 'SELECT COLONIST TO FIGHT');
                if (mapRenderer) {
                    mapRenderer.canvas.style.cursor = 'crosshair';
                    mapRenderer.onOrder = (x, z) => {
                        // Find colonist at x,z
                        let targetId = null;
                        const PROXIMITY = 1.5;

                        for (const dot of mapRenderer.trackedDots.values()) {
                            if (Math.abs(dot.x - x) < PROXIMITY && Math.abs(dot.z - z) < PROXIMITY) {
                                if (dot.pawnId !== String(STATE.myPawnId) && dot.type !== 'animal') {
                                    targetId = dot.pawnId;
                                    break;
                                }
                            }
                        }

                        if (targetId) {
                            sendAction('startSocialFight', JSON.stringify({
                                initiatorId: STATE.myPawnId,
                                targetId: targetId
                            }));
                            showFeedback('success', 'SOCIAL FIGHT INITIATED');
                        } else {
                            showFeedback('error', 'NO VALID TARGET FOUND');
                        }
                        mapRenderer.onOrder = null;
                        mapRenderer.canvas.style.cursor = 'default';
                    };
                }
            } else {
                showFeedback('info', 'SELECT TARGET ON LIVE FEED');
                // Set a state? For now just feedback.
            }
        });
    });

    const btnForceEquip = document.getElementById('btn-force-equip');
    if (btnForceEquip) {
        btnForceEquip.addEventListener('click', () => {
            if (!STATE.myPawnId) {
                showFeedback('error', 'ADOPT A COLONIST FIRST');
                return;
            }
            // Open storage items browser for equipping
            window.openContentBrowser('equipment');
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
    const pawn = gameState.colonists.find(c => String(c.id) === String(STATE.myPawnId));

    if (!pawn) {
        const el = document.getElementById('my-pawn-name');
        if (el) el.textContent = "SIGNAL LOST (PAWN NOT FOUND)";
        return;
    }

    // Update draft button state from game data
    const draftBtn = document.querySelector('.btn-cmd[data-cmd="draft"]');
    if (draftBtn && pawn.drafted !== undefined) {
        draftBtn.dataset.drafted = pawn.drafted.toString();
        updateDraftButtonVisual(draftBtn, pawn.drafted);
    }

    // 1. Header Info
    const nameEl = document.getElementById('my-pawn-name');
    if (nameEl) nameEl.textContent = (pawn.name || 'Unknown').toUpperCase();

    const jobEl = document.getElementById('my-pawn-job');
    if (jobEl) jobEl.textContent = `ACTIVITY: ${(pawn.current_job || pawn.current_activity || 'Idle').toUpperCase()}`;

    const pos = pawn.position || { x: 0, z: 0 };
    const locEl = document.getElementById('my-pawn-location');
    if (locEl) locEl.textContent = `LOC: [${pos.x}, ${pos.z}]`;

    // 2. Vitals
    const health = pawn.health !== undefined ? pawn.health : 0;
    const mood = pawn.mood !== undefined ? pawn.mood : 0;

    const healthBar = document.getElementById('my-pawn-health-bar');
    if (healthBar) healthBar.style.width = `${health * 100}%`;

    const moodBar = document.getElementById('my-pawn-mood-bar');
    if (moodBar) moodBar.style.width = `${mood * 100}%`;

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
        liveViewPanel.classList.remove('hidden');
        // Initialize optical view once and reuse
        const mapId = gameState.map_id ?? 0;
        const initPromise = ensureMapRenderer(mapId);

        // Update renderer if it exists (either from promise or already initialized)
        if (mapRenderer && mapRenderer.ready) {
            mapRenderer.updateFromGameState(gameState, STATE.myPawnId);
        } else if (initPromise) {
            initPromise.then(() => {
                if (mapRenderer) {
                    mapRenderer.updateFromGameState(gameState, STATE.myPawnId);
                }
            });
        }
    }

    // 4. Needs
    const needsList = document.getElementById('my-pawn-needs-list');
    if (needsList) {
        const needs = [
            { label: 'NUTRITION', value: pawn.food || pawn.hunger },
            { label: 'REST', value: pawn.sleep },
            { label: 'RECREATION', value: pawn.joy || pawn.recreation },
            { label: 'COMFORT', value: pawn.comfort }
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

    if (workList && pawn.work_priorities && !hasInputs) {
        // Sort by key for consistent order
        // Use numeric sort if keys are numbers
        const entries = Object.entries(pawn.work_priorities).sort((a, b) => {
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
        if (saveBtn) {
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
