import { STATE } from './state.js';
import { updateColonistsList, getColonistPortrait } from './colonists.js';
import { updateMyPawnUI } from './mypawn.js';
import { updateMapOverlays } from './map.js';
import { sendAction } from './interactions.js';
import { showFeedback } from './ui.js';
import { updateActionButtonsCosts } from './actions.js';

let hasLoggedInitialState = false;

export function updateGameState(gameState) {
    if (!gameState) return;

    // Initialize persistent state
    if (!window.lastGameState) window.lastGameState = {};
    const state = window.lastGameState;

    if (!hasLoggedInitialState) {
        console.log('Game State received:', gameState);
        hasLoggedInitialState = true;
    }

    // === UNIFIED MERGE STRATEGY (Simplified) ===
    // All colonist data now uses flat structure with consistent 'id' field
    // Progressive enhancement: ultrafast → fast → full (each tier adds fields)

    if (!state.colonists) state.colonists = [];
    if (!state.animals) state.animals = []; // Initialize animals
    if (!state.lastPositionSequenceId) state.lastPositionSequenceId = 0;

    // Tier 1: ULTRAFAST - Position updates only (10Hz)
    if (gameState.pawn_positions) {
        // Check sequence ID to discard out-of-order packets
        const sequenceId = gameState.sequence_id || 0;
        if (sequenceId > 0 && sequenceId <= state.lastPositionSequenceId) {
            // Discard old packet
            console.debug(`Discarded stale position update (seq ${sequenceId} <= ${state.lastPositionSequenceId})`);
        } else {
            // Update sequence ID
            if (sequenceId > 0) {
                state.lastPositionSequenceId = sequenceId;
            }

            gameState.pawn_positions.forEach(posUpdate => {
                let colonist = state.colonists.find(c => c.id === posUpdate.id);
                let animal = state.animals.find(a => a.id === posUpdate.id);

                if (colonist) {
                    if ((posUpdate.timestamp || 0) >= (colonist.positionTimestamp || 0)) {
                        colonist.position = posUpdate.position;
                        colonist.positionTimestamp = posUpdate.timestamp;
                    }
                } else if (animal) {
                    if ((posUpdate.timestamp || 0) >= (animal.positionTimestamp || 0)) {
                        animal.position = posUpdate.position;
                        animal.positionTimestamp = posUpdate.timestamp;
                    }
                } else {
                    // Unknown ID. Wait for metadata (Fast/Slow tier) to define it.
                    // Do NOT auto-create as colonist to avoid UI artifacts.
                }
            });
        }
    }

    // Tier 1.5: ANIMALS (Slow/Fast)
    if (gameState.animals_light) {
        gameState.animals_light.forEach(update => {
            let animal = state.animals.find(a => a.id === update.id);
            if (!animal) {
                state.animals.push(update);
            } else {
                const oldPos = animal.position;
                const oldTimestamp = animal.positionTimestamp;
                Object.assign(animal, update);
                if (oldTimestamp && oldTimestamp > (update.positionTimestamp || 0)) {
                    animal.position = oldPos;
                    animal.positionTimestamp = oldTimestamp;
                }
            }
        });
    }

    // Tier 2: FAST - Vital stats (10Hz)
    if (gameState.colonists_light) {
        gameState.colonists_light.forEach(update => {
            let colonist = state.colonists.find(c => c.id === update.id);
            if (!colonist) {
                // New colonist
                state.colonists.push(update);
            } else {
                // Preserve newer position from ultrafast tier
                const oldPos = colonist.position;
                const oldTimestamp = colonist.positionTimestamp;
                Object.assign(colonist, update);
                if (oldTimestamp && oldTimestamp > (update.positionTimestamp || 0)) {
                    colonist.position = oldPos;
                    colonist.positionTimestamp = oldTimestamp;
                }
            }
        });
    }

    // Tier 3: FULL - Detailed data (slow ~5s)
    if (gameState.colonists_full) {
        gameState.colonists_full.forEach(update => {
            let colonist = state.colonists.find(c => c.id === update.id);
            if (!colonist) {
                // New colonist
                state.colonists.push(update);
            } else {
                // Preserve newer position (full tier is slow and may have stale positions)
                const oldPos = colonist.position;
                const oldTimestamp = colonist.positionTimestamp;
                Object.assign(colonist, update);
                if (oldTimestamp && oldTimestamp > (update.positionTimestamp || 0)) {
                    colonist.position = oldPos;
                    colonist.positionTimestamp = oldTimestamp;
                }
            }
        });
    }

    // Legacy: Fallback for old format
    if (gameState.colonists) {
        state.colonists = gameState.colonists;
    }

    // Merge other root keys
    Object.keys(gameState).forEach(key => {
        if (!['colonists', 'colonists_light', 'colonists_full', 'pawn_positions'].includes(key)) {
            state[key] = gameState[key];
        }
    });

    // Update caches
    const effectiveState = state; // Keep variable name for backwards compatibility with rest of function
    if (effectiveState.camera) STATE.cameraBounds = effectiveState.camera;
    if (effectiveState.colonist_portraits) Object.assign(STATE.colonistPortraits, effectiveState.colonist_portraits);
    if (effectiveState.item_icons) {
        Object.assign(STATE.itemIcons, effectiveState.item_icons);
    }

    // 1. Core Data Extraction (Use Effective State)
    const colonists = effectiveState.colonists || [];
    const resources = effectiveState.resources || {};
    const factions = effectiveState.factions || [];
    const mods = effectiveState.mods || [];

    // 2. UI Updates
    const colonistCount = document.getElementById('colonist-count');
    const wealthDisplay = document.getElementById('wealth');
    
    if (colonistCount) colonistCount.textContent = colonists.length;
    if (wealthDisplay) wealthDisplay.textContent = `$${((resources.total_market_value || 0)/1000).toFixed(1)}k`;

    // 3. Module Updates
    updateMyPawnUI(effectiveState);
    
    if (colonists.length > 0) {
        updateColonistsList(colonists, effectiveState);
        updateMapOverlays(effectiveState);
        // Also update Personal Inventory in Inventory Tab
        updateInventoryList(colonists, effectiveState);
    } else {
         const list = document.getElementById('colonists-list');
         if(list) list.innerHTML = '<p class="loading col-span-full text-center">No active subjects found</p>';
    }

    // 4. DLC Visibility
    updateDLCIndicators(effectiveState.active_dlcs);

    // 5. Medical Alerts
    updateMedicalAlerts(colonists);

    // 6. Stats & Info
    if (effectiveState.power) updatePowerStats(effectiveState.power);
    if (effectiveState.creatures) updateCreatureStats(effectiveState.creatures);
    if (effectiveState.research) updateResearchStats(effectiveState.research);
    if (factions.length > 0) updateFactionsList(factions);
    if (mods.length > 0) updateModsList(mods);
    // Update stored resources (Storage Zone)
    if (resources.stored) updateStoredResources(resources.stored); // Assuming structure is resources.stored or top level stored_resources
    else if (effectiveState.stored_resources) updateStoredResources(effectiveState.stored_resources);
}

