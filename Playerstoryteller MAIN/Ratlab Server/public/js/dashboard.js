// DASHBOARD LOGIC

// State
let sessionId = null;
let streamKey = null;
let currentSettings = {};
let currentEconomy = {};
let currentMeta = {};
let currentQueueSettings = {};
let sessionMonitorInterval = null;

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const dashboardUi = document.getElementById('dashboard-ui');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const saveBtn = document.getElementById('save-changes-btn');
const saveStatus = document.getElementById('save-status');

const sessionIdInput = document.getElementById('session-id-input');
const streamKeyInput = document.getElementById('stream-key-input');
const dashSessionIdDisplay = document.getElementById('dash-session-id');

// Views
const views = {
    general: document.getElementById('view-general'),
    actions: document.getElementById('view-actions'),
    economy: document.getElementById('view-economy')
};
const navBtns = document.querySelectorAll('.nav-btn');

// Action Categories (for rendering)
const actionCategories = {
    'Helpful': ['heal_colonist', 'heal_all', 'inspire_colonist', 'inspire_all', 'send_wanderer', 'send_refugee'],
    'Resources': ['drop_food', 'drop_medicine', 'drop_steel', 'drop_components', 'drop_silver', 'send_legendary', 'send_trader'],
    'Animals & Nature': ['tame_animal', 'spawn_animal', 'farm_animals_wander_in', 'thrumbo_passes', 'herd_migration', 'wild_man_wanders_in', 'alphabeavers', 'ambrosia_sprout'],
    'World Events': ['good_event', 'psychic_soothe', 'aurora', 'ransom_demand', 'short_circuit'],
    'Weather': [
        'weather_clear', 'weather_rain', 'weather_fog', 'weather_snow', 'weather_thunderstorm',
        'weather_vomit', 'weather_heat_wave', 'weather_cold_snap', 'weather_dry_storm', 
        'weather_foggy_rain', 'weather_snow_gentle', 'weather_snow_hard', 'volcanic_winter'
    ],
    'Dangerous': ['raid', 'manhunter', 'mad_animal', 'solar_flare', 'eclipse', 'toxic_fallout', 'flashstorm', 'meteor', 'tornado', 'lightning', 'random_event', 'infestation', 'mech_ship', 'psychic_drone', 'crop_blight'],
    'Communication': ['send_letter', 'ping'],
    'DLC: Royalty': ['dlc_laborers', 'dlc_tribute', 'dlc_anima_tree', 'dlc_mech_cluster'],
    'DLC: Ideology': ['dlc_ritual', 'dlc_gauranlen', 'dlc_hacker_camp', 'dlc_insect_jelly', 'dlc_skylanterns'],
    'DLC: Biotech': ['dlc_diabolus', 'dlc_warqueen', 'dlc_apocriton', 'dlc_wastepack', 'dlc_sanguophage', 'dlc_genepack', 'dlc_polux_tree', 'dlc_acidic_smog', 'dlc_wastepack_infestation'],
    'DLC: Anomaly': ['dlc_death_pall', 'dlc_blood_rain', 'dlc_darkness', 'dlc_shamblers', 'dlc_fleshbeasts', 'dlc_pit_gate', 'dlc_chimera', 'dlc_nociosphere', 'dlc_golden_cube', 'dlc_metalhorror'],
    'DLC: Odyssey': ['dlc_gravship', 'dlc_drones', 'dlc_orbital_trader', 'dlc_orbital_debris', 'dlc_mechanoid_signal']
};

// Pretty Names map
const prettyNames = {
    'heal_colonist': 'Heal Colonist', 'heal_all': 'Heal All', 'inspire_colonist': 'Inspire Colonist', 'inspire_all': 'Inspire All',
    'send_wanderer': 'Send Wanderer', 'send_refugee': 'Send Refugee',
    'drop_food': 'Drop Food', 'drop_medicine': 'Drop Medicine', 'drop_steel': 'Drop Steel', 'drop_components': 'Drop Components',
    'drop_silver': 'Drop Silver', 'send_legendary': 'Send Legendary', 'send_trader': 'Send Trader',
    'tame_animal': 'Tame Animal', 'spawn_animal': 'Spawn Animal', 'good_event': 'Good Event',
    'weather_clear': 'Clear Skies', 'weather_rain': 'Rain', 'weather_fog': 'Fog', 'weather_snow': 'Snow', 'weather_thunderstorm': 'Thunderstorm',
    'weather_vomit': 'Vomit Rain', 'weather_heat_wave': 'Heat Wave', 'weather_cold_snap': 'Cold Snap',
    'weather_dry_storm': 'Dry Storm', 'weather_foggy_rain': 'Foggy Rain', 'weather_snow_gentle': 'Gentle Snow', 'weather_snow_hard': 'Hard Snow',
    'raid': 'Raid', 'manhunter': 'Manhunter Pack', 'mad_animal': 'Mad Animal', 'solar_flare': 'Solar Flare',
    'eclipse': 'Eclipse', 'toxic_fallout': 'Toxic Fallout', 'flashstorm': 'Flashstorm', 'meteor': 'Meteor Strike',
    'tornado': 'Tornado', 'lightning': 'Lightning Strike', 'random_event': 'Random Event',
    'send_letter': 'Send Letter', 'ping': 'Map Ping',
    // New Actions
    'farm_animals_wander_in': 'Farm Animals', 'wild_man_wanders_in': 'Wild Man', 'ambrosia_sprout': 'Ambrosia Sprout',
    'volcanic_winter': 'Volcanic Winter', 'infestation': 'Infestation', 'mech_ship': 'Mech Ship',
    'psychic_drone': 'Psychic Drone', 'crop_blight': 'Crop Blight', 'alphabeavers': 'Alphabeavers',
    'ransom_demand': 'Ransom Demand', 'psychic_soothe': 'Psychic Soothe', 'aurora': 'Aurora',
    'short_circuit': 'Short Circuit', 'herd_migration': 'Herd Migration', 'thrumbo_passes': 'Thrumbo Passes',
    // DLC
    'dlc_laborers': 'Empire Laborers', 'dlc_tribute': 'Tribute Collector', 'dlc_anima_tree': 'Anima Tree', 'dlc_mech_cluster': 'Mech Cluster',
    'dlc_ritual': 'Start Ritual', 'dlc_gauranlen': 'Gauranlen Pod', 'dlc_hacker_camp': 'Hacker Quest', 'dlc_insect_jelly': 'Insect Jelly', 'dlc_skylanterns': 'Skylanterns',
    'dlc_diabolus': 'Summon Diabolus', 'dlc_warqueen': 'Summon Warqueen', 'dlc_apocriton': 'Summon Apocriton',
    'dlc_wastepack': 'Drop Wastepacks', 'dlc_sanguophage': 'Sanguophage', 'dlc_genepack': 'Genepack Drop', 'dlc_polux_tree': 'Polux Tree', 'dlc_acidic_smog': 'Acidic Smog', 'dlc_wastepack_infestation': 'Wastepack Hive',
    'dlc_death_pall': 'Death Pall', 'dlc_blood_rain': 'Blood Rain', 'dlc_darkness': 'Unnatural Darkness',
    'dlc_shamblers': 'Shambler Swarm', 'dlc_fleshbeasts': 'Fleshbeasts', 'dlc_pit_gate': 'Pit Gate', 'dlc_chimera': 'Chimera Assault', 'dlc_nociosphere': 'Nociosphere', 'dlc_golden_cube': 'Golden Cube', 'dlc_metalhorror': 'Metalhorror',
    'dlc_gravship': 'Gravship Crash', 'dlc_drones': 'Explosive Drones', 'dlc_orbital_trader': 'Odyssey Trader', 'dlc_orbital_debris': 'Orbital Debris', 'dlc_mechanoid_signal': 'Mech Signal',
    'short_circuit': 'Short Circuit'
};

