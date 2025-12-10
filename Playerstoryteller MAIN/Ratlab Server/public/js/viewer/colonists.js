import { STATE } from './state.js';
import { sendAction } from './interactions.js';
import { showFeedback } from './ui.js';

export function getColonistPortrait(pawnId) {
    // Check if we have a direct cached portrait (base64)
    if (STATE.colonistPortraits && STATE.colonistPortraits[pawnId]) {
        return STATE.colonistPortraits[pawnId];
    }
    return null;
}

export function updateColonistsList(newColonistsData, gameState) {
    const listContainer = document.getElementById('colonists-list');
    
    // Deduplicate newColonists based on pawnId
    const processedPawnIds = new Set();
    const newColonists = newColonistsData.filter(colonistDetailed => {
        const colonistData = colonistDetailed.colonist || colonistDetailed;
        const pawnId = String(colonistData.id || colonistData.pawn_id);
        if (processedPawnIds.has(pawnId)) return false;
        processedPawnIds.add(pawnId);
        return true;
    });

    // 1. Clear loading text or non-card elements
    Array.from(listContainer.children).forEach(child => {
        if (!child.hasAttribute('data-pawn-id')) {
            child.remove();
        }
    });

    const existingCards = new Map();
    Array.from(listContainer.children).forEach(card => {
        if (card.dataset.pawnId) {
            existingCards.set(card.dataset.pawnId, card);
        }
    });

    const newColonistIds = new Set();
    let domChanged = false;

    newColonists.forEach((colonistDetailed, index) => {
        const colonistData = colonistDetailed.colonist || colonistDetailed;
        const pawnId = String(colonistData.id || colonistData.pawn_id || index);
        newColonistIds.add(pawnId);

        if (existingCards.has(pawnId)) {
            const existingCard = existingCards.get(pawnId);
            updateColonistCard(existingCard, colonistDetailed, index, gameState); 
            existingCards.delete(pawnId);
        } else {
            const newHtml = createColonistCardHtml(colonistDetailed, index, gameState);
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = newHtml;
            const newCardElement = tempDiv.firstElementChild;
            listContainer.appendChild(newCardElement);
            domChanged = true;
        }
    });

    // Remove stale cards
    existingCards.forEach(card => {
        card.remove();
        domChanged = true;
    });

    // Only re-attach listeners if we touched the DOM
    if (domChanged) {
        attachColonistCardEventListeners(newColonists);
    }
}

