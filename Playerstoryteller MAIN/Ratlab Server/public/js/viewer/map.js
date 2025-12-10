import { STATE } from './state.js';
import { showColonistSnapshot } from './colonists.js';

export function handleMapImageUpdate(data) {
    if (STATE.currentSession && data.sessionId === STATE.currentSession && data.image) {
        const mapImg = document.getElementById('tactical-map-image');
        const mapLoading = document.getElementById('map-loading');
        
        if (mapImg) {
            if (mapImg.src.startsWith('blob:')) {
                URL.revokeObjectURL(mapImg.src);
            }
            
            // Create Blob from buffer
            const blob = new Blob([data.image], { type: 'image/jpeg' });
            mapImg.src = URL.createObjectURL(blob);
            
            if (mapLoading) mapLoading.classList.add('hidden');
        }
    }
}

export function updateMapOverlays(gameState) {
    const colonists = gameState.colonists || [];
    const overlaysContainer = document.getElementById('map-overlays');
    if (!overlaysContainer) return;

    // Update map size if available
    if (gameState.map_size) {
        STATE.mapSize = gameState.map_size;
    }

    // Full redraw
    overlaysContainer.innerHTML = '';

    colonists.forEach((c, index) => {
        const data = c.colonist || c;
        const pos = data.position;
        if (!pos) return;

        // Normalize coordinates (RimWorld Bottom-Left -> CSS Top-Left)
        const leftPct = (pos.x / STATE.mapSize.x) * 100;
        const topPct = ((STATE.mapSize.z - pos.z) / STATE.mapSize.z) * 100;

        const marker = document.createElement('div');
        marker.className = 'absolute w-6 h-6 -ml-3 -mt-3 border border-black rounded-full overflow-hidden shadow-sm cursor-pointer transition-transform z-10';
        marker.style.left = `${leftPct}%`;
        marker.style.top = `${topPct}%`;
        marker.style.transform = 'scale(var(--marker-scale, 1))';
        marker.title = data.name;
        
        marker.onmouseenter = () => marker.style.transform = 'scale(calc(var(--marker-scale, 1) * 1.5))';
        marker.onmouseleave = () => marker.style.transform = 'scale(var(--marker-scale, 1))';
        
        if (data.drafted) {
            marker.classList.add('ring-2', 'ring-rat-red');
        } else {
            marker.classList.add('ring-1', 'ring-white');
        }

        const pawnId = String(data.id || data.pawn_id || index);
        const portrait = STATE.colonistPortraits[pawnId];
        
        if (portrait) {
            marker.innerHTML = `<img src="data:image/png;base64,${portrait}" class="w-full h-full object-cover">`;
        } else {
            marker.className += ' bg-rat-dark flex items-center justify-center text-[8px] font-mono text-white';
            marker.textContent = (data.name || '?').substring(0,2).toUpperCase();
        }

        marker.onclick = (e) => {
            e.stopPropagation();
            showColonistSnapshot(c, pawnId);
        };

        overlaysContainer.appendChild(marker);
    });
}
