import { STATE } from './state.js';
import { updateColonistsList } from './colonists.js';
import { updateMyPawnUI } from './mypawn.js';
import { updateMapOverlays } from './map.js';
import { sendAction } from './interactions.js';
import { showFeedback } from './ui.js';
import { updateActionButtonsCosts } from './actions.js';

let hasLoggedInitialState = false;

export function updateGameState(gameState) {
    if (!gameState) return;
    
    // Store global state (legacy support for simple access if needed)
    window.lastGameState = gameState;

    if (!hasLoggedInitialState) {
        console.log('Game State received:', gameState);
        hasLoggedInitialState = true;
    }

    // Update Caches
    if (gameState.camera) STATE.cameraBounds = gameState.camera;
    if (gameState.colonist_portraits) Object.assign(STATE.colonistPortraits, gameState.colonist_portraits);
    if (gameState.item_icons) {
        Object.assign(STATE.itemIcons, gameState.item_icons);
        // loadActionItemIcons() implementation logic here if needed, or just rely on state
    }

    // 1. Core Data Extraction
    const colonists = gameState.colonists || [];
    const resources = gameState.resources || {};
    // const power = gameState.power || {};
    // const creatures = gameState.creatures || {};
    // const research = gameState.research || {};
    const factions = gameState.factions || [];
    const mods = gameState.mods || [];

    // 2. UI Updates
    const colonistCount = document.getElementById('colonist-count');
    const wealthDisplay = document.getElementById('wealth');
    
    if (colonistCount) colonistCount.textContent = colonists.length;
    if (wealthDisplay) wealthDisplay.textContent = `$${((resources.total_market_value || 0)/1000).toFixed(1)}k`;

    // 3. Module Updates
    updateMyPawnUI(gameState);
    
    if (colonists.length > 0) {
        updateColonistsList(colonists, gameState);
        updateMapOverlays(gameState);
    } else {
         const list = document.getElementById('colonists-list');
         if(list) list.innerHTML = '<p class="loading col-span-full text-center">No active subjects found</p>';
    }

    // 4. DLC Visibility
    updateDLCIndicators(gameState.active_dlcs);

    // 5. Medical Alerts
    updateMedicalAlerts(colonists);

    // 6. Stats & Info
    if (gameState.power) updatePowerStats(gameState.power);
    if (gameState.creatures) updateCreatureStats(gameState.creatures);
    if (gameState.research) updateResearchStats(gameState.research);
    if (factions.length > 0) updateFactionsList(factions);
    if (mods.length > 0) updateModsList(mods);
    if (gameState.stored_resources) updateStoredResources(gameState.stored_resources);
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
    colonists.forEach(colonistDetailed => {
        const colonistData = colonistDetailed.colonist || colonistDetailed;
        const medicalInfo = colonistDetailed.colonist_medical_info || {};
        const name = colonistData.name || 'Unknown';
        const pawnId = colonistData.id || colonistData.pawn_id;
        const hediffs = medicalInfo.hediffs || [];

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
    const prod = power.produced || 0;
    const cons = power.consumed || 0;
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
    
    creatureStats.innerHTML = `
        <div class="grid grid-cols-2 gap-2 text-xs">
            <div class="bg-rat-dark p-2 rounded border border-rat-border text-center">
                <div class="text-rat-text-dim text-[10px]">TAME</div>
                <div class="text-rat-green font-bold text-lg">${creatures.colony_animals || 0}</div>
            </div>
            <div class="bg-rat-dark p-2 rounded border border-rat-border text-center">
                <div class="text-rat-text-dim text-[10px]">WILD</div>
                <div class="text-rat-yellow font-bold text-lg">${creatures.wild_animals || 0}</div>
            </div>
            <div class="bg-rat-dark p-2 rounded border border-rat-border text-center">
                <div class="text-rat-text-dim text-[10px]">HOSTILE</div>
                <div class="text-rat-red font-bold text-lg">${creatures.hostile_creatures || 0}</div>
            </div>
            <div class="bg-rat-dark p-2 rounded border border-rat-border text-center">
                <div class="text-rat-text-dim text-[10px]">INSECTS</div>
                <div class="text-rat-red font-bold text-lg">${creatures.insects || 0}</div>
            </div>
        </div>
    `;
}

function updateResearchStats(research) {
    const researchStats = document.getElementById('research-stats');
    if (!research || !researchStats) return;

    if (research.current_project) {
        const progress = research.progress || 0;
        const total = research.cost || 1;
        const pct = Math.round((progress / total) * 100);

        researchStats.innerHTML = `
            <div class="text-xs text-rat-green mb-1 truncate" title="${research.current_project}">${research.current_project}</div>
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
    
    // Deduplicate
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
        
        const content = `
            <div class="flex justify-between items-center">
                <span class="text-xs font-bold text-rat-text truncate pr-2" title="${faction.name}">${faction.name}</span>
                <span class="text-[10px] font-mono ${relationColor}">${faction.goodwill}</span>
            </div>
            <div class="text-[10px] text-rat-text-dim">${faction.type || faction.relation}</div>
        `;

        if (existingMap.has(slug)) {
             const el = existingMap.get(slug);
             if (el.innerHTML !== content) el.innerHTML = content;
             existingMap.delete(slug);
        } else {
             const el = document.createElement('div');
             el.className = "bg-rat-dark border border-rat-border p-2 rounded hover:border-rat-green/30 transition-colors";
             el.dataset.factionName = slug;
             el.innerHTML = content;
             container.appendChild(el);
        }
    });

    existingMap.forEach(el => el.remove());
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

    // Convert object to array if needed
    let items = [];
    if (Array.isArray(resources)) {
        items = resources;
    } else {
        items = Object.entries(resources).map(([label, count]) => ({ label, count }));
    }

    container.innerHTML = items.map(item => `
        <div class="bg-rat-dark border border-rat-border p-2 rounded flex justify-between items-center hover:border-rat-green/30 transition-colors">
            <span class="text-xs text-rat-text truncate pr-2" title="${item.label}">${item.label}</span>
            <span class="text-rat-green font-mono font-bold text-sm">${item.count.toLocaleString()}</span>
        </div>
    `).join('');
}
