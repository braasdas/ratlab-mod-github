import { STATE } from './state.js';
import { showColonistSnapshot } from './colonists.js';

let mapState = {
    scale: 1,
    panning: false,
    pointX: 0,
    pointY: 0,
    start: { x: 0, y: 0 },
    x: 0,
    y: 0
};

export function initializeMapControls() {
    const mapContent = document.getElementById('map-content');
    const zoomInBtn = document.getElementById('map-zoom-in');
    const zoomOutBtn = document.getElementById('map-zoom-out');
    const resetBtn = document.getElementById('map-reset');

    if (!mapContent) return;

    // Mouse Wheel Zoom
    mapContent.addEventListener('wheel', (e) => {
        e.preventDefault();
        const xs = (e.clientX - mapState.x) / mapState.scale;
        const ys = (e.clientY - mapState.y) / mapState.scale;
        
        const delta = -Math.sign(e.deltaY);
        const nextScale = mapState.scale + (delta * 0.1 * mapState.scale);
        
        // Limit zoom
        if (nextScale > 0.1 && nextScale < 5) {
            mapState.scale = nextScale;
            mapState.x = e.clientX - xs * mapState.scale;
            mapState.y = e.clientY - ys * mapState.scale;
            updateTransform();
        }
    });

    // Panning
    mapContent.addEventListener('mousedown', (e) => {
        if (e.target.closest('.map-marker')) return; // Don't drag if clicking a marker
        e.preventDefault();
        mapState.start = { x: e.clientX - mapState.x, y: e.clientY - mapState.y };
        mapState.panning = true;
        mapContent.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
        if (!mapState.panning) return;
        e.preventDefault();
        mapState.x = e.clientX - mapState.start.x;
        mapState.y = e.clientY - mapState.start.y;
        updateTransform();
    });

    window.addEventListener('mouseup', () => {
        mapState.panning = false;
        if (mapContent) mapContent.style.cursor = 'move';
    });

    // Buttons
    if (zoomInBtn) {
        zoomInBtn.onclick = () => {
            mapState.scale *= 1.2;
            updateTransform();
        };
    }

    if (zoomOutBtn) {
        zoomOutBtn.onclick = () => {
            mapState.scale /= 1.2;
            updateTransform();
        };
    }

    if (resetBtn) {
        resetBtn.onclick = () => {
            mapState.scale = 1;
            mapState.x = 0;
            mapState.y = 0;
            updateTransform();
        };
    }
}

function updateTransform() {
    const mapContent = document.getElementById('map-content');
    if (mapContent) {
        mapContent.style.transform = `translate(${mapState.x}px, ${mapState.y}px) scale(${mapState.scale})`;
    }
}

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
            mapImg.onload = () => adjustOverlayDimensions(mapImg);
            mapImg.src = URL.createObjectURL(blob);
            
            if (mapLoading) mapLoading.classList.add('hidden');
        }
    }
}

function adjustOverlayDimensions(img) {
    const container = img.parentElement; // #map-content
    // We need to reference the viewport (parent of #map-content) to calculate fit, 
    // because #map-content itself is being transformed.
    const viewport = container.parentElement; 
    const overlay = document.getElementById('map-overlays');
    if (!container || !overlay || !viewport) return;

    const imgRatio = img.naturalWidth / img.naturalHeight;
    const viewportRatio = viewport.clientWidth / viewport.clientHeight;

    let width, height, top, left;

    if (viewportRatio > imgRatio) {
        // Viewport is wider (pillarbox if we were fitting to viewport)
        height = viewport.clientHeight;
        width = height * imgRatio;
        top = 0;
        left = (viewport.clientWidth - width) / 2;
    } else {
        // Viewport is taller (letterbox)
        width = viewport.clientWidth;
        height = width / imgRatio;
        left = 0;
        top = (viewport.clientHeight - height) / 2;
    }

    // Set the base dimensions for the overlay.
    // Since #map-overlays is absolute inside #map-content, and #map-content is transformed,
    // we need to set these dimensions such that they match the image *before* transform.
    // But wait, the image is 'w-full h-full object-contain' inside #map-content.
    // If #map-content is scaled, the image scales.
    // If we set overlay width/height to specific pixels, they will scale too.
    
    // The previous logic relied on #map-content matching the viewport exactly.
    // Now #map-content size is still 100% of viewport (CSS), but transformed.
    // So 'viewport.clientHeight' is still the reference for the 'contain' logic of the image.
    
    overlay.style.width = `${width}px`;
    overlay.style.height = `${height}px`;
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
}

// Add resize listener
window.addEventListener('resize', () => {
    const mapImg = document.getElementById('tactical-map-image');
    if (mapImg && mapImg.src && !mapImg.src.endsWith('undefined')) adjustOverlayDimensions(mapImg);
});

export function updateMapOverlays(gameState) {
    const colonists = gameState.colonists || [];
    const animals = gameState.animals || [];
    const overlaysContainer = document.getElementById('map-overlays');
    if (!overlaysContainer) return;

    // Update map size if available
    if (gameState.map_size) {
        STATE.mapSize = gameState.map_size;
    }

    // Full redraw
    overlaysContainer.innerHTML = '';

    const renderMarker = (pawn, isAnimal) => {
        const pos = pawn.position;
        if (!pos) return;

        // Normalize coordinates (RimWorld Bottom-Left -> CSS Top-Left)
        const leftPct = (pos.x / STATE.mapSize.x) * 100;
        const topPct = ((STATE.mapSize.z - pos.z) / STATE.mapSize.z) * 100;

        const marker = document.createElement('div');
        marker.className = 'absolute border border-black rounded-full overflow-hidden shadow-sm cursor-pointer transition-transform z-10';
        
        // Size: Animals slightly smaller
        if (isAnimal) {
            marker.classList.add('w-4', 'h-4', '-ml-2', '-mt-2'); 
        } else {
            marker.classList.add('w-6', 'h-6', '-ml-3', '-mt-3');
        }

        marker.style.left = `${leftPct}%`;
        marker.style.top = `${topPct}%`;
        marker.style.transform = 'scale(var(--marker-scale, 1))';
        marker.title = pawn.name || pawn.label;

        marker.onmouseenter = () => marker.style.transform = 'scale(calc(var(--marker-scale, 1) * 1.5))';
        marker.onmouseleave = () => marker.style.transform = 'scale(var(--marker-scale, 1))';

        if (pawn.drafted) {
            marker.classList.add('ring-2', 'ring-rat-red');
        } else if (isAnimal) {
             marker.classList.add('ring-1', 'ring-rat-yellow'); // Animals yellow ring
        } else {
            marker.classList.add('ring-1', 'ring-white');
        }

        const pawnId = String(pawn.id);
        const portrait = STATE.colonistPortraits[pawnId]; // Animals likely won't have portraits yet
        
        if (portrait) {
            marker.innerHTML = `<img src="data:image/png;base64,${portrait}" class="w-full h-full object-cover">`;
        } else {
            marker.className += ' bg-rat-dark flex items-center justify-center text-[8px] font-mono text-white';
            const label = pawn.name || pawn.label || '?';
            marker.textContent = label.substring(0,2).toUpperCase();
        }

        marker.onclick = (e) => {
            e.stopPropagation();
            // Reuse snapshot for animals too? It handles missing data well.
            showColonistSnapshot(pawn, pawnId);
        };

        overlaysContainer.appendChild(marker);
    };

    colonists.forEach(c => renderMarker(c, false));
    animals.forEach(a => renderMarker(a, true));
}