// --- INIT ---

// Check URL params for session ID
const urlParams = new URLSearchParams(window.location.search);
const urlSession = urlParams.get('session');

if (urlSession) {
    sessionIdInput.value = urlSession;
}

// Check local storage for session credentials
const storedSession = localStorage.getItem('dash_session');
const storedKey = localStorage.getItem('dash_key');

if (storedSession && !urlSession) { // Prefer URL over stored if present
    sessionIdInput.value = storedSession;
}
if (storedKey) {
    streamKeyInput.value = storedKey;
}

// --- EVENT LISTENERS ---

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sess = sessionIdInput.value.trim();
    const key = streamKeyInput.value.trim();

    if (!sess || !key) return;

    loginError.classList.add('hidden');
    const btn = loginForm.querySelector('button');
    const origText = btn.innerText;
    btn.innerText = 'CONNECTING...';
    btn.disabled = true;

    try {
        const valid = await validateCredentials(sess, key);
        if (valid) {
            sessionId = sess;
            streamKey = key;
            localStorage.setItem('dash_session', sessionId);
            localStorage.setItem('dash_key', streamKey);
            
            dashSessionIdDisplay.textContent = `SESSION: ${sessionId}`;
            loginScreen.classList.add('hidden');
            dashboardUi.classList.remove('hidden');
            
            await fetchSettings();
            renderSettings();
            
            // Start monitoring for session ID changes (e.g. switching to private)
            startSessionMonitor();
        } else {
            loginError.innerText = 'Invalid Session ID or Stream Key';
            loginError.classList.remove('hidden');
        }
    } catch (err) {
        loginError.innerText = 'Connection Error';
        loginError.classList.remove('hidden');
        console.error(err);
    } finally {
        btn.innerText = origText;
        btn.disabled = false;
    }
});

logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('dash_key');
    if (sessionMonitorInterval) clearInterval(sessionMonitorInterval);
    location.reload();
});

function startSessionMonitor() {
    if (sessionMonitorInterval) clearInterval(sessionMonitorInterval);
    
    // Track initial public state if available
    let lastIsPublic = currentMeta ? currentMeta.isPublic : true;

    sessionMonitorInterval = setInterval(async () => {
        try {
            const res = await fetch('/api/streamer/get-active-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ streamKey: streamKey })
            });
            
            if (res.ok) {
                const data = await res.json();
                const newId = data.sessionId;
                const newIsPublic = data.isPublic;
                
                // Check for Session ID Change OR Privacy Switch (to private)
                const idChanged = newId && newId !== sessionId;
                const wentPrivate = lastIsPublic === true && newIsPublic === false;
                
                if (idChanged || wentPrivate) {
                    console.log(`[Session Monitor] State Change. ID: ${sessionId}->${newId}, Public: ${lastIsPublic}->${newIsPublic}`);
                    
                    sessionId = newId;
                    localStorage.setItem('dash_session', sessionId);
                    dashSessionIdDisplay.textContent = `SESSION: ${sessionId}`;
                    lastIsPublic = newIsPublic;
                    
                    // Refresh settings
                    await fetchSettings();
                    renderSettings();
                    
                    // If now private, force show modal
                    if (!newIsPublic) {
                        showPrivateSessionModal(sessionId);
                    }
                }
                
                // Update tracker just in case
                lastIsPublic = newIsPublic;
            }
        } catch (e) {
            console.warn("[Session Monitor] Check failed:", e);
        }
    }, 2000);
}

// Make globally available for UI buttons
window.showPrivateSessionModal = showPrivateSessionModal;