function updateDLCIndicators(activeDlcs) {
    if (!activeDlcs) return;

    const dlcMap = {
        'royalty': 'dlc-royalty',
        'ideology': 'dlc-ideology',
        'biotech': 'dlc-biotech',
        'anomaly': 'dlc-anomaly',
        'odyssey': 'dlc-odyssey'
    };

    for (const [dlcKey, elementId] of Object.entries(dlcMap)) {
        const el = document.getElementById(elementId);
        if (el) {
            const isActive = activeDlcs[dlcKey];
            if (!isActive) {
                el.style.opacity = '0.4';
                el.style.pointerEvents = 'none';
                el.style.filter = 'grayscale(1)';
                const summary = el.querySelector('summary span');
                if (summary) summary.style.textDecoration = 'line-through';
                el.removeAttribute('open');
            } else {
                el.style.opacity = '1';
                el.style.pointerEvents = 'auto';
                el.style.filter = 'none';
                const summary = el.querySelector('summary span');
                if (summary) summary.style.textDecoration = 'none';
            }
        }
    }
}

function updateMedicalAlerts(colonists) {
    const medicalAlertsList = document.getElementById('medical-alerts-list');
    if (!medicalAlertsList) return;

    const medicalAlerts = [];
    colonists.forEach(colonist => {
        const name = colonist.name || 'Unknown';
        const pawnId = colonist.id;
        const hediffs = colonist.hediffs || []; // Direct access - no nested structure

        hediffs.forEach(hediff => {
            const hediffName = hediff.label || hediff.def_name || 'Unknown';
            const severity = hediff.severity || 0;
            const bodyPart = hediff.part || hediff.body_part || null;
            const bleeding = hediff.bleeding || false;
            const isPain = hediff.pain_offset !== undefined && hediff.pain_offset > 0;
            const isLethal = hediff.lethal || hediff.tends_to_death || false;

            if (bleeding || isPain || isLethal || severity > 0.3) {
                let severityClass = 'minor';
                if (bleeding || isLethal) severityClass = 'critical';
                else if (severity > 0.6) severityClass = 'serious';

                medicalAlerts.push({
                    colonist: name,
                    pawnId: pawnId,
                    condition: hediffName,
                    severity: severity,
                    severityClass: severityClass,
                    bodyPart: bodyPart,
                    bleeding: bleeding,
                    isPain: isPain,
                    isLethal: isLethal
                });
            }
        });
    });

    if (medicalAlerts.length === 0) {
        medicalAlertsList.innerHTML = '<div class="text-center text-rat-text-dim italic text-xs py-4">No active alerts. Subjects stable.</div>';
        return;
    }

    // Render Logic
    const existingAlerts = new Map();
    Array.from(medicalAlertsList.children).forEach(alertDiv => {
        if (alertDiv.dataset.alertId) {
            existingAlerts.set(alertDiv.dataset.alertId, alertDiv);
        }
    });

    const processedAlertIds = new Set();
    const fragment = document.createDocumentFragment();

    medicalAlerts.forEach(alert => {
        const alertId = `${alert.pawnId}-${alert.condition}-${alert.bodyPart}`;
        if (processedAlertIds.has(alertId)) return;
        processedAlertIds.add(alertId);

        const newHtml = createMedicalAlertHtml(alert);

        if (existingAlerts.has(alertId)) {
            const existingAlertDiv = existingAlerts.get(alertId);
            if (existingAlertDiv.outerHTML !== newHtml) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = newHtml;
                existingAlertDiv.replaceWith(tempDiv.firstElementChild);
            }
            existingAlerts.delete(alertId);
        } else {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = newHtml;
            fragment.appendChild(tempDiv.firstElementChild);
        }
    });

    medicalAlertsList.appendChild(fragment);
    existingAlerts.forEach(el => el.remove());
    
    // Attach listeners
    document.querySelectorAll('.btn-follow-alert').forEach(btn => {
        // Simple overwrite is fine here since we rebuild/diff efficiently
        btn.onclick = async () => {
             const pawnId = btn.dataset.pawnId;
            btn.disabled = true;
            btn.textContent = '⏳ LOCATING...';

            try {
                await sendAction('colonist_command', JSON.stringify({
                    type: 'select',
                    pawnId: pawnId
                }));
                 setTimeout(() => {
                    btn.disabled = false;
                    btn.textContent = '📍 LOCATE SUBJECT';
                    showFeedback('success', 'Subject located');
                }, 1000);
            } catch(e) {
                 btn.disabled = false;
            }
        };
    });
}