function updateColonistCard(existingCard, colonistDetailed, index, gameState) {
    const colonistData = colonistDetailed.colonist || colonistDetailed;
    const name = colonistData.name || 'Unknown';
    const health = colonistData.health !== undefined ? colonistData.health : 0;
    const mood = colonistData.mood !== undefined ? colonistData.mood : 0;
    const position = colonistData.position || { x: 0, z: 0 };
    const pawnId = String(colonistData.id || colonistData.pawn_id || index);

    // Get inventory
    const inventoryData = gameState.inventory || {};
    let inv = inventoryData[pawnId];
    if (inv && inv.success && inv.data) inv = inv.data;

    let items = inv ? [
        ...(inv.items || []),
        ...(inv.apparels || []),
        ...(inv.equipment || [])
    ] : [];

    // Categorize equipment
    const equipment = { weapon: null, helmet: null, shirt: null, bodyArmor: null, pants: null, shield: null, belt: null };

    items.forEach(item => {
        const defName = (item.defName || item.def_name || '').toLowerCase();
        const label = (item.label || '').toLowerCase();
        const categories = item.categories || [];

        if (!equipment.weapon && (defName.includes('gun_') || defName.includes('weapon_') || defName.includes('melee') || categories.some(c => c.includes('weapon')))) equipment.weapon = item;
        else if (!equipment.helmet && (defName.includes('helmet') || defName.includes('hat') || defName.includes('cowboy') || label.includes('helmet') || label.includes('hat'))) equipment.helmet = item;
        else if (!equipment.shield && (defName.includes('shield') || label.includes('shield'))) equipment.shield = item;
        else if (!equipment.belt && (defName.includes('belt') || label.includes('belt'))) equipment.belt = item;
        else if (!equipment.pants && (defName.includes('pants') || defName.includes('trousers') || label.includes('pants') || label.includes('trousers'))) equipment.pants = item;
        else if (!equipment.shirt && (defName.includes('shirt') || defName.includes('tshirt') || defName.includes('button') || label.includes('shirt'))) equipment.shirt = item;
        else if (!equipment.bodyArmor && (defName.includes('armor') || defName.includes('vest') || defName.includes('duster') || defName.includes('parka') || defName.includes('jacket') || categories.some(c => c.includes('apparel')))) equipment.bodyArmor = item;
    });

    // 1. Update Name
    const nameEl = existingCard.querySelector('.colonist-info h4');
    if (nameEl && nameEl.textContent !== name) {
        nameEl.textContent = name;
    }

    // 2. Update Portrait
    const portraitContainer = existingCard.querySelector('.colonist-portrait');
    const portraitImg = portraitContainer.querySelector('img');
    const portraitData = getColonistPortrait(pawnId);
    
    if (portraitData && !portraitImg) { 
        const newPortraitHtml = `<img src="data:image/png;base64,${portraitData}" alt="${name}" class="w-full h-full object-cover" />`;
        portraitContainer.innerHTML = '';
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newPortraitHtml;
        portraitContainer.appendChild(tempDiv.firstElementChild);
    } else if (portraitData && portraitImg && portraitImg.src !== `data:image/png;base64,${portraitData}`) {
        portraitImg.src = `data:image/png;base64,${portraitData}`;
    } else if (!portraitData && portraitImg) { 
        portraitContainer.innerHTML = `<div class="portrait-placeholder w-full h-full flex items-center justify-center text-rat-text-dim">?</div>`;
    }

    // 3. Update Health/Mood
    const healthTextEl = existingCard.querySelector('.colonist-stat:nth-of-type(1) span:nth-of-type(2)');
    const healthFillEl = existingCard.querySelector('.health-bar-fill');
    if (healthTextEl) healthTextEl.textContent = `${Math.round(health * 100)}%`;
    if (healthFillEl) healthFillEl.style.width = `${health * 100}%`;

    const moodTextEl = existingCard.querySelector('.colonist-stat:nth-of-type(2) span:nth-of-type(2)');
    const moodFillEl = existingCard.querySelector('.mood-bar-fill');
    if (moodTextEl) moodTextEl.textContent = `${Math.round(mood * 100)}%`;
    if (moodFillEl) moodFillEl.style.width = `${mood * 100}%`;

    // 4. Update Position
    const posTextEl = existingCard.querySelector('.colonist-stat:nth-of-type(3) span:nth-of-type(2)');
    if (posTextEl) posTextEl.textContent = `X:${position.x} Z:${position.z}`;

    // 5. Update Equipment
    const renderEquipSlot = (slotName, slotItem, slotIcon) => {
        if (slotItem) {
            const defName = slotItem.defName || slotItem.def_name || slotItem.label;
            let iconData = STATE.itemIcons[defName];
            if (!iconData && STATE.itemIcons[slotItem.label]) iconData = STATE.itemIcons[slotItem.label];
            const itemLabel = slotItem.label || slotItem.defName || 'Unknown';

            if (iconData) {
                return `<div class="equip-slot filled" title="${itemLabel}">
                    <img src="data:image/png;base64,${iconData}" alt="${itemLabel}" class="equip-icon" />
                </div>`;
            } else {
                return `<div class="equip-slot filled" title="${itemLabel}">
                    <div class="equip-placeholder">${slotIcon}</div>
                </div>`;
            }
        }
        return `<div class="equip-slot empty" title="No ${slotName}">
            <div class="equip-placeholder">${slotIcon}</div>
        </div>`;
    };

    const newEquipmentHtml = `
        <div class="equip-row">
            ${renderEquipSlot('helmet', equipment.helmet, '🪖')}
        </div>
        <div class="equip-row">
            ${renderEquipSlot('shirt', equipment.shirt, '👕')}
            ${renderEquipSlot('body armor', equipment.bodyArmor, '🦺')}
            ${renderEquipSlot('weapon', equipment.weapon, '⚔️')}
        </div>
        <div class="equip-row">
            ${renderEquipSlot('shield', equipment.shield, '🛡️')}
            ${renderEquipSlot('belt', equipment.belt, '📿')}
            ${renderEquipSlot('pants', equipment.pants, '👖')}
        </div>
    `;
    const currentEquipmentLayout = existingCard.querySelector('.equipment-layout');
    if (currentEquipmentLayout && currentEquipmentLayout.innerHTML.trim() !== newEquipmentHtml.trim()) {
        currentEquipmentLayout.innerHTML = newEquipmentHtml;
    }
}

