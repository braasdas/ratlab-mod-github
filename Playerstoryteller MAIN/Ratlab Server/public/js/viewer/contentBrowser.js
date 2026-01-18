import { STATE } from './state.js';

let definitions = null;

export async function openContentBrowser(category) {
    const modal = document.getElementById('content-browser-modal');
    const title = document.getElementById('browser-title');
    const grid = document.getElementById('browser-grid');
    const filterSelect = document.getElementById('browser-filter');
    const searchInput = document.getElementById('browser-search');
    
    // Reset state
    grid.innerHTML = '<p class="text-rat-text-dim font-mono col-span-full text-center py-10">Fetching telemetry...</p>';
    filterSelect.innerHTML = '<option value="all">ALL CATEGORIES</option>';
    searchInput.value = '';
    
    modal.classList.remove('hidden');

    // Equipment uses STATE.storedResources, no API fetch needed
    const needsDefinitions = category !== 'equipment' && category !== 'weapons';

    // Fetch definitions if not cached (only for non-equipment categories)
    if (needsDefinitions && !definitions) {
        try {
            const res = await fetch(`/api/definitions/${STATE.currentSession}`);
            if (res.ok) {
                definitions = await res.json();
            } else {
                throw new Error('API Error');
            }
        } catch (e) {
            grid.innerHTML = '<p class="text-rat-red font-mono col-span-full text-center py-10">Failed to load game data.</p>';
            return;
        }
    }

    // Render logic based on category
    let items = [];
    let filters = [];

    if (category === 'weather') {
        title.textContent = 'WEATHER CONTROL';
        items = (definitions.weather || []).map(w => ({
            id: w.defName,
            label: w.label,
            desc: w.description,
            type: 'weather',
            category: 'Weather',
            cost: 500 // Default cost
        }));
    } else if (category === 'events') {
        title.textContent = 'EVENT DIRECTOR';
        items = (definitions.incidents || []).map(i => ({
            id: i.defName,
            label: i.label,
            desc: i.category,
            type: 'event',
            category: i.category,
            cost: 1000 // Default cost
        }));
        filters = [...new Set(items.map(i => i.category))];
    } else if (category === 'animals') {
        title.textContent = 'ANIMAL SPAWNER';
        items = (definitions.animals || []).map(a => ({
            id: a.defName,
            label: a.label,
            desc: a.race,
            type: 'animal',
            category: a.race || 'Unknown',
            cost: Math.max(100, Math.floor((a.combatPower || 10) * 2)) // Dynamic pricing
        }));
    } else if (category === 'equipment' || category === 'weapons') {
        title.textContent = 'STORAGE ITEMS';
        // Use stored resources from STATE (items in storage zones)
        items = (STATE.storedResources || []).map(r => ({
            id: r.defName || r.label, // defName if available, otherwise use label
            label: r.label,
            desc: `${r.count} in storage`,
            type: 'equipment',
            category: 'Storage',
            cost: 0, // Equipping from storage should be free
            count: r.count
        }));
        if (items.length === 0) {
            grid.innerHTML = '<p class="text-rat-text-dim font-mono col-span-full text-center py-10">No items in storage zones.</p>';
            return;
        }
    }

    // Populate Filter Dropdown
    if (filters.length > 0) {
        filters.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f;
            opt.textContent = f;
            filterSelect.appendChild(opt);
        });
        filterSelect.disabled = false;
    } else {
        filterSelect.disabled = true;
    }

    // Initial Render
    renderBrowserItems(items, grid);

    // Search Handler
    searchInput.oninput = (e) => {
        const query = e.target.value.toLowerCase();
        const cat = filterSelect.value;
        const filtered = items.filter(i => 
            (cat === 'all' || i.category === cat) &&
            (i.label.toLowerCase().includes(query) || i.id.toLowerCase().includes(query))
        );
        renderBrowserItems(filtered, grid);
    };

    // Filter Handler
    filterSelect.onchange = (e) => {
        searchInput.dispatchEvent(new Event('input'));
    };
}

export function closeContentBrowser() {
    const modal = document.getElementById('content-browser-modal');
    modal.classList.add('hidden');
}

export function selectBrowserItem(id, type, cost, label) {
    let actionName = '';
    let actionData = id; // Default to passing ID string

    if (type === 'weather') {
        actionName = 'change_weather_dynamic';
    } else if (type === 'animal') {
        actionName = 'spawn_pawn_dynamic';
    } else if (type === 'equipment') {
        // Equip item from storage to adopted pawn
        actionName = 'forceEquip';
        actionData = JSON.stringify({
            defName: id,
            pawnId: STATE.myPawnId
        });
    } else {
        actionName = 'trigger_incident_dynamic';
    }

    const event = new CustomEvent('ratlab:action', {
        detail: {
            action: actionName,
            data: actionData,
            cost: cost
        }
    });
    window.dispatchEvent(event);
    closeContentBrowser();
}

function renderBrowserItems(items, container) {
    document.getElementById('browser-count').textContent = `${items.length} ITEMS FOUND`;
    
    if (items.length === 0) {
        container.innerHTML = '<p class="text-rat-text-dim font-mono col-span-full text-center py-10">No items match your criteria.</p>';
        return;
    }

    container.innerHTML = items.map(item => `
        <div class="browser-item-card bg-rat-panel border border-rat-border rounded p-4 hover:border-rat-green transition-colors group relative cursor-pointer" 
             data-id="${item.id}"
             data-type="${item.type}"
             data-cost="${item.cost}"
             data-label="${(item.label || '').replace(/"/g, '&quot;')}"
        >
            <div class="flex justify-between items-start mb-2">
                <h4 class="font-bold text-rat-text group-hover:text-rat-green text-sm truncate pr-2" title="${item.label}">${item.label}</h4>
                <span class="text-[10px] font-mono text-rat-yellow bg-rat-dark px-1.5 py-0.5 rounded border border-rat-border">${item.cost}c</span>
            </div>
            <p class="text-[10px] text-rat-text-dim line-clamp-2 h-8 mb-2">${item.desc || 'No description available.'}</p>
            <div class="flex justify-between items-center text-[10px] font-mono text-rat-text-dim">
                <span>${item.category}</span>
                <span class="group-hover:text-white">SELECT <i class="fa-solid fa-chevron-right ml-1"></i></span>
            </div>
        </div>
    `).join('');

    // Attach listeners
    container.querySelectorAll('.browser-item-card').forEach(card => {
        card.onclick = () => {
            selectBrowserItem(
                card.dataset.id,
                card.dataset.type,
                parseInt(card.dataset.cost),
                card.dataset.label
            );
        };
    });
}