function createMedicalAlertHtml(alert) {
    const severityPercent = Math.min(100, Math.round(alert.severity * 100));
    const bodyPartText = alert.bodyPart ? ` <span class="text-rat-text-dim">(${alert.bodyPart})</span>` : '';
    const icons = [
        alert.bleeding ? '🩸' : '',
        alert.isPain ? '⚡' : '',
        alert.isLethal ? '💀' : ''
    ].join('');

    return `
        <div class="medical-alert ${alert.severityClass}" data-alert-id="${alert.pawnId}-${alert.condition}-${alert.bodyPart}">
            <div class="alert-header">
                <strong>${alert.colonist}</strong>
                <span class="alert-severity ${alert.severityClass}">${alert.severityClass.toUpperCase()}</span>
            </div>
            <div class="alert-condition">
                ${alert.condition}${bodyPartText} ${icons}
            </div>
            <div class="alert-severity-bar">
                <div class="alert-severity-fill ${alert.severityClass}" style="width: ${severityPercent}%"></div>
            </div>
            <button class="btn-follow-alert" data-pawn-id="${alert.pawnId}" title="Go to colonist">
                LOCATE SUBJECT
            </button>
        </div>
    `;
}

function updatePowerStats(power) {
    const powerStats = document.getElementById('power-stats');
    if (!powerStats) return;
    const prod = power.produced || power.current_power || 0; // Fallback key
    const cons = power.consumed || power.total_consumption || 0; // Fallback key
    const pct = prod > 0 ? Math.min(100, (cons / prod) * 100) : 0;
    const color = pct > 90 ? 'text-rat-red' : (pct > 70 ? 'text-rat-yellow' : 'text-rat-green');

    powerStats.innerHTML = `
        <div class="flex justify-between items-center text-xs mb-1">
            <span class="text-rat-text-dim">GRID LOAD</span>
            <span class="${color} font-mono font-bold">${Math.round(pct)}%</span>
        </div>
        <div class="h-1 bg-rat-border rounded-full overflow-hidden mb-2">
            <div class="h-full ${pct > 90 ? 'bg-rat-red' : 'bg-rat-green'}" style="width: ${pct}%"></div>
        </div>
        <div class="flex justify-between text-[10px] font-mono text-rat-text-dim">
            <span>PROD: ${Math.round(prod)} W</span>
            <span>CONS: ${Math.round(cons)} W</span>
        </div>
    `;
}