function showPrivateSessionModal(newId) {
    // Check if modal already exists
    if (document.getElementById('private-session-modal')) return;

    const fullUrl = `${window.location.origin}/?session=${encodeURIComponent(newId)}`;

    const modal = document.createElement('div');
    modal.id = 'private-session-modal';
    modal.className = 'fixed inset-0 z-50 bg-black/90 flex items-center justify-center backdrop-blur-sm p-4';
    modal.innerHTML = `
        <div class="bg-rat-panel border border-rat-yellow rounded-lg p-8 w-full max-w-lg shadow-2xl">
            <div class="text-center mb-6">
                <i class="fa-solid fa-user-secret text-4xl text-rat-yellow mb-4"></i>
                <h2 class="font-mono text-2xl text-white">PRIVATE MODE ACTIVE</h2>
                <p class="text-rat-text-dim text-sm mt-2">Secure session generated.</p>
            </div>
            
            <div class="bg-rat-black border border-rat-border rounded p-4 mb-4">
                <label class="block text-xs font-mono text-rat-text-dim mb-2 uppercase">PRIVATE ACCESS LINK</label>
                <div class="flex gap-2">
                    <input type="text" readonly value="${fullUrl}" class="flex-1 bg-transparent text-rat-green font-mono text-sm outline-none select-all">
                    <button class="text-rat-yellow hover:text-white" onclick="navigator.clipboard.writeText('${fullUrl}')">
                        <i class="fa-solid fa-copy"></i>
                    </button>
                </div>
            </div>

            <div class="bg-rat-black border border-rat-border rounded p-4 mb-6">
                <label class="block text-xs font-mono text-rat-text-dim mb-2 uppercase">SESSION ID (FOR DASHBOARD)</label>
                <div class="flex gap-2">
                    <input type="text" readonly value="${newId}" class="flex-1 bg-transparent text-rat-text font-mono text-sm outline-none select-all">
                    <button class="text-rat-text-dim hover:text-white" onclick="navigator.clipboard.writeText('${newId}')">
                        <i class="fa-solid fa-copy"></i>
                    </button>
                </div>
            </div>

            <p class="text-xs text-rat-text-dim mb-6 text-center">
                Share the link with trusted viewers. Use the Session ID to log back in here.
            </p>

            <button onclick="document.getElementById('private-session-modal').remove()" class="w-full bg-rat-yellow text-black font-bold font-mono py-3 rounded hover:bg-white transition-colors uppercase">
                ACKNOWLEDGE
            </button>
        </div>
    `;
    document.body.appendChild(modal);
}

function copyPrivateLink() {
    const input = document.getElementById('private-url-input');
    // Don't copy if it's the placeholder text
    if (input && !input.value.startsWith("Generating")) {
        input.select();
        navigator.clipboard.writeText(input.value);
        // Visual feedback
        const btn = input.nextElementSibling;
        const originalText = btn.innerText;
        btn.innerText = 'COPIED';
        setTimeout(() => btn.innerText = originalText, 2000);
    }
}

// Expose functions to global scope
window.copyPrivateLink = copyPrivateLink;
window.approveRequest = approveRequest;
window.rejectRequest = rejectRequest;
window.showPrivateSessionModal = showPrivateSessionModal;

saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.innerText = 'SAVING...';
    saveStatus.innerText = '';
    
    readSettingsFromUI();

    try {
        const success = await saveSettings();
        if (success) {
            saveStatus.innerText = 'Changes Saved Successfully';
            saveStatus.className = 'text-center text-xs font-mono mt-2 text-rat-green';
        } else {
            throw new Error('Save failed');
        }
    } catch (err) {
        saveStatus.innerText = 'Error Saving Settings';
        saveStatus.className = 'text-center text-xs font-mono mt-2 text-rat-red';
        console.error(err);
    } finally {
        setTimeout(() => {
            saveBtn.disabled = false;
            saveBtn.innerText = 'SAVE CHANGES';
            setTimeout(() => saveStatus.innerText = '', 3000);
        }, 500);
    }
});

// Remove Password Button
const btnRemovePwd = document.getElementById('btn-remove-password');
if (btnRemovePwd) {
    btnRemovePwd.addEventListener('click', async () => {
        if (!confirm("Remove the interaction password? Viewers will be able to act freely.")) return;
        
        // Force clear locally
        currentMeta.interactionPassword = ""; 
        currentMeta.hasPassword = false; // Optimistic update

        // Save immediately
        saveBtn.innerText = 'REMOVING...';
        saveBtn.disabled = true;
        
        try {
            const success = await saveSettings();
            if (success) {
                saveStatus.innerText = 'Password Removed';
                saveStatus.className = 'text-center text-xs font-mono mt-2 text-rat-green';
                renderSettings(); // Refresh UI
            } else {
                throw new Error('Failed to remove');
            }
        } catch (err) {
            console.error(err);
            saveStatus.innerText = 'Error Removing Password';
            saveStatus.className = 'text-center text-xs font-mono mt-2 text-rat-red';
        } finally {
            setTimeout(() => {
                saveBtn.innerText = 'SAVE CHANGES';
                saveBtn.disabled = false;
                setTimeout(() => saveStatus.innerText = '', 3000);
            }, 1000);
        }
    });
}

// Navigation
navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        // Active State
        navBtns.forEach(b => {
            b.classList.remove('active', 'bg-rat-dark', 'text-rat-green', 'border-l-2', 'border-rat-green');
            b.classList.add('text-rat-text-dim', 'border-transparent');
        });
        btn.classList.add('active', 'bg-rat-dark', 'text-rat-green', 'border-l-2', 'border-rat-green');
        btn.classList.remove('text-rat-text-dim', 'border-transparent');

        // View Switching
        Object.values(views).forEach(v => v.classList.add('hidden'));
        const viewId = btn.dataset.view;
        views[viewId].classList.remove('hidden');
    });
});