function createColonistCardHtml(colonistDetailed, index, gameState) {
    const colonistData = colonistDetailed.colonist || colonistDetailed;
    const pawnId = colonistData.id || colonistData.pawn_id || index;
    const name = colonistData.name || 'Unknown';
    const health = colonistData.health !== undefined ? colonistData.health : 0;
    const mood = colonistData.mood !== undefined ? colonistData.mood : 0;
    const position = colonistData.position || { x: 0, z: 0 };

    // Get inventory
    const inventoryData = gameState.inventory || {};
    let inv = inventoryData[pawnId];
    if (inv && inv.success && inv.data) inv = inv.data;

    let items = inv ? [...(inv.items || []), ...(inv.apparels || []), ...(inv.equipment || [])] : [];

    const equipment = { weapon: null, helmet: null, shirt: null, bodyArmor: null, pants: null, shield: null, belt: null };
    items.forEach(item => {
        const defName = (item.defName || item.def_name || '').toLowerCase();
        const label = (item.label || '').toLowerCase();
        const categories = item.categories || [];

        if (!equipment.weapon && (defName.includes('gun_') || defName.includes('weapon_') || defName.includes('melee') || categories.some(c => c.includes('weapon')))) equipment.weapon = item;
        else if (!equipment.helmet && (defName.includes('helmet') || defName.includes('hat') || defName.includes('cowboy') || label.includes('helmet') || label.includes('hat'))) equipment.helmet = item;
        else if (!equipment.shield && (defName.includes('shield') || label.includes('shield'))) equipment.shield = item;
        else if (!equipment.belt && (defName.includes('belt') || label.includes('belt'))) equipment.belt = item;
        else if (!equipment.pants && (defName.includes('pants') || defName.includes('trousers') || label.includes('pants') || label.includes('trousers'))) equipment.pants = item;
        else if (!equipment.shirt && (defName.includes('shirt') || defName.includes('tshirt') || defName.includes('button') || label.includes('shirt'))) equipment.shirt = item;
        else if (!equipment.bodyArmor && (defName.includes('armor') || defName.includes('vest') || defName.includes('duster') || defName.includes('parka') || defName.includes('jacket') || categories.some(c => c.includes('apparel')))) equipment.bodyArmor = item;
    });

    // Helper to render slots
    const renderEquipSlot = (slotName, slotItem, slotIcon) => {
        if (slotItem) {
            const defName = slotItem.defName || slotItem.def_name || slotItem.label;
            let iconData = STATE.itemIcons[defName];
            if (!iconData && STATE.itemIcons[slotItem.label]) iconData = STATE.itemIcons[slotItem.label];
            const itemLabel = slotItem.label || slotItem.defName || 'Unknown';

            if (iconData) {
                return `<div class="equip-slot filled" title="${itemLabel}">
                    <img src="data:image/png;base64,${iconData}" alt="${itemLabel}" class="equip-icon" />
                </div>`;
            } else {
                return `<div class="equip-slot filled" title="${itemLabel}">
                    <div class="equip-placeholder">${slotIcon}</div>
                </div>`;
            }
        }
        return `<div class="equip-slot empty" title="No ${slotName}">
            <div class="equip-placeholder">${slotIcon}</div>
        </div>`;
    };

    const portraitData = getColonistPortrait(pawnId);
    const portraitHtml = portraitData 
        ? `<img src="data:image/png;base64,${portraitData}" alt="${name}" class="w-full h-full object-cover" />`
        : `<div class="portrait-placeholder w-full h-full flex items-center justify-center text-rat-text-dim">?</div>`;

    return `
    <div class="colonist-card group bg-rat-panel border border-rat-border hover:border-rat-green transition-all relative overflow-hidden flex flex-col h-[280px]" data-pawn-id="${pawnId}">
        
        <!-- Header -->
        <div class="p-2 border-b border-rat-border bg-rat-dark flex justify-between items-start z-10 relative">
            <div class="colonist-info">
                <h4 class="font-bold text-rat-green text-sm truncate max-w-[120px]" title="${name}">${name}</h4>
                <div class="text-[10px] text-rat-text-dim font-mono">SUBJECT #${index + 1}</div>
            </div>
            
            <!-- Snapshot Button -->
            <button class="btn-snapshot text-rat-text-dim hover:text-white transition-colors" data-colonist-index="${index}" title="View Details">
                <i class="fa-solid fa-expand text-xs"></i>
            </button>
        </div>

        <!-- Body -->
        <div class="p-2 flex-1 flex flex-col gap-2 relative z-10 bg-rat-panel/90">
            
            <div class="flex gap-2 h-20">
                 <!-- Portrait -->
                <div class="colonist-portrait w-16 h-20 bg-black border border-rat-border shrink-0 cursor-pointer hover:border-rat-green transition-colors" data-pawn-id="${pawnId}">
                    ${portraitHtml}
                </div>

                <!-- Stats -->
                <div class="flex-1 flex flex-col justify-between text-[10px] font-mono">
                    <div class="colonist-stat">
                        <span class="text-rat-text-dim">HLTH</span>
                        <span class="text-rat-text ml-1">${Math.round(health * 100)}%</span>
                        <div class="h-1 bg-rat-border mt-0.5 rounded-full overflow-hidden">
                            <div class="health-bar-fill h-full bg-rat-green transition-all duration-500" style="width: ${health * 100}%"></div>
                        </div>
                    </div>
                    <div class="colonist-stat">
                        <span class="text-rat-text-dim">MOOD</span>
                        <span class="text-rat-text ml-1">${Math.round(mood * 100)}%</span>
                         <div class="h-1 bg-rat-border mt-0.5 rounded-full overflow-hidden">
                            <div class="mood-bar-fill h-full bg-rat-yellow transition-all duration-500" style="width: ${mood * 100}%"></div>
                        </div>
                    </div>
                    <div class="colonist-stat">
                        <span class="text-rat-text-dim">POS</span>
                        <span class="text-rat-text ml-1">X:${position.x} Z:${position.z}</span>
                    </div>
                </div>
            </div>

            <!-- Equipment Grid -->
            <div class="equipment-layout grid gap-1 mt-1">
                <div class="equip-row">
                    ${renderEquipSlot('helmet', equipment.helmet, '🪖')}
                </div>
                <div class="equip-row">
                    ${renderEquipSlot('shirt', equipment.shirt, '👕')}
                    ${renderEquipSlot('body armor', equipment.bodyArmor, '🦺')}
                    ${renderEquipSlot('weapon', equipment.weapon, '⚔️')}
                </div>
                <div class="equip-row">
                    ${renderEquipSlot('shield', equipment.shield, '🛡️')}
                    ${renderEquipSlot('belt', equipment.belt, '📿')}
                    ${renderEquipSlot('pants', equipment.pants, '👖')}
                </div>
            </div>

        </div>

        <!-- BG Effect -->
        <div class="absolute inset-0 bg-[url('/scanlines.png')] opacity-10 pointer-events-none z-0"></div>
    </div>
    `;
}