function updateCreatureStats(creatures) {
    const creatureStats = document.getElementById('creature-stats');
    if (!creatures || !creatureStats) return;
    
    // Map keys from potential different sources
    const tame = creatures.colony_animals || creatures.animals_count || 0;
    const wild = creatures.wild_animals || 0;
    const hostile = creatures.hostile_creatures || creatures.enemies_count || 0;
    const insects = creatures.insects || 0;

    creatureStats.innerHTML = `
        <div class="grid grid-cols-2 gap-2 text-xs">
            <div class="bg-rat-dark p-2 rounded border border-rat-border text-center">
                <div class="text-rat-text-dim text-[10px]">TAME</div>
                <div class="text-rat-green font-bold text-lg">${tame}</div>
            </div>
            <div class="bg-rat-dark p-2 rounded border border-rat-border text-center">
                <div class="text-rat-text-dim text-[10px]">WILD</div>
                <div class="text-rat-yellow font-bold text-lg">${wild}</div>
            </div>
            <div class="bg-rat-dark p-2 rounded border border-rat-border text-center">
                <div class="text-rat-text-dim text-[10px]">HOSTILE</div>
                <div class="text-rat-red font-bold text-lg">${hostile}</div>
            </div>
            <div class="bg-rat-dark p-2 rounded border border-rat-border text-center">
                <div class="text-rat-text-dim text-[10px]">INSECTS</div>
                <div class="text-rat-red font-bold text-lg">${insects}</div>
            </div>
        </div>
    `;
}

function updateResearchStats(research) {
    const researchStats = document.getElementById('research-stats');
    if (!research || !researchStats) return;

    // Normalize keys
    const currentProject = research.current_project || research.label || research.name;
    
    if (currentProject) {
        const progress = research.progress || 0;
        const total = research.cost || 1;
        const pct = research.progress_percent || Math.round((progress / total) * 100);

        researchStats.innerHTML = `
            <div class="text-xs text-rat-green mb-1 truncate" title="${currentProject}">${currentProject}</div>
            <div class="h-1 bg-rat-border rounded-full overflow-hidden mb-1">
                <div class="h-full bg-rat-green animate-pulse" style="width: ${pct}%"></div>
            </div>
            <div class="text-[10px] text-rat-text-dim text-right">${pct}% COMPLETED</div>
        `;
    } else {
        researchStats.innerHTML = `<div class="text-xs text-rat-text-dim text-center italic">No active research</div>`;
    }
}