// --- API FUNCTIONS ---

async function validateCredentials(sess, key) {
    const res = await fetch(`/api/settings/${encodeURIComponent(sess)}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamKey: key })
    });
    if (res.status === 404) throw new Error('Session not found');
    const data = await res.json();
    return data.valid;
}

async function fetchSettings() {
    const res = await fetch(`/api/settings/${encodeURIComponent(sessionId)}`);
    if (!res.ok) throw new Error('Failed to fetch settings');
    const data = await res.json();
    
    currentSettings = data.settings || {};
    currentEconomy = data.economy || {};
    currentMeta = data.meta || {};
    currentQueueSettings = data.queueSettings || {};
}

async function saveSettings() {
    const payload = {
        settings: currentSettings,
        economy: currentEconomy,
        meta: currentMeta,
        queueSettings: currentQueueSettings
    };

    const res = await fetch(`/api/settings/${encodeURIComponent(sessionId)}`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'x-stream-key': streamKey
        },
        body: JSON.stringify(payload)
    });

    return res.ok;
}

// CONTENT SETTINGS LOGIC (STREAMER)

async function openContentSettings(category) {
    const modal = document.getElementById('content-browser-modal');
    const title = document.getElementById('browser-title');
    const grid = document.getElementById('browser-grid');
    const filterSelect = document.getElementById('browser-filter');
    const searchInput = document.getElementById('browser-search');
    
    // Reset
    grid.innerHTML = '<p class="text-rat-text-dim font-mono col-span-full text-center py-10">Fetching configuration data...</p>';
    filterSelect.innerHTML = '<option value="all">ALL CATEGORIES</option>';
    searchInput.value = '';
    
    modal.classList.remove('hidden');

    if (!definitions) {
        try {
            const res = await fetch(`/api/definitions/${sessionId}`);
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

    let items = [];
    let filters = [];

    if (category === 'weather') {
        title.textContent = 'CONFIGURE WEATHER';
        items = (definitions.weather || []).map(w => ({
            id: `weather_${w.defName}`, // Prefix to match setting key style
            label: w.label,
            desc: w.description,
            category: 'Weather',
            defaultCost: 500
        }));
    } else if (category === 'events') {
        title.textContent = 'CONFIGURE EVENTS';
        items = (definitions.incidents || []).map(i => ({
            id: `event_${i.defName}`,
            label: i.label,
            desc: i.category,
            category: i.category,
            defaultCost: 1000
        }));
        filters = [...new Set(items.map(i => i.category))];
    } else if (category === 'animals') {
        title.textContent = 'CONFIGURE SPAWNER';
        items = (definitions.animals || []).map(a => ({
            id: `spawn_${a.defName}`,
            label: a.label,
            desc: a.race,
            category: a.race || 'Unknown',
            defaultCost: Math.max(100, Math.floor((a.combatPower || 10) * 2))
        }));
    }

    // Populate Filters
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

    renderSettingsItems(items, grid);

    // Search & Filter Handlers
    const updateView = () => {
        const query = searchInput.value.toLowerCase();
        const cat = filterSelect.value;
        const filtered = items.filter(i => 
            (cat === 'all' || i.category === cat) &&
            (i.label.toLowerCase().includes(query) || i.id.toLowerCase().includes(query))
        );
        renderSettingsItems(filtered, grid);
    };

    searchInput.oninput = updateView;
    filterSelect.onchange = updateView;
}

function renderSettingsItems(items, container) {
    document.getElementById('browser-count').textContent = `${items.length} ITEMS`;
    
    if (items.length === 0) {
        container.innerHTML = '<p class="text-rat-text-dim font-mono col-span-full text-center py-10">No items found.</p>';
        return;
    }

    container.innerHTML = items.map(item => {
        // Check current settings
        const isEnabled = currentSettings.actions ? currentSettings.actions[item.id] !== false : true;
        const cost = currentEconomy.actionCosts && currentEconomy.actionCosts[item.id] !== undefined 
            ? currentEconomy.actionCosts[item.id] 
            : item.defaultCost;

        return `
        <div class="bg-rat-black border border-rat-border rounded p-4 hover:border-rat-green transition-colors">
            <div class="flex justify-between items-start mb-3">
                <div class="overflow-hidden mr-2">
                    <h3 class="font-mono text-rat-green text-sm truncate" title="${item.label}">${item.label}</h3>
                    <p class="text-[10px] text-rat-text-dim font-mono truncate">${item.desc || item.id}</p>
                </div>
                <label class="relative inline-flex items-center cursor-pointer shrink-0">
                    <input type="checkbox" class="sr-only peer action-toggle" data-action="${item.id}" ${isEnabled ? 'checked' : ''}>
                    <div class="w-9 h-5 bg-rat-dark peer-focus:outline-none border border-rat-border rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-rat-green"></div>
                </label>
            </div>
            <div class="flex items-center gap-2 pt-2 border-t border-rat-border">
                <span class="text-[10px] text-rat-text-dim font-mono uppercase">COST:</span>
                <input type="number" class="price-input bg-rat-dark border border-rat-border rounded px-2 py-1 text-right text-rat-yellow font-mono text-xs flex-1 min-w-0 focus:border-rat-green outline-none" 
                    min="0" step="10" value="${cost}" data-action="${item.id}">
                <span class="text-[10px] text-rat-text-dim">c</span>
            </div>
        </div>
    `}).join('');
}

// Expose global
window.openContentSettings = openContentSettings;

// CONTENT BROWSER LOGIC

let definitions = null;

async function openContentBrowser(category) {
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

    // Fetch definitions if not cached
    if (!definitions) {
        try {
            const res = await fetch(`/api/definitions/${sessionId}`);
            if (res.ok) {
                definitions = await res.json();
            } else {
                throw new Error('API Error');
            }
        } catch (e) {
            grid.innerHTML = '<p class="text-rat-red font-mono col-span-full text-center py-10">Failed to load game data. Ensure game is running.</p>';
            return;
        }
    }

    // Render logic based on category
    let items = [];
    let filters = [];

    if (category === 'weather') {
        title.textContent = 'WEATHER CONTROL';
        // Map API data to render format
        items = (definitions.weather || []).map(w => ({
            id: w.defName,
            label: w.label,
            desc: w.description,
            type: 'weather',
            cost: 500 // Default cost
        }));
    } else if (category === 'events') {
        title.textContent = 'EVENT DIRECTOR';
        items = (definitions.incidents || []).map(i => ({
            id: i.defName,
            label: i.label,
            desc: i.category, // Show category as description
            type: 'event',
            category: i.category,
            cost: 1000 // Default
        }));
        
        // Populate filters
        filters = [...new Set(items.map(i => i.category))];
    } else if (category === 'animals') {
        title.textContent = 'ANIMAL SPAWNER';
        items = (definitions.animals || []).map(a => ({
            id: a.defName,
            label: a.label,
            desc: a.race,
            type: 'animal',
            cost: Math.max(100, Math.floor((a.combatPower || 10) * 2)) // Dynamic pricing
        }));
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
        searchInput.dispatchEvent(new Event('input')); // Trigger search to re-filter
    };
}

function renderBrowserItems(items, container) {
    document.getElementById('browser-count').textContent = `${items.length} ITEMS FOUND`;
    
    if (items.length === 0) {
        container.innerHTML = '<p class="text-rat-text-dim font-mono col-span-full text-center py-10">No matching definitions found.</p>';
        return;
    }

    container.innerHTML = items.map(item => `
        <div class="bg-rat-panel border border-rat-border rounded p-4 hover:border-rat-green transition-colors group relative cursor-pointer" onclick="selectBrowserItem('${item.id}', '${item.type}', ${item.cost}, '${item.label.replace(/'/g, "\\'")}')">
            <h3 class="font-mono text-rat-green text-lg truncate group-hover:text-white">${item.label}</h3>
            <p class="text-xs text-rat-text-dim font-mono truncate mb-2">${item.desc || item.id}</p>
            <div class="flex justify-between items-center mt-2 border-t border-rat-border pt-2">
                <span class="text-xs text-rat-yellow font-mono font-bold">${item.cost}c</span>
                <span class="text-[10px] text-rat-text-dim font-mono uppercase bg-rat-dark px-2 rounded border border-rat-border">${item.type}</span>
            </div>
        </div>
    `).join('');
}

function closeContentBrowser() {
    document.getElementById('content-browser-modal').classList.add('hidden');
}

// Handle selection (For now, just log or add to queue as a test)
async function selectBrowserItem(id, type, cost, label) {
    if(!confirm(`Trigger "${label}" for ${cost} coins?`)) return;

    // Construct payload based on type
    let action = '';
    let data = '';

    if (type === 'weather') {
        action = 'change_weather_dynamic'; // Need to support this in backend/mod
        data = id;
    } else if (type === 'event') {
        action = 'trigger_incident_dynamic';
        data = id;
    } else if (type === 'animal') {
        action = 'spawn_pawn_dynamic';
        data = id;
    }

    // Since we don't have dynamic endpoints fully wired in Mod C# yet, 
    // we can't execute this. But this proves the UI works.
    console.log(`[Browser] Selected: ${action} -> ${data}`);
    alert(`Command sent: ${action} (${data})`);
    closeContentBrowser();
}

// Expose global
window.openContentBrowser = openContentBrowser;
window.closeContentBrowser = closeContentBrowser;
window.selectBrowserItem = selectBrowserItem;

// --- RENDER & LOGIC ---

function renderSettings() {
    // 1. Meta
    setCheck('setting-isPublic', currentMeta.isPublic);
    
    // Private Link Panel Logic
    const privacyPanel = document.getElementById('private-link-panel');
    const privacyInput = document.getElementById('private-url-input');
    const copyBtn = privacyPanel ? privacyPanel.querySelector('button') : null;

    if (currentMeta.isPublic) {
        if (privacyPanel) privacyPanel.classList.add('hidden');
    } else {
        if (privacyPanel) {
            privacyPanel.classList.remove('hidden');
            
            // Safety Check: Ensure we are displaying a Secure ID not a legacy/public Seed
            // Lowered threshold to 10 to accommodate varying ID lengths while filtering short seeds.
            if (sessionId && sessionId.length >= 10 && sessionId !== 'default-session') {
                const fullUrl = `${window.location.origin}/?session=${encodeURIComponent(sessionId)}`;
                if (privacyInput) {
                    privacyInput.value = fullUrl;
                    privacyInput.classList.remove('text-rat-text-dim', 'italic');
                    privacyInput.classList.add('text-rat-text');
                }
                if (copyBtn) {
                    copyBtn.disabled = false;
                    copyBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                }
            } else {
                if (privacyInput) {
                    privacyInput.value = "Generating Secure ID... Please Wait";
                    privacyInput.classList.add('text-rat-text-dim', 'italic');
                    privacyInput.classList.remove('text-rat-text');
                }
                if (copyBtn) {
                    copyBtn.disabled = true;
                    copyBtn.classList.add('opacity-50', 'cursor-not-allowed');
                }
            }
        }
    }

    // Add warning if not already present (Keep existing warning logic, but maybe move it or adjust it?)
    // The previous warning was "Changing privacy mode may reset your Session ID...". That's still valid.
    const publicToggleContainer = document.getElementById('setting-isPublic').closest('.flex').parentElement;
    if (!document.getElementById('privacy-warning')) {
        const warning = document.createElement('p');
        warning.id = 'privacy-warning';
        warning.className = 'text-xs text-rat-red mt-2 font-mono italic';
        warning.textContent = "Note: Changing privacy mode may reset your Session ID in-game.";
        publicToggleContainer.appendChild(warning);
    }

    setVal('setting-interactionPassword', currentMeta.hasPassword ? '******' : ''); 
    document.getElementById('setting-interactionPassword').value = ''; 
    document.getElementById('setting-interactionPassword').placeholder = 'Type to set new password...';

    // Update Password Status Badge & Remove Button
    const pwdBadge = document.getElementById('password-status-badge');
    const btnRemovePwd = document.getElementById('btn-remove-password');
    
    if (pwdBadge) {
        if (currentMeta.hasPassword) {
            pwdBadge.textContent = "ACTIVE";
            pwdBadge.className = "px-2 py-0.5 rounded text-[10px] font-mono bg-rat-green/10 border border-rat-green text-rat-green";
            if (btnRemovePwd) btnRemovePwd.classList.remove('hidden');
        } else {
            pwdBadge.textContent = "NONE";
            pwdBadge.className = "px-2 py-0.5 rounded text-[10px] font-mono bg-rat-dark border border-rat-border text-rat-text-dim";
            if (btnRemovePwd) btnRemovePwd.classList.add('hidden');
        }
    }

    // 2. General Settings
    setCheck('setting-enableLiveScreen', currentSettings.enableLiveScreen);
    setVal('setting-maxActionsPerMinute', currentSettings.maxActionsPerMinute);
    document.getElementById('display-maxActionsPerMinute').textContent = currentSettings.maxActionsPerMinute;

    // 3. Economy
    setVal('setting-coinRate', currentEconomy.coinRate);

    // 4. Actions (Dynamic Rendering)
    renderActionToggles();

    // 5. Prices (Dynamic Rendering)
    renderPrices();
    
    // 6. Queue Settings
    const voteDur = currentQueueSettings.voteDuration !== undefined ? currentQueueSettings.voteDuration : 600;
    setVal('setting-voteDuration', Math.floor(voteDur / 60)); 
    setCheck('setting-autoExecute', currentQueueSettings.autoExecute);
    
    // Listeners for specific UI inputs
    const maxActSlider = document.getElementById('setting-maxActionsPerMinute');
    maxActSlider.addEventListener('input', (e) => {
        document.getElementById('display-maxActionsPerMinute').textContent = e.target.value;
    });
}

function renderActionToggles() {
    const container = document.getElementById('view-actions');
    container.innerHTML = '';

    const dlcKeyMap = {
        'DLC: Royalty': 'royalty',
        'DLC: Ideology': 'ideology',
        'DLC: Biotech': 'biotech',
        'DLC: Anomaly': 'anomaly',
        'DLC: Odyssey': 'odyssey'
    };

    for (const [category, actions] of Object.entries(actionCategories)) {
        const section = document.createElement('section');
        section.className = 'bg-rat-panel border border-rat-border rounded-lg p-6 mb-4';
        
        // DLC Check
        let isDlcMissing = false;
        if (category.startsWith('DLC:') && currentMeta.activeDlcs) {
            const key = dlcKeyMap[category];
            if (key && currentMeta.activeDlcs[key] === false) {
                isDlcMissing = true;
                section.classList.add('opacity-50', 'grayscale', 'pointer-events-none');
            }
        }

        const headerContainer = document.createElement('div');
        headerContainer.className = 'flex justify-between items-center mb-4 border-b border-rat-border pb-2';

        const headerLeft = document.createElement('div');
        headerLeft.className = 'flex items-center gap-4';

        const headerTitle = document.createElement('h2');
        headerTitle.className = 'font-mono text-xl text-rat-yellow uppercase';
        headerTitle.textContent = category;
        if (isDlcMissing) {
            headerTitle.style.textDecoration = 'line-through';
            headerTitle.innerHTML += ' <span class="text-rat-red text-sm ml-2">(NOT INSTALLED)</span>';
        }

        // Add chevron for accordion
        const chevron = document.createElement('i');
        chevron.className = 'fa-solid fa-chevron-down text-rat-text-dim transition-transform duration-300 ml-2';
        headerLeft.appendChild(chevron);

        headerLeft.appendChild(headerTitle);

        // Master Toggle
        const masterToggleContainer = document.createElement('div');
        masterToggleContainer.className = 'flex items-center gap-2';
        // Stop propagation to prevent accordion toggle when clicking master switch
        masterToggleContainer.onclick = (e) => e.stopPropagation();
        
        masterToggleContainer.innerHTML = `
            <span class="text-xs text-rat-text-dim font-mono">ENABLE CATEGORY</span>
            <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" class="sr-only peer master-toggle" data-category="${category}" ${isDlcMissing ? 'disabled' : ''}>
                <div class="w-9 h-5 bg-rat-dark peer-focus:outline-none border border-rat-border rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-rat-green"></div>
            </label>
        `;
        
        // Determine initial state of master toggle
        const anyEnabled = actions.some(key => currentSettings.actions ? currentSettings.actions[key] !== false : true);
        masterToggleContainer.querySelector('input').checked = anyEnabled;

        // Event Listener for Master Toggle
        masterToggleContainer.querySelector('input').addEventListener('change', (e) => {
            e.stopPropagation(); // Prevent accordion toggle
            const isChecked = e.target.checked;
            const subToggles = section.querySelectorAll('.action-toggle');
            subToggles.forEach(toggle => {
                toggle.checked = isChecked;
            });
        });

        headerContainer.appendChild(headerLeft);
        headerContainer.appendChild(masterToggleContainer);
        section.appendChild(headerContainer);

        const grid = document.createElement('div');
        grid.className = 'grid grid-cols-1 md:grid-cols-2 gap-4 overflow-hidden transition-all duration-300 max-h-0 opacity-0'; // Default Collapsed
        
        // Accordion Toggle Logic
        headerContainer.style.cursor = 'pointer';
        headerContainer.addEventListener('click', () => {
            if (grid.style.maxHeight) {
                // Collapse
                grid.style.maxHeight = null;
                grid.style.opacity = '0';
                grid.classList.remove('mt-4');
                chevron.classList.remove('rotate-180');
            } else {
                // Expand
                grid.style.maxHeight = grid.scrollHeight + "px";
                grid.style.opacity = '1';
                grid.classList.add('mt-4');
                chevron.classList.add('rotate-180');
            }
        });

        actions.forEach(actionKey => {
            // Check if enabled in settings.actions
            const isEnabled = currentSettings.actions ? currentSettings.actions[actionKey] !== false : true;

            const div = document.createElement('div');
            div.className = 'flex items-center justify-between bg-rat-black p-3 rounded border border-rat-border hover:border-rat-border/80';
            div.innerHTML = `
                <span class="text-sm text-rat-text font-mono">${prettyNames[actionKey] || actionKey}</span>
                <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" class="sr-only peer action-toggle" data-action="${actionKey}" ${isEnabled ? 'checked' : ''} ${isDlcMissing ? 'disabled' : ''}>
                    <div class="w-9 h-5 bg-rat-dark peer-focus:outline-none border border-rat-border rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-rat-green"></div>
                </label>
            `;
            grid.appendChild(div);
        });

        section.appendChild(grid);
        container.appendChild(section);
    }
}

function renderPrices() {
    const container = document.getElementById('economy-prices-grid');
    container.innerHTML = '';
    // We will use the container as a wrapper for sections, so clear class that made it a grid
    container.className = 'space-y-4'; 

    const costs = currentEconomy.actionCosts || {};
    const dlcKeyMap = {
        'DLC: Royalty': 'royalty',
        'DLC: Ideology': 'ideology',
        'DLC: Biotech': 'biotech',
        'DLC: Anomaly': 'anomaly',
        'DLC: Odyssey': 'odyssey'
    };

    for (const [category, actions] of Object.entries(actionCategories)) {
        const section = document.createElement('section');
        section.className = 'bg-rat-black border border-rat-border rounded p-4';

        // DLC Check
        let isDlcMissing = false;
        if (category.startsWith('DLC:') && currentMeta.activeDlcs) {
            const key = dlcKeyMap[category];
            if (key && currentMeta.activeDlcs[key] === false) {
                isDlcMissing = true;
                section.classList.add('opacity-50', 'grayscale', 'pointer-events-none');
            }
        }

        // Header
        const headerContainer = document.createElement('div');
        headerContainer.className = 'flex justify-between items-center cursor-pointer select-none pb-2 border-b border-rat-border';
        
        const headerLeft = document.createElement('div');
        headerLeft.className = 'flex items-center gap-2';
        
        const chevron = document.createElement('i');
        chevron.className = 'fa-solid fa-chevron-down text-rat-text-dim transition-transform duration-300 text-xs';
        headerLeft.appendChild(chevron);

        const headerTitle = document.createElement('h3');
        headerTitle.className = 'font-mono text-sm text-rat-yellow uppercase';
        headerTitle.textContent = category;
        if (isDlcMissing) headerTitle.innerHTML += ' <span class="text-rat-red text-[10px] ml-1">(MISSING)</span>';
        headerLeft.appendChild(headerTitle);

        headerContainer.appendChild(headerLeft);
        section.appendChild(headerContainer);

        // Grid Content
        const grid = document.createElement('div');
        grid.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 overflow-hidden transition-all duration-300 max-h-0 opacity-0'; // Default Collapsed

        // Accordion Toggle Logic
        headerContainer.addEventListener('click', () => {
            if (grid.style.maxHeight) {
                grid.style.maxHeight = null;
                grid.style.opacity = '0';
                grid.classList.remove('mt-4');
                chevron.classList.remove('rotate-180');
            } else {
                grid.style.maxHeight = grid.scrollHeight + "px";
                grid.style.opacity = '1';
                grid.classList.add('mt-4');
                chevron.classList.add('rotate-180');
            }
        });

        actions.forEach(actionKey => {
            // Convert snake_case to camelCase for cost lookup
            const camelKey = actionKey.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
            const cost = costs[camelKey] !== undefined ? costs[camelKey] : (costs[actionKey] || 0);

            const div = document.createElement('div');
            div.className = 'bg-rat-dark border border-rat-border rounded p-2 flex items-center justify-between';
            div.innerHTML = `
                <span class="text-[10px] text-rat-text-dim font-mono truncate mr-2 flex-1" title="${prettyNames[actionKey]}">${prettyNames[actionKey]}</span>
                <div class="flex items-center gap-1">
                    <input type="number" class="price-input bg-rat-black border border-rat-border rounded px-1 py-0.5 text-right text-rat-yellow font-mono text-xs w-16 focus:border-rat-green outline-none" 
                        min="0" step="10" value="${cost}" data-action="${camelKey}" ${isDlcMissing ? 'disabled' : ''}>
                    <span class="text-[10px] text-rat-text-dim">c</span>
                </div>
            `;
            grid.appendChild(div);
        });

        section.appendChild(grid);
        container.appendChild(section);
    }
}

function readSettingsFromUI() {
    // 1. Meta
    currentMeta.isPublic = getCheck('setting-isPublic');
    const passVal = getVal('setting-interactionPassword');
    if (passVal) currentMeta.interactionPassword = passVal;

    // 2. General
    currentSettings.enableLiveScreen = getCheck('setting-enableLiveScreen');
    currentSettings.maxActionsPerMinute = parseInt(getVal('setting-maxActionsPerMinute'));

    // 3. Economy
    currentEconomy.coinRate = parseInt(getVal('setting-coinRate'));

    // 4. Actions
    if (!currentSettings.actions) currentSettings.actions = {};
    document.querySelectorAll('.action-toggle').forEach(toggle => {
        currentSettings.actions[toggle.dataset.action] = toggle.checked;
    });

    // 5. Prices
    if (!currentEconomy.actionCosts) currentEconomy.actionCosts = {};
    document.querySelectorAll('.price-input').forEach(input => {
        // Use the camelCase key stored in data-action
        currentEconomy.actionCosts[input.dataset.action] = parseInt(input.value) || 0;
    });

    // 6. Queue
    if (!currentQueueSettings) currentQueueSettings = {};
    currentQueueSettings.voteDuration = (parseInt(getVal('setting-voteDuration')) || 10) * 60;
    currentQueueSettings.autoExecute = getCheck('setting-autoExecute');
}

// Helpers
function getVal(id) { return document.getElementById(id).value; }
function setVal(id, val) { 
    const el = document.getElementById(id);
    if (el) el.value = val !== undefined ? val : ''; 
}
function getCheck(id) { return document.getElementById(id).checked; }
function setCheck(id, val) { 
    const el = document.getElementById(id);
    if (el) el.checked = !!val; 
}

// --- QUEUE MANAGEMENT ---

let queuePollInterval = null;

// Hook into navigation to start/stop polling
navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.dataset.view === 'view-queue') {
            startQueuePolling();
        } else {
            stopQueuePolling();
        }
    });
});

function startQueuePolling() {
    fetchQueue();
    if (!queuePollInterval) {
        queuePollInterval = setInterval(fetchQueue, 3000);
    }
}

function stopQueuePolling() {
    if (queuePollInterval) {
        clearInterval(queuePollInterval);
        queuePollInterval = null;
    }
}

async function fetchQueue() {
    try {
        const res = await fetch(`/api/queue/${encodeURIComponent(sessionId)}`);
        const data = await res.json();
        if (data.queue) {
            renderQueue(data.queue);
        }
    } catch (e) {
        console.error('Queue fetch error:', e);
    }
}

function renderQueue(queue) {
    const container = document.getElementById('dash-queue-list');
    const requests = queue.requests || [];

    if (requests.length === 0) {
        container.innerHTML = '<p class="text-center text-rat-text-dim font-mono py-10">Queue Empty</p>';
        return;
    }

    // Calculate net votes for each request
    requests.forEach(req => {
        req.upvotes = req.votes.filter(v => v.type === 'upvote').length;
        req.downvotes = req.votes.filter(v => v.type === 'downvote').length;
        req.netVotes = req.upvotes - req.downvotes;
    });

    // Sort by net votes (desc)
    requests.sort((a, b) => b.netVotes - a.netVotes);

    container.innerHTML = requests.map(req => {
        let label, subtext, approveLabel;
        
        if (req.type === 'suggestion') {
             label = req.data;
             subtext = 'IDEA';
             approveLabel = 'MARK DONE';
        } else {
             const snakeKey = req.action.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
             label = prettyNames[snakeKey] || prettyNames[req.action] || req.action;
             subtext = `${req.cost}c`;
             approveLabel = 'EXECUTE';
        }

        return `
        <div class="bg-rat-panel border border-rat-border rounded-lg p-4 flex justify-between items-center">
            <div class="flex-1 min-w-0 mr-4">
                <div class="flex flex-col gap-1 mb-1">
                    <span class="font-mono text-lg text-white break-words leading-tight">${label}</span>
                    <span class="text-xs bg-rat-dark border border-rat-border px-2 py-0.5 rounded text-rat-text-dim w-fit">${subtext}</span>
                </div>
                <div class="text-xs text-rat-text-dim font-mono">
                    BY: <span class="text-rat-green">${req.submittedBy}</span> • ${req.netVotes} NET VOTES
                </div>
            </div>
            <div class="flex items-center gap-2">
                <button class="px-3 py-1 bg-rat-green text-black font-bold rounded hover:bg-white transition-colors text-xs whitespace-nowrap" onclick="approveRequest('${req.id}')">
                    ${approveLabel}
                </button>
                <button class="px-3 py-1 bg-rat-red/20 text-rat-red border border-rat-red/50 rounded hover:bg-rat-red hover:text-black transition-colors text-xs" onclick="rejectRequest('${req.id}')">
                    DELETE
                </button>
            </div>
        </div>
    `}).join('');
}

async function approveRequest(requestId) {
    try {
        await fetch(`/api/queue/${encodeURIComponent(sessionId)}/approve/${requestId}`, {
            method: 'POST',
            headers: { 'x-stream-key': streamKey }
        });
        fetchQueue(); // Refresh immediately
    } catch (e) {
        console.error('Approve error:', e);
    }
}

async function rejectRequest(requestId) {
    if (!confirm('Reject this request? Coins will be refunded.')) return;
    
    try {
        await fetch(`/api/queue/${encodeURIComponent(sessionId)}/reject/${requestId}`, {
            method: 'POST',
            headers: { 'x-stream-key': streamKey }
        });
        fetchQueue();
    } catch (e) {
        console.error('Reject error:', e);
    }
}

// Expose functions to global scope for onclick handlers
window.approveRequest = approveRequest;
window.rejectRequest = rejectRequest;