function attachColonistCardEventListeners(colonists) {
    document.querySelectorAll('.btn-snapshot').forEach(btn => {
        const oldHandler = btn.__snapshotClickHandler;
        if (oldHandler) btn.removeEventListener('click', oldHandler);

        const newHandler = (e) => {
            e.stopPropagation();
            const colonistIndex = parseInt(btn.dataset.colonistIndex);
            const colonist = colonists[colonistIndex];
            const colonistData = colonist.colonist || colonist;
            const pawnId = colonistData.id || colonistData.pawn_id || colonistIndex;
            showColonistSnapshot(colonist, pawnId);
        };
        btn.addEventListener('click', newHandler);
        btn.__snapshotClickHandler = newHandler;
    });

    document.querySelectorAll('.colonist-portrait').forEach(portrait => {
        const oldHandler = portrait.__portraitClickHandler;
        if (oldHandler) portrait.removeEventListener('click', oldHandler);

        const newHandler = (e) => {
            e.stopPropagation();
            const pawnId = portrait.dataset.pawnId;
            const colonist = colonists.find(c => String(c.colonist?.id || c.colonist?.pawn_id) === pawnId);
            if (colonist) {
                showColonistSnapshot(colonist, pawnId);
            }
        };
        portrait.addEventListener('click', newHandler);
        portrait.__portraitClickHandler = newHandler;
    });
}