function updateFactionsList(factions) {
    const container = document.getElementById('faction-relations-full');
    if (!container) return;

    // Clear loading text if present
    Array.from(container.children).forEach(el => {
         if (!el.dataset.factionName) el.remove();
    });

    const existingMap = new Map();
    Array.from(container.children).forEach(el => {
        if (el.dataset.factionName) existingMap.set(el.dataset.factionName, el);
    });
    
    const processed = new Set();
    const uniqueFactions = factions.filter(f => {
         const slug = f.name.replace(/\s+/g, '-').toLowerCase();
         if (processed.has(slug)) return false;
         processed.add(slug);
         return true;
    });

    uniqueFactions.forEach(faction => {
        const slug = faction.name.replace(/\s+/g, '-').toLowerCase();
        const relationColor = faction.relation === 'Hostile' ? 'text-rat-red' :
                              faction.relation === 'Neutral' ? 'text-rat-yellow' : 'text-rat-green';
        
        // Add interaction buttons with costs (sabotage is VERY expensive to discourage griefing)
        const sabotageCost = 500;
        const improveCost = 150;
        const content = `
            <div class="min-w-0 flex-1">
                <div class="flex justify-between items-center">
                    <span class="text-xs font-bold text-rat-text truncate pr-2" title="${faction.name}">${faction.name}</span>
                    <span class="text-[10px] font-mono ${relationColor}">${faction.goodwill}</span>
                </div>
                <div class="text-[10px] text-rat-text-dim">${faction.type || faction.relation}</div>
            </div>
            <div class="flex gap-1 ml-2 shrink-0">
                 <button class="btn-faction-goodwill relative w-8 h-8 flex flex-col items-center justify-center bg-rat-dark border border-rat-border hover:border-rat-red text-rat-red rounded text-[10px]" data-faction="${faction.name}" data-amount="-15" data-cost="${sabotageCost}" title="Sabotage relations (${sabotageCost}c)">
                    <span>-</span>
                    <span class="text-[8px] text-rat-yellow">${sabotageCost}c</span>
                 </button>
                 <button class="btn-faction-goodwill relative w-8 h-8 flex flex-col items-center justify-center bg-rat-dark border border-rat-border hover:border-rat-green text-rat-green rounded text-[10px]" data-faction="${faction.name}" data-amount="15" data-cost="${improveCost}" title="Improve relations (${improveCost}c)">
                    <span>+</span>
                    <span class="text-[8px] text-rat-yellow">${improveCost}c</span>
                 </button>
            </div>
        `;

        if (existingMap.has(slug)) {
             const el = existingMap.get(slug);
             // Check content roughly to avoid full re-render if static
             // But for now, just replace to ensure buttons work
             el.innerHTML = content;
             existingMap.delete(slug);
        } else {
             const el = document.createElement('div');
             el.className = "bg-rat-dark border border-rat-border p-2 rounded hover:border-rat-green/30 transition-colors flex justify-between items-center";
             el.dataset.factionName = slug;
             el.innerHTML = content;
             container.appendChild(el);
        }
    });

    existingMap.forEach(el => el.remove());

    // Attach listeners
    container.querySelectorAll('.btn-faction-goodwill').forEach(btn => {
        btn.onclick = async (e) => {
            e.stopPropagation();
            const factionName = btn.dataset.faction;
            const amount = parseInt(btn.dataset.amount);
            const cost = parseInt(btn.dataset.cost) || 0;

            // Check if user has enough credits
            const userCredits = STATE.userCredits || 0;
            if (cost > 0 && userCredits < cost) {
                showFeedback('error', `Not enough credits (need ${cost}c, have ${userCredits}c)`);
                return;
            }

            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs"></i>';

            try {
                await sendAction('changeFactionGoodwill', {
                    faction: factionName,
                    amount: amount,
                    cost: cost
                });
                showFeedback('success', `Diplomatic signal sent (-${cost}c)`);
            } catch (error) {
                showFeedback('error', `Transmission failed`);
            } finally {
                setTimeout(() => {
                    btn.disabled = false;
                    btn.innerHTML = originalHTML;
                }, 1000);
            }
        };
    });
}

function updateModsList(mods) {
    const modsList = document.getElementById('mods-list');
    if(!modsList) return;

    Array.from(modsList.children).forEach(el => {
        if (!el.dataset.packageId) el.remove();
    });

    const sortedMods = [...mods].sort((a, b) => a.load_order - b.load_order);
    const existingMap = new Map();
    Array.from(modsList.children).forEach(el => {
        if (el.dataset.packageId) existingMap.set(el.dataset.packageId, el);
    });

    sortedMods.forEach(mod => {
        const pkg = (mod.package_id || mod.packageId || 'unknown').toLowerCase();
        
        const createContent = () => {
            let typeColor = 'text-rat-text-dim';
            if (pkg === 'ludeon.rimworld') typeColor = 'text-rat-green';
            else if (pkg.startsWith('ludeon.rimworld')) typeColor = 'text-rat-yellow';
            
            return `
                <div class="flex justify-between items-start">
                    <h3 class="font-bold text-sm text-white truncate pr-2" title="${mod.name}">${mod.name}</h3>
                    <span class="text-[10px] bg-rat-dark px-1 rounded text-rat-text-dim">#${mod.load_order}</span>
                </div>
                <span class="text-xs font-mono ${typeColor} truncate">${mod.package_id || mod.packageId}</span>
                <span class="text-[10px] text-rat-text-dim italic">${mod.author || 'Unknown'}</span>
            `;
        };

        if (existingMap.has(pkg)) {
            const el = existingMap.get(pkg);
            const content = createContent();
            if (el.innerHTML !== content) el.innerHTML = content;
            existingMap.delete(pkg);
        } else {
            const el = document.createElement('div');
            el.className = "bg-rat-panel border border-rat-border p-3 rounded flex flex-col gap-1 hover:border-rat-green/50 transition-colors";
            el.dataset.packageId = pkg;
            el.innerHTML = createContent();
            modsList.appendChild(el);
        }
    });

    existingMap.forEach(el => el.remove());
}

function updateStoredResources(resources) {
    const container = document.getElementById('stored-resources-container');
    if(!container) return;

    // Categories to EXCLUDE (plants, natural features, etc.)
    const excludedCategories = new Set([
        'plants', 'plant', 'chunks', 'corpses', 'filth',
        'natural', 'rock', 'stone', 'terrain'
    ]);

    // Categories to INCLUDE (stockpile items)
    const includedCategories = new Set([
        'resources', 'items', 'manufactured', 'raw_resources', 'raw_food',
        'meals', 'food_meals', 'medicine', 'drugs', 'weapons', 'weapons_melee',
        'weapons_ranged', 'apparel', 'armor', 'textiles', 'leathers',
        'resources_raw', 'silver', 'gold', 'steel', 'components', 'plasteel',
        'food', 'meat', 'vegetables', 'animal_products'
    ]);

    // Convert to flat array of items, filtering by category
    let rawItems = [];
    if (Array.isArray(resources)) {
        rawItems = resources;
    } else if (typeof resources === 'object' && resources !== null) {
        const entries = Object.entries(resources);

        for (const [categoryKey, categoryItems] of entries) {
            const keyLower = categoryKey.toLowerCase();

            // Skip excluded categories
            if (excludedCategories.has(keyLower)) continue;

            // Skip if it looks like plants/natural stuff
            if (keyLower.includes('plant') || keyLower.includes('grass') ||
                keyLower.includes('tree') || keyLower.includes('bush') ||
                keyLower.includes('shrub') || keyLower.includes('filth') ||
                keyLower.includes('corpse') || keyLower.includes('chunk')) continue;

            if (Array.isArray(categoryItems)) {
                // Filter individual items too - exclude plants by their categories
                const filtered = categoryItems.filter(item => {
                    if (!item) return false;
                    const itemCategories = item.categories || [];
                    const hasPlantCategory = itemCategories.some(c =>
                        c.toLowerCase().includes('plant') || c.toLowerCase() === 'plants'
                    );
                    return !hasPlantCategory;
                });
                rawItems.push(...filtered);
            } else if (typeof categoryItems === 'number') {
                // Simple count: {Steel: 500}
                rawItems.push({ label: categoryKey, count: categoryItems });
            } else if (categoryItems && typeof categoryItems === 'object') {
                rawItems.push(categoryItems);
            }
        }
    }

    // AGGREGATE items by label - combine stack counts
    const aggregated = new Map();
    rawItems.forEach(item => {
        const label = item.label || item.defName || item.def_name || 'Unknown';
        const defName = item.defName || item.def_name || label;
        const count = item.count || item.stackCount || item.stack_count || 1;

        if (aggregated.has(label)) {
            aggregated.get(label).count += count;
        } else {
            aggregated.set(label, { label, count, defName });
        }
    });

    const items = Array.from(aggregated.values());

    // Store in STATE for equipment browser
    STATE.storedResources = items;

    // Check if empty
    if (items.length === 0) {
        container.innerHTML = '<div class="col-span-full text-center text-xs text-rat-text-dim italic">Stockpile empty</div>';
        return;
    }

    // Build set of current item labels for cleanup
    const currentLabels = new Set(items.map(item => item.label || item.defName || 'Unknown'));

    // Build existing element map and remove stale/orphaned elements immediately
    const existingMap = new Map();
    Array.from(container.children).forEach(el => {
        const label = el.dataset.resourceLabel;
        if (label && currentLabels.has(label)) {
            existingMap.set(label, el);
        } else {
            // Remove orphaned or stale elements
            el.remove();
        }
    });

    // Collect defNames that need icons fetched
    const missingIcons = [];

    items.forEach(item => {
        // Try to get icon - check defName first, then label
        const iconData = STATE.itemIcons[item.defName] || STATE.itemIcons[item.label];
        const iconHtml = iconData
            ? `<img src="data:image/png;base64,${iconData}" class="w-8 h-8 min-w-[32px] object-contain" data-defname="${item.defName}">`
            : `<div class="w-8 h-8 min-w-[32px] bg-rat-border rounded flex items-center justify-center text-[8px] text-rat-text-dim" data-defname="${item.defName}">?</div>`;

        // Track missing icons for async fetch
        if (!iconData && item.defName && !STATE.pendingIconFetches?.has(item.defName)) {
            missingIcons.push(item.defName);
        }

        // Format count - handle both numbers and strings
        const count = typeof item.count === 'number' ? item.count : parseInt(item.count) || 0;
        const displayLabel = item.label || item.defName || 'Unknown';

        const content = `
            <div class="flex items-center gap-2 min-w-0 flex-1">
                ${iconHtml}
                <span class="text-xs text-rat-text truncate" title="${displayLabel}">${displayLabel}</span>
            </div>
            <span class="text-rat-green font-mono font-bold text-sm ml-2 whitespace-nowrap">${count.toLocaleString()}</span>
        `;

        if (existingMap.has(displayLabel)) {
            const el = existingMap.get(displayLabel);
            if (el.innerHTML !== content) el.innerHTML = content;
        } else {
            const el = document.createElement('div');
            el.className = "bg-rat-dark border border-rat-border p-2 rounded flex justify-between items-center hover:border-rat-green/30 transition-colors";
            el.dataset.resourceLabel = displayLabel;
            el.innerHTML = content;
            container.appendChild(el);
        }
    });

    // Fetch missing icons from RIMAPI asynchronously
    if (missingIcons.length > 0) {
        fetchMissingItemIcons(missingIcons, container);
    }
}