export async function showColonistSnapshot(colonistDetailed, pawnId) {
    const colonistData = colonistDetailed.colonist || colonistDetailed;
    const workInfo = colonistDetailed.colonist_work_info || {};
    // const medicalInfo = colonistDetailed.colonist_medical_info || {};

    const name = colonistData.name || 'Unknown';
    // const health = colonistData.health !== undefined ? colonistData.health : 0;
    // const mood = colonistData.mood !== undefined ? colonistData.mood : 0;
    // const position = colonistData.position || { x: 0, z: 0 };

    const age = colonistData.age || 'Unknown';
    const gender = colonistData.gender || 'Unknown';
    const currentActivity = workInfo.current_job || colonistData.current_activity || 'Idle';
    const traits = workInfo.traits || [];
    const skills = workInfo.skills || [];

    // Needs
    const needs = {
        sleep: colonistDetailed.sleep,
        comfort: colonistDetailed.comfort,
        recreation: colonistData.joy || colonistData.recreation,
        food: colonistData.food || colonistData.hunger,
    };

    // Build skills HTML
    let skillsHtml = '';
    if (skills.length > 0) {
        const sortedSkills = [...skills]
            .filter(skill => !skill.permanently_disabled && !skill.totally_disabled)
            .sort((a, b) => (b.level || 0) - (a.level || 0));

        skillsHtml = sortedSkills.slice(0, 10).map(skill => {
            const skillName = skill.name || 'Unknown';
            const skillLevel = skill.level !== undefined ? skill.level : 0;
            const passion = skill.passion || 0;
            const passionIcon = passion === 2 ? '<span class="text-rat-yellow">🔥🔥</span>' : passion === 1 ? '<span class="text-rat-yellow">🔥</span>' : '';

            return `
                <div class="grid grid-cols-[1fr_auto] gap-2 items-center mb-2 text-sm">
                    <span class="text-rat-text">${skillName} ${passionIcon}</span>
                    <span class="font-mono font-bold text-rat-green">${skillLevel}</span>
                    <div class="col-span-2 h-1 bg-rat-border rounded-full overflow-hidden">
                        <div class="h-full bg-rat-green" style="width: ${(skillLevel / 20) * 100}%"></div>
                    </div>
                </div>
            `;
        }).join('');
    } else {
        skillsHtml = '<p class="text-rat-text-dim text-sm italic">Data corrupted/unavailable</p>';
    }

    // Build traits HTML
    let traitsHtml = '';
    if (traits.length > 0) {
        traitsHtml = traits.map(t => `<span class="bg-rat-dark border border-rat-border px-2 py-1 rounded text-xs text-rat-text-dim">${t.label || t}</span>`).join('');
    } else {
        traitsHtml = '<span class="text-rat-text-dim italic text-xs">None</span>';
    }

    // Build needs HTML
    const renderNeed = (label, val) => {
        if (val === undefined) return '';
        const pct = Math.round(val * 100);
        return `
            <div>
                <div class="flex justify-between text-xs mb-1">
                    <span class="text-rat-text-dim">${label}</span>
                    <span class="text-rat-text">${pct}%</span>
                </div>
                <div class="h-1 bg-rat-border rounded-full overflow-hidden">
                    <div class="h-full bg-rat-yellow" style="width: ${pct}%"></div>
                </div>
            </div>
        `;
    };

    const modalHtml = `
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in" id="snapshot-modal">
        <div class="bg-rat-panel border border-rat-green w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-lg shadow-[0_0_30px_rgba(0,255,65,0.1)] flex flex-col md:flex-row relative">
            
            <button class="absolute top-4 right-4 text-rat-text-dim hover:text-white z-50" onclick="document.getElementById('snapshot-modal').remove()">
                <i class="fa-solid fa-times text-xl"></i>
            </button>

            <!-- Left: Visuals & Actions -->
            <div class="w-full md:w-1/3 bg-rat-dark p-6 border-b md:border-b-0 md:border-r border-rat-border flex flex-col gap-6">
                <div class="aspect-[3/4] bg-black border border-rat-border rounded-lg overflow-hidden relative group">
                    ${getColonistPortrait(pawnId) 
                        ? `<img src="data:image/png;base64,${getColonistPortrait(pawnId)}" class="w-full h-full object-cover">` 
                        : `<div class="w-full h-full flex items-center justify-center text-rat-text-dim text-4xl">?</div>`
                    }
                    <div class="absolute bottom-0 left-0 right-0 bg-black/80 p-2 text-center">
                        <h2 class="text-rat-green font-bold text-lg leading-tight">${name}</h2>
                        <div class="text-rat-text-dim text-xs font-mono">${age} • ${gender}</div>
                    </div>
                </div>

                <div class="flex flex-col gap-2">
                    <div class="text-xs font-mono text-rat-text-dim uppercase mb-1">Direct Neural Interface</div>
                    <button class="w-full py-3 bg-rat-green text-black font-bold font-mono rounded hover:bg-white transition-colors flex items-center justify-center gap-2" id="btn-select-snapshot">
                        <i class="fa-solid fa-crosshairs"></i> SELECT SUBJECT
                    </button>
                    <button class="w-full py-3 bg-rat-dark border border-rat-yellow text-rat-yellow font-bold font-mono rounded hover:bg-rat-yellow hover:text-black transition-colors flex items-center justify-center gap-2" id="btn-adopt-snapshot">
                        <i class="fa-solid fa-heart"></i> ADOPT SUBJECT (2000c)
                    </button>
                    <button class="w-full py-2 bg-rat-panel border border-rat-border text-rat-text-dim font-mono rounded hover:text-white transition-colors flex items-center justify-center gap-2" onclick="showFeedback('info', 'HISTORY LOG ENCRYPTED')">
                        <i class="fa-solid fa-file-medical-alt"></i> VIEW LOGS
                    </button>
                </div>
            </div>

            <!-- Right: Data -->
            <div class="flex-1 p-6 flex flex-col gap-6">
                
                <!-- Status Header -->
                <div class="flex flex-wrap gap-4 p-4 bg-rat-dark rounded border border-rat-border">
                    <div class="flex-1">
                        <div class="text-xs text-rat-text-dim mb-1">CURRENT ACTIVITY</div>
                        <div class="text-rat-text font-mono">${currentActivity}</div>
                    </div>
                     <div class="flex-1">
                        <div class="text-xs text-rat-text-dim mb-1">TRAITS</div>
                        <div class="flex flex-wrap gap-1">${traitsHtml}</div>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <!-- Skills -->
                    <div>
                        <h3 class="text-rat-green font-mono text-sm border-b border-rat-border pb-1 mb-3">NEURAL PROFILES (SKILLS)</h3>
                        <div class="max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                            ${skillsHtml}
                        </div>
                    </div>

                    <!-- Vitals -->
                    <div class="flex flex-col gap-6">
                        <div>
                            <h3 class="text-rat-green font-mono text-sm border-b border-rat-border pb-1 mb-3">VITALS</h3>
                            <div class="flex flex-col gap-3 font-mono">
                                ${renderNeed('NUTRITION', needs.food)}
                                ${renderNeed('REST', needs.sleep)}
                                ${renderNeed('RECREATION', needs.recreation)}
                                ${renderNeed('COMFORT', needs.comfort)}
                            </div>
                        </div>

                        <div class="bg-rat-dark/50 p-4 rounded border border-rat-border/50">
                             <div class="flex items-start gap-3">
                                <i class="fa-solid fa-triangle-exclamation text-rat-yellow mt-1"></i>
                                <div class="text-xs text-rat-text-dim italic">
                                    Subject is monitored by the RatLab Neural Link. Direct intervention requires "Adoption" clearance or Administrator override.
                                </div>
                             </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Attach listeners
    document.getElementById('btn-select-snapshot').onclick = async () => {
        showFeedback('info', 'TRANSMITTING SELECTION...');
        try {
            await sendAction('colonist_command', JSON.stringify({
                type: 'select',
                pawnId: pawnId
            }));
            showFeedback('success', 'SUBJECT SELECTED');
        } catch (error) {
            showFeedback('error', 'SELECTION FAILED');
        }
    };

    document.getElementById('btn-adopt-snapshot').onclick = async () => {
         // Trigger Adoption Flow
         if (!STATE.username) {
             showFeedback('error', 'LOGIN REQUIRED');
             return;
         }
         
         const cost = 2000;
         if (confirm(`Adopt ${name} for ${cost} Credits? This will grant you exclusive control and a private view.`)) {
             try {
                // Check funds (simplified)
                const coinBalance = document.getElementById('coin-balance');
                const currentCoinText = coinBalance ? coinBalance.textContent.replace(/[^0-9]/g, '') : '0';
                if (parseInt(currentCoinText) < cost) {
                    showFeedback('error', 'INSUFFICIENT FUNDS');
                    return;
                }

                // Call Adoption API
                // For now, simulate via command or specific endpoint if it exists
                // We'll use the generic action for now with a special type
                // In a real implementation, you might have a dedicated adoption endpoint
                
                await sendAction('adopt_colonist', JSON.stringify({
                    pawnId: pawnId,
                    cost: cost
                }));

             } catch(e) {
                 showFeedback('error', 'ADOPTION FAILED');
             }
         }
    };
}