// Async function to fetch icons from RIMAPI and update the UI
async function fetchMissingItemIcons(defNames, container) {
    if (!STATE.pendingIconFetches) STATE.pendingIconFetches = new Set();

    // Limit concurrent fetches
    const toFetch = defNames.filter(d => !STATE.pendingIconFetches.has(d)).slice(0, 10);
    if (toFetch.length === 0) return;

    toFetch.forEach(d => STATE.pendingIconFetches.add(d));

    for (const defName of toFetch) {
        try {
            const response = await fetch(`http://localhost:8765/api/v1/item/image?name=${encodeURIComponent(defName)}`);
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.data?.image_base64) {
                    // Cache the icon
                    STATE.itemIcons[defName] = data.data.image_base64;

                    // Update any placeholder elements with this defName
                    const placeholders = container.querySelectorAll(`[data-defname="${defName}"]`);
                    placeholders.forEach(el => {
                        if (el.tagName === 'DIV') {
                            const img = document.createElement('img');
                            img.src = `data:image/png;base64,${data.data.image_base64}`;
                            img.className = 'w-8 h-8 min-w-[32px] object-contain';
                            img.dataset.defname = defName;
                            el.replaceWith(img);
                        }
                    });
                }
            }
        } catch (e) {
            // Silently fail for individual icons
        } finally {
            STATE.pendingIconFetches.delete(defName);
        }
    }
}

function updateInventoryList(colonists, gameState) {
    const inventoryContainer = document.getElementById('inventory-container');
    if (!inventoryContainer) return;

    // Clear loading text
    Array.from(inventoryContainer.children).forEach(el => {
        if (!el.dataset.pawnId) el.remove();
    });

    const existingRows = new Map();
    Array.from(inventoryContainer.children).forEach(row => {
        if (row.dataset.pawnId) existingRows.set(row.dataset.pawnId, row);
    });

    colonists.forEach((colonist, index) => {
        const pawnId = String(colonist.id || index);
        const name = colonist.name;

        // Skip colonists without names (position-only entries from ultrafast tier)
        if (!name) return;
        
        let isExpanded = false;
        if (existingRows.has(pawnId)) {
            isExpanded = existingRows.get(pawnId).classList.contains('expanded');
        }

        // Get inventory
        const inventoryData = gameState.inventory || {};
        let inv = inventoryData[pawnId];
        if (inv && inv.success && inv.data) inv = inv.data;

        let items = inv ? [
            ...(inv.items || []),
            ...(inv.apparels || []),
            ...(inv.equipment || [])
        ] : [];

        // Group items
        const groupedItems = new Map();
        items.forEach(item => {
            const defName = item.defName || item.def_name || item.label;
            const stackCount = item.stackCount || item.stack_count || 1;
            
            if (groupedItems.has(defName)) {
                const existing = groupedItems.get(defName);
                existing.stackCount += stackCount;
            } else {
                groupedItems.set(defName, { ...item, stackCount: stackCount });
            }
        });
        const groupedItemsArray = Array.from(groupedItems.values());

        const itemsHtml = groupedItemsArray.length === 0 ? 
            '<div class="p-3 text-xs text-rat-text-dim italic">No equipment carried</div>' : 
            groupedItemsArray.map(item => {
                const defName = item.defName || item.def_name || item.label;
                const iconData = STATE.itemIcons[defName];
                const iconHtml = iconData ? `<img src="data:image/png;base64,${iconData}" class="w-6 h-6 object-contain mr-3" />` : '';
                return `
                    <div class="flex items-center p-2 bg-rat-black border-b border-rat-border/50 last:border-0">
                        ${iconHtml}
                        <span class="text-sm text-rat-text flex-1">${item.label || item.defName}</span>
                        <span class="font-mono text-rat-green text-xs ml-2">x${item.stackCount}</span>
                    </div>
                `;
            }).join('');

        const portraitData = getColonistPortrait(pawnId);
        const portraitHtml = portraitData ? 
            `<img src="data:image/png;base64,${portraitData}" class="w-8 h-8 rounded object-cover mr-3 border border-rat-border" />` : 
            `<div class="w-8 h-8 rounded bg-rat-dark mr-3 border border-rat-border flex items-center justify-center text-xs">?</div>`;

        const createRowContent = () => `
            <div class="inventory-colonist-header bg-rat-panel p-3 flex items-center cursor-pointer hover:bg-rat-dark transition-colors">
                ${portraitHtml}
                <span class="font-mono text-sm flex-1">${name}</span>
                <span class="text-xs bg-rat-dark px-2 py-1 rounded text-rat-text-dim mr-2">${groupedItemsArray.length} items</span>
                <i class="fa-solid fa-chevron-down text-xs transition-transform ${isExpanded ? 'rotate-180' : ''}"></i>
            </div>
            <div class="inventory-items-list ${isExpanded ? 'block' : 'hidden'} bg-rat-dark/50 border-t border-rat-border">
                ${itemsHtml}
            </div>
        `;

        if (existingRows.has(pawnId)) {
            const row = existingRows.get(pawnId);
            const listDiv = row.querySelector('.inventory-items-list');
            const header = row.querySelector('.inventory-colonist-header');
            
            // Check if content needs update (simplified)
            // Ideally we compare data, but re-injecting innerHTML of the list is cheap enough here
            if (listDiv.innerHTML !== itemsHtml) {
                listDiv.innerHTML = itemsHtml;
            }
            
            // Update Header counts
            const countBadge = header.querySelector('.text-xs.bg-rat-dark');
            if(countBadge) countBadge.textContent = `${groupedItemsArray.length} items`;

            existingRows.delete(pawnId);
        } else {
            const row = document.createElement('div');
            row.className = `inventory-colonist-row border border-rat-border rounded overflow-hidden mb-2 ${isExpanded ? 'expanded' : ''}`;
            row.dataset.pawnId = pawnId;
            row.innerHTML = createRowContent();
            inventoryContainer.appendChild(row);
            
            // Toggle Logic
            row.querySelector('.inventory-colonist-header').addEventListener('click', (e) => {
                e.stopPropagation();
                const list = row.querySelector('.inventory-items-list');
                const chevron = row.querySelector('.fa-chevron-down');
                
                if (list.classList.contains('hidden')) {
                    list.classList.remove('hidden');
                    list.classList.add('block');
                    chevron.classList.add('rotate-180');
                    row.classList.add('expanded');
                } else {
                    list.classList.add('hidden');
                    list.classList.remove('block');
                    chevron.classList.remove('rotate-180');
                    row.classList.remove('expanded');
                }
            });
        }
    });

    existingRows.forEach(row => row.remove());
}