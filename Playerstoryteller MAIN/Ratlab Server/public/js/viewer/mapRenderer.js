import { TextureManager } from './textureManager.js';
import { TerrainGrid } from './terrainGrid.js';
import { STATE } from './state.js';

/**
 * MapRenderer paints a pawn-centric tactical view for adopters.
 * It draws a small viewport around the pawn (default 31x31 tiles)
 * and translates clicks back into world coordinates.
 */
export class MapRenderer {
    constructor(container, { onOrder } = {}) {
        this.container = container;
        this.onOrder = onOrder;

        this.textureManager = new TextureManager();
        this.terrainGrid = new TerrainGrid();
        this.paletteImages = new Map();
        this.pawnPortraits = new Map(); // Cache for pawn portrait images
        this.thingImages = new Map(); // Cache for thing/item/building images
        this.missingTextures = new Set();
        this.failedTextures = new Set(); // Textures that failed to load (404, etc.) - never retry
        this.loadingTextures = new Set(); // Textures currently being fetched - prevent duplicates
        this.sessionId = null;
        this.things = []; // Array of things on the map (Render List)
        this.thingsMap = new Map(); // Persistent storage (ID -> Thing)
        this.tintCache = new Map(); // Cache for tinted textures

        // DOT TRACKING SYSTEM: Track each visual dot independently
        this.trackedDots = new Map(); // visualDotId → {pawnId, x, z, portraitData, lastUpdate}
        this.pawnIdToDotId = new Map(); // pawnId → visualDotId (for fast lookup)
        this.nextDotId = 0;

        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.overlay = document.createElement('div');

        // Viewport dimensions (calculated dynamically in _resize)
        this.tilesX = 30;
        this.tilesY = 20;
        this.tileSizePx = 32;
        this.camera = { x: 0, z: 0 };
        this.isFollowing = true; // Auto-follow pawn by default
        this.hoverTile = null;
        this.pawnPositions = new Map(); // Track interpolated pawn positions
        this.animating = false;

        this.ready = false;
        this.loading = false;
        this.error = null;

        this._bindEvents();
        this._mount();
    }

    _mount() {
        if (!this.container) return;
        this.container.innerHTML = '';
        this.container.classList.add('relative');

        this.canvas.className = 'w-full h-full block bg-black';
        this.overlay.className = 'absolute inset-0 pointer-events-none';

        this.container.appendChild(this.canvas);
        this.container.appendChild(this.overlay);

        this._resize();
        // Store handler reference so we can remove it in destroy()
        this._resizeHandler = () => this._resize();
        window.addEventListener('resize', this._resizeHandler);
    }

    _bindEvents() {
        // Mouse Down (Start Drag)
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // Only left click
            this.isDragging = false;
            this.dragStart = { x: e.clientX, y: e.clientY };
            this.cameraStart = { ...this.camera };
        });

        // Mouse Move (Pan & Hover)
        this.canvas.addEventListener('mousemove', (e) => {
            // Drag Logic
            if (e.buttons === 1 && this.dragStart) {
                const dx = e.clientX - this.dragStart.x;
                const dy = e.clientY - this.dragStart.y;

                // Threshold to detect drag vs click
                if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                    this.isDragging = true;
                    this.isFollowing = false; // Disable auto-follow on manual pan
                }

                if (this.isDragging) {
                    // Pan camera: moving mouse Right (dx > 0) moves view Left (camera X decreases)
                    // Scale by tile size to move 1:1 with map
                    const tilesX = dx / this.tileSizePx;
                    const tilesZ = dy / this.tileSizePx; // Screen Y Down = Map Z Down (Drag Down -> Move Map Down -> Z decreases? No wait)

                    // coordinate system:
                    // Render: const worldZ = startZ - row;  (screen Y increases -> row increases -> worldZ decreases)
                    // If I drag mouse DOWN (dy > 0), I want to see content ABOVE? No, drag map like paper.
                    // Drag DOWN -> Move viewport UP (camera Z increases)

                    this.camera.x = this.cameraStart.x - tilesX;
                    this.camera.z = this.cameraStart.z + tilesZ;

                    this.render();
                    return; // Skip hover logic while dragging
                }
            }

            // Hover Logic
            const tile = this._screenToTile(e);
            if (!tile) return;
            this.hoverTile = tile;

            // Check for hovered pawn
            this.hoveredPawn = null;
            for (const [dotId, dot] of this.trackedDots.entries()) {
                // Check proximity (within 0.5 tiles)
                const dx = Math.abs(dot.x - tile.x);
                const dz = Math.abs(dot.z - tile.z);
                if (dx < 0.8 && dz < 0.8) {
                    this.hoveredPawn = dot;
                    break;
                }
            }

            this.render();
        });

        // Mouse Up / Leave (End Drag)
        const endDrag = () => {
            this.dragStart = null;
        };
        this.canvas.addEventListener('mouseup', endDrag);
        this.canvas.addEventListener('mouseleave', endDrag);

        // Click (Order - only if not dragged)
        this.canvas.addEventListener('click', (e) => {
            if (this.isDragging) return; // Prevent order on drag release

            if (!this.onOrder) return;
            const tile = this._screenToTile(e);
            if (!tile) return;
            this.onOrder(tile.x, tile.z);
        });

        // Double Click (Reset Follow)
        this.canvas.addEventListener('dblclick', () => {
            this.isFollowing = true;
            // Immediate snap if data available
            if (this.lastGameState && STATE.myPawnId) {
                this.updateFromGameState(this.lastGameState, STATE.myPawnId);
            }
        });

        // Zoom on wheel
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = -Math.sign(e.deltaY);
            const next = this.tileSizePx + delta * 2;
            this.tileSizePx = Math.min(64, Math.max(16, next));

            // Recalculate tile capacity
            this.tilesX = Math.ceil(this.canvas.width / this.tileSizePx) + 2;
            this.tilesY = Math.ceil(this.canvas.height / this.tileSizePx) + 2;

            this.render();
        }, { passive: false });

        // Right Click (Cancel Order)
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (this.onOrder) {
                this.onOrder = null;
                this.canvas.style.cursor = 'default';
            }
        });
    }

    async initialize(mapId = 0, sessionId = null) {
        this.loading = true;
        this.error = null;
        this.sessionId = sessionId || STATE.currentSession;
        this.textureManager.setSession(this.sessionId);
        this._drawStatus('REQUESTING MAP DATA...');
        const ok = await this.terrainGrid.fetchMap(mapId, this.sessionId);
        if (!ok) {
            this.error = 'MAP DATA UNAVAILABLE (streamer may not be sending terrain)';
            this.loading = false;
            this.render();
            return false;
        }

        // Preload terrain and floor textures
        const terrainFetches = this.terrainGrid.palette.map(async (name) => {
            const img = await this.textureManager.getTexture(name);
            if (img) {
                this.paletteImages.set(name, img);
            } else {
                this.missingTextures.add(name);
            }
        });

        const floorFetches = this.terrainGrid.floorPalette.map(async (name) => {
            const img = await this.textureManager.getTexture(name);
            if (img) {
                this.paletteImages.set(name, img);
            } else {
                this.missingTextures.add(name);
            }
        });

        await Promise.all([...terrainFetches, ...floorFetches]);

        // Fetch things data (items, buildings, stones, etc.)
        try {
            console.log('[MapRenderer] Fetching things for session:', this.sessionId);
            const thingsResp = await fetch(`/api/v1/map/things?sessionId=${this.sessionId}`);
            console.log('[MapRenderer] Things API response status:', thingsResp.status);
            if (thingsResp.ok) {
                const initialThings = await thingsResp.json();
                console.log('[MapRenderer] Initial things loaded:', initialThings.length);
                this.handleThingsUpdate({ things: initialThings });
            } else {
                console.warn('[MapRenderer] Things API returned non-OK:', thingsResp.status);
            }
        } catch (err) {
            console.warn('[MapRenderer] Failed to load things:', err);
        }

        this.ready = true;
        this.loading = false;
        this.render();
        return true;
    }

    handleThingsUpdate(data) {
        if (!data) return;

        // 1. Merge Textures (if provided via Socket)
        if (data.textures) {
            Object.entries(data.textures).forEach(([defName, b64]) => {
                if (b64 && !this.thingImages.has(defName)) {
                    const img = new Image();
                    img.onload = () => this.requestRender(); // Lazy render on load
                    img.src = `data:image/png;base64,${b64}`;
                    this.thingImages.set(defName, img);
                    this.missingTextures.delete(defName);
                }
            });
        }

        // 2. Process Things
        const thingsList = data.things || (Array.isArray(data) ? data : []);

        // Debug: Log things updates
        console.log('[MapRenderer] handleThingsUpdate called:', thingsList.length, 'things received');
        if (thingsList.length > 0) {
            console.log('[MapRenderer] Sample thing:', JSON.stringify(thingsList[0]).substring(0, 200));
        }

        if (thingsList.length > 0 || (data.focus_zones && data.focus_zones.length > 0)) {

            // A. Cleanup Ghosts (if focus zones provided)
            if (data.focus_zones && Array.isArray(data.focus_zones)) {
                // Create lookup for new items
                const newIds = new Set();
                thingsList.forEach(t => {
                    const pos = t.position || t.Position || { x: 0, z: 0 };
                    const def = t.def_name || t.DefName || t.Def || 'Unknown';
                    const id = t.thing_id || t.ThingId || t.Id || `${def}_${pos.x}_${pos.z}`;
                    newIds.add(String(id));
                });

                // Check existing items against focus zones
                for (const [id, thing] of this.thingsMap.entries()) {
                    // If the item is in the new list, it's safe (will be updated)
                    if (newIds.has(id)) continue;

                    const pos = thing.position || thing.Position;
                    if (!pos) continue; // Should not happen
                    const tx = pos.x ?? pos.X;
                    const tz = pos.z ?? pos.Z;

                    // Check if this item is inside any authoritative zone
                    // If it is, and it wasn't in the update, it must be gone.
                    for (const zone of data.focus_zones) {
                        const dx = tx - zone.x;
                        const dz = tz - zone.z;
                        const rSq = zone.radius * zone.radius; // usually 15*15=225 (optimized)

                        if (dx * dx + dz * dz <= rSq) {
                            this.thingsMap.delete(id);
                            break; // Deleted, move to next item
                        }
                    }
                }
            }

            // B. Merge New/Updated Things (with duplicate prevention)
            if (!this.thingsSpatialHash) this.thingsSpatialHash = new Map();

            thingsList.forEach(thing => {
                // Generate robust ID
                const pos = thing.position || thing.Position || { x: 0, z: 0 };
                const def = thing.def_name || thing.DefName || thing.Def || 'Unknown';
                let id = thing.thing_id || thing.ThingId || thing.Id || null;

                // Check for duplicates at same position before adding
                const gridKey = `${Math.floor(pos.x / 2)}_${Math.floor(pos.z / 2)}`;
                const nearbyThings = this.thingsSpatialHash.get(gridKey) || [];

                // Look for existing thing at same position (within 1 tile)
                let existingId = null;
                for (const nearbyId of nearbyThings) {
                    const existing = this.thingsMap.get(nearbyId);
                    if (!existing) continue;

                    const existingPos = existing.position || existing.Position || { x: 0, z: 0 };
                    const dx = Math.abs(existingPos.x - pos.x);
                    const dz = Math.abs(existingPos.z - pos.z);

                    if (dx === 0 && dz === 0) {
                        // Same exact position, reuse existing ID to prevent duplicates (only if ID missing)
                        // If both have explicit IDs and they differ, this might be incorrect, but for 'Things' it's safer.
                        existingId = nearbyId;
                        break;
                    }
                }

                // Use existing ID or create new one
                const finalId = existingId || id || `${def}_${pos.x}_${pos.z}`;

                this.thingsMap.set(String(finalId), thing);

                // Update spatial hash
                if (!existingId) {
                    if (!this.thingsSpatialHash.has(gridKey)) {
                        this.thingsSpatialHash.set(gridKey, []);
                    }
                    this.thingsSpatialHash.get(gridKey).push(String(finalId));
                }
            });

            this.things = Array.from(this.thingsMap.values());

            // 3. Fetch missing textures (Background) if not provided
            const uniqueDefNames = new Set();
            thingsList.forEach(thing => {
                const defName = thing.def_name || thing.DefName || thing.Def;
                if (defName && !this.thingImages.has(defName)) uniqueDefNames.add(defName);
            });

            if (uniqueDefNames.size > 0) {
                this._loadTexturesBackground(Array.from(uniqueDefNames));
            }

            this.requestRender();
        }
    }

    _loadTexturesBackground(defs) {
        // Filter out textures we've already tried and failed, and ones currently loading
        const toLoad = defs.filter(d =>
            !this.failedTextures.has(d) &&
            !this.loadingTextures.has(d) &&
            !this.thingImages.has(d)
        );

        if (toLoad.length === 0) return;

        // Mark all as loading to prevent duplicate requests
        toLoad.forEach(d => this.loadingTextures.add(d));

        const BATCH_SIZE = 8; // Reduced batch size to prevent overwhelming the server
        const loadBatch = async () => {
            for (let i = 0; i < toLoad.length; i += BATCH_SIZE) {
                // Check if still animating (destroyed?) before continuing
                if (!this.animating && !this.ready) return;

                const batch = toLoad.slice(i, i + BATCH_SIZE).map(async (defName) => {
                    try {
                        const img = await this.textureManager.getTexture(defName, 'thing');
                        if (img) {
                            this.thingImages.set(defName, img);
                            this.missingTextures.delete(defName);
                        } else {
                            // Texture returned null (404) - mark as permanently failed
                            this.failedTextures.add(defName);
                            this.missingTextures.delete(defName);
                        }
                    } catch (e) {
                        // Network error - mark as failed to prevent retry loop
                        this.failedTextures.add(defName);
                        this.missingTextures.delete(defName);
                    } finally {
                        this.loadingTextures.delete(defName);
                    }
                });
                await Promise.all(batch);

                // Small delay between batches to prevent overwhelming the server
                if (i + BATCH_SIZE < toLoad.length) {
                    await new Promise(r => setTimeout(r, 50));
                }
            }
        };
        loadBatch();
    }

    requestRender() {
        // Don't skip if animating - animation loop will pick up the changes
        // But we still need to prevent duplicate pending renders
        if (this.renderPending) return;
        if (!this.animating) {
            this.renderPending = true;
            requestAnimationFrame(() => {
                this.render();
                this.renderPending = false;
            });
        }
        // If animating, the _animate() loop will render continuously
    }

    setCameraTarget(x, z) {
        if (Number.isFinite(x) && Number.isFinite(z)) {
            // Clamp camera to valid map bounds to prevent rendering empty space
            const halfX = Math.floor(this.tilesX / 2);
            const halfY = Math.floor(this.tilesY / 2);
            const mapWidth = this.terrainGrid.width || 250;
            const mapHeight = this.terrainGrid.height || 250;

            this.camera.x = Math.max(halfX, Math.min(mapWidth - halfX, x));
            this.camera.z = Math.max(halfY, Math.min(mapHeight - halfY, z));
        }
    }

    updateFromGameState(gameState, pawnId) {
        if (!this.ready || !gameState) return;

        const now = Date.now();

        // Fixed low-latency interpolation for responsive movement
        // At 10Hz updates (100ms), use shorter fixed duration to reduce lag
        this.currentInterpolationDuration = 100; // Fixed 100ms for snappy movement
        this.lastUpdateTimestamp = now;

        // Update all pawn target positions for interpolation (colonists + animals)
        const pawns = [...(gameState.colonists || []), ...(gameState.animals || [])];

        for (const pawn of pawns) {
            const id = String(pawn.id);
            const pos = pawn.position;
            const type = pawn.type || 'colonist';
            if (!pos) continue;

            // Check if we already have a tracked dot for this pawn
            let dotId = this.pawnIdToDotId.get(id);

            if (!dotId) {
                // Before creating new dot, check if there's already a dot at this position
                // Use spatial hash for O(1) lookup instead of O(n) loop
                const gridKey = `${Math.floor(pos.x / 3)}_${Math.floor(pos.z / 3)}`;

                if (!this.spatialHash) this.spatialHash = new Map();
                const nearbyDots = this.spatialHash.get(gridKey) || [];

                let nearbyDot = null;
                let nearbyDotId = null;
                const PROXIMITY = 2;

                // Build set of current pawn IDs for ownership check
                const currentPawnIds = new Set(pawns.map(p => String(p.id)));

                // Only check dots in the same grid cell (much faster than checking ALL dots)
                for (const existingDotId of nearbyDots) {
                    const existingDot = this.trackedDots.get(existingDotId);
                    if (!existingDot) continue;

                    // FIX: Only consider stealing a dot if its current owner is NOT in the incoming data
                    // This prevents dot-stealing when two pawns are near each other
                    if (currentPawnIds.has(existingDot.pawnId)) continue;

                    const dx = Math.abs(existingDot.x - pos.x);
                    const dz = Math.abs(existingDot.z - pos.z);
                    if (dx <= PROXIMITY && dz <= PROXIMITY) {
                        nearbyDot = existingDot;
                        nearbyDotId = existingDotId;
                        break;
                    }
                }

                if (nearbyDot) {
                    // PROTECTION: Never steal a dot that belongs to the user's adopted pawn
                    if (nearbyDot.pawnId === String(STATE.myPawnId)) {
                        // Create new dot instead of stealing
                        dotId = `dot_${this.nextDotId++}`;
                        this.pawnIdToDotId.set(id, dotId);

                        this.trackedDots.set(dotId, {
                            pawnId: id,
                            type: type,
                            name: pawn.name || pawn.label || 'Unknown',
                            defName: pawn.def_name || null,
                            x: pos.x,
                            z: pos.z,
                            startX: pos.x,
                            startZ: pos.z,
                            targetX: pos.x,
                            targetZ: pos.z,
                            portraitData: null,
                            lastUpdate: now,
                            positionTimestamp: pawn.positionTimestamp || pawn.timestamp || 0,
                            facing: pawn.facing || 'South'
                        });

                        // Add to spatial hash
                        if (!this.spatialHash.has(gridKey)) this.spatialHash.set(gridKey, []);
                        this.spatialHash.get(gridKey).push(dotId);
                    } else {
                        // Reuse orphaned dot (previous pawn no longer exists)
                        dotId = nearbyDotId;
                        this.pawnIdToDotId.delete(nearbyDot.pawnId); // Clean up old mapping
                        this.pawnIdToDotId.set(id, dotId);
                        nearbyDot.pawnId = id;
                        nearbyDot.lastUpdate = now;
                        nearbyDot.positionTimestamp = pawn.positionTimestamp || pawn.timestamp || 0;
                    }
                } else {
                    // New pawn - create tracked dot
                    dotId = `dot_${this.nextDotId++}`;
                    this.pawnIdToDotId.set(id, dotId);

                    this.trackedDots.set(dotId, {
                        pawnId: id,
                        type: type,
                        name: pawn.name || pawn.label || 'Unknown',
                        defName: pawn.def_name || null, // Store defName for texture lookup
                        x: pos.x,
                        z: pos.z,
                        startX: pos.x,
                        startZ: pos.z,
                        targetX: pos.x,
                        targetZ: pos.z,
                        portraitData: null,
                        lastUpdate: now,
                        timestamp: now,
                        duration: 0,
                        positionTimestamp: pawn.positionTimestamp || pawn.timestamp || 0
                    });

                    // Add to spatial hash
                    if (!this.spatialHash.has(gridKey)) {
                        this.spatialHash.set(gridKey, []);
                    }
                    this.spatialHash.get(gridKey).push(dotId);
                }

                // Also keep pawnPositions for interpolation compatibility
                this.pawnPositions.set(id, {
                    start: { x: pos.x, z: pos.z },
                    current: { x: pos.x, z: pos.z },
                    target: { x: pos.x, z: pos.z },
                    timestamp: now,
                    duration: this.currentInterpolationDuration
                });
            } else {
                // Update existing dot
                const dot = this.trackedDots.get(dotId);
                const existing = this.pawnPositions.get(id);

                if (dot && existing && (existing.target.x !== pos.x || existing.target.z !== pos.z)) {
                    // Check timestamp to prevent old data from overwriting new positions
                    const posTimestamp = pawn.positionTimestamp || pawn.timestamp || 0;
                    const lastPosTimestamp = dot.positionTimestamp || 0;

                    // Only update if this position data is newer than what we have (or no timestamps available)
                    if (posTimestamp > 0 && lastPosTimestamp > 0 && posTimestamp < lastPosTimestamp) {
                        // Skip this update - it's stale data
                        continue;
                    }

                    // Store the timestamp for future comparisons
                    if (posTimestamp > 0) {
                        dot.positionTimestamp = posTimestamp;
                    }

                    // Check for large jumps (teleport, fast travel, etc.) - snap instantly
                    const dx = Math.abs(pos.x - existing.current.x);
                    const dz = Math.abs(pos.z - existing.current.z);
                    const isLargeJump = dx > 5 || dz > 5;

                    if (isLargeJump) {
                        // Instant snap
                        dot.startX = pos.x;
                        dot.startZ = pos.z;
                        dot.x = pos.x;
                        dot.z = pos.z;
                        dot.targetX = pos.x;
                        dot.targetZ = pos.z;
                        dot.timestamp = now;
                        dot.duration = 0;

                        existing.start = { x: pos.x, z: pos.z };
                        existing.current = { x: pos.x, z: pos.z };
                        existing.target = { x: pos.x, z: pos.z };
                        existing.timestamp = now;
                        existing.duration = 0;
                    } else {
                        // Smooth interpolation
                        dot.startX = dot.x;
                        dot.startZ = dot.z;
                        dot.targetX = pos.x;
                        dot.targetZ = pos.z;
                        dot.timestamp = now;
                        dot.duration = this.currentInterpolationDuration;

                        existing.start = { x: existing.current.x, z: existing.current.z };
                        existing.target = { x: pos.x, z: pos.z };
                        existing.timestamp = now;
                        existing.duration = this.currentInterpolationDuration;
                    }

                    dot.lastUpdate = now;
                }
            }
        }

        // PROXIMITY MATCHING: Sync portraits to closest dots
        // Only run when there are unassigned dots to prevent micro-stutter and portrait swapping
        const hasUnassignedDots = Array.from(this.trackedDots.values()).some(dot => !dot.portraitData);
        if (hasUnassignedDots && gameState.colonists) {
            this._syncPortraitsToDotsProximity(gameState.colonists);
        }

        // CLEANUP: Remove stale dots (60 seconds to account for pauses)
        const STALE_TIMEOUT = 60000; // 60 seconds
        for (const [dotId, dot] of this.trackedDots.entries()) {
            if (now - dot.lastUpdate > STALE_TIMEOUT) {
                this.trackedDots.delete(dotId);
                this.pawnIdToDotId.delete(dot.pawnId);

                // FIX: Also clean up pawnPositions to prevent unbounded growth
                this.pawnPositions.delete(dot.pawnId);

                // Clean up portrait cache for this dot
                this.pawnPortraits.delete(dotId);

                // Remove from spatial hash
                if (this.spatialHash) {
                    const gridKey = `${Math.floor(dot.x / 3)}_${Math.floor(dot.z / 3)}`;
                    const gridDots = this.spatialHash.get(gridKey);
                    if (gridDots) {
                        const index = gridDots.indexOf(dotId);
                        if (index > -1) {
                            gridDots.splice(index, 1);
                        }
                        if (gridDots.length === 0) {
                            this.spatialHash.delete(gridKey);
                        }
                    }
                }
            }
        }

        // Update camera to follow my pawn's interpolated position
        if (this.isFollowing && pawnId) {
            const dotId = this.pawnIdToDotId.get(String(pawnId));
            if (dotId) {
                const dot = this.trackedDots.get(dotId);
                if (dot) {
                    this.setCameraTarget(dot.x, dot.z);
                }
            }
        }

        this.lastGameState = gameState;

        // Start animation loop if not already running
        if (!this.animating) {
            this.animating = true;
            this._animate();
        }
    }

    _syncPortraitsToDotsProximity(colonists) {
        // Greedy bipartite matching: Assign portraits to closest dots
        const PROXIMITY_THRESHOLD = 5; // Only match if within 5 tiles

        const colonistsWithPortraits = colonists
            .map(pawn => {
                const pawnId = String(pawn.id);
                const portraitData = STATE.colonistPortraits?.[pawnId];
                return portraitData && pawn.position ? { pawnId, pos: pawn.position, portraitData } : null;
            })
            .filter(p => p !== null);

        if (colonistsWithPortraits.length === 0) return;

        // Build list of all match candidates (dot, colonist, distance)
        // Only consider dots that don't already have portraits assigned (prevents re-assignment)
        const matches = [];
        for (const [dotId, dot] of this.trackedDots.entries()) {
            // Skip dots that already have portraits (stable assignment)
            if (dot.portraitData) continue;

            for (const colonist of colonistsWithPortraits) {
                const dx = dot.x - colonist.pos.x;
                const dz = dot.z - colonist.pos.z;
                const distance = Math.sqrt(dx * dx + dz * dz);

                if (distance <= PROXIMITY_THRESHOLD) {
                    matches.push({ dotId, colonist, distance });
                }
            }
        }

        // Sort by distance (closest first)
        matches.sort((a, b) => a.distance - b.distance);

        // Greedy assignment: Assign closest pairs, mark as used
        const usedDots = new Set();
        const usedColonists = new Set();

        for (const match of matches) {
            if (usedDots.has(match.dotId) || usedColonists.has(match.colonist.pawnId)) {
                continue; // Already assigned
            }

            // Assign portrait to dot
            const dot = this.trackedDots.get(match.dotId);
            if (dot) {
                // PROTECTION: Never reassign pawnId if this dot belongs to user's adopted pawn
                // or if we're trying to steal the adopted pawn's ID
                const isMyPawnDot = dot.pawnId === String(STATE.myPawnId);
                const isMyPawnId = match.colonist.pawnId === String(STATE.myPawnId);

                if (isMyPawnDot && !isMyPawnId) {
                    // Don't steal my pawn's dot
                    continue;
                }

                dot.portraitData = match.colonist.portraitData;

                // Only update pawnId if it's actually different and not stealing from myPawn
                if (dot.pawnId !== match.colonist.pawnId) {
                    dot.pawnId = match.colonist.pawnId;
                    this.pawnIdToDotId.set(match.colonist.pawnId, match.dotId);
                }

                usedDots.add(match.dotId);
                usedColonists.add(match.colonist.pawnId);
            }
        }
    }

    _resize() {
        if (!this.container) return;
        const { clientWidth, clientHeight } = this.container;
        this.canvas.width = clientWidth;
        this.canvas.height = clientHeight;

        // Fixed vertical fit ~16 tiles for consistent zoom
        this.tileSizePx = Math.floor(clientHeight / 16);
        this.tileSizePx = Math.max(20, Math.min(64, this.tileSizePx || 32));

        this.tilesX = Math.ceil(clientWidth / this.tileSizePx) + 2;
        this.tilesY = Math.ceil(clientHeight / this.tileSizePx) + 2;

        this.render();
    }

    render() {
        if (!this.ctx) return;
        const { width, height } = this.canvas;
        this.ctx.clearRect(0, 0, width, height);

        if (this.loading) {
            this._drawStatus('LOADING OPTICAL GRID...');
            return;
        }
        if (this.error) {
            this._drawStatus(this.error);
            return;
        }
        if (!this.ready) {
            this._drawStatus('OPTICAL FEED STANDBY');
            return;
        }

        // SMOOTH SCROLLING MATH
        // Viewport dimensions in tiles
        const viewW = width / this.tileSizePx;
        const viewH = height / this.tileSizePx;

        // Top-Left of the viewport in World Coordinates (Float)
        // Camera is center, so subtract half view size
        const viewLeft = this.camera.x - (viewW / 2);
        const viewTop = this.camera.z + (viewH / 2);

        // Integer tile coordinates to start iterating from (buffer -1 for edge clipping)
        const startX = Math.floor(viewLeft);
        const startZ = Math.ceil(viewTop);

        // Sub-pixel offset (how much we are shifted into the first tile)
        // x: increasing camera moves view right -> map moves left. offset > 0 pushes drawing left?
        // drawX = (worldX - viewLeft) * tile
        //       = (startX + col - viewLeft) * tile
        //       = (col - (viewLeft - startX)) * tile
        //       = col * tile - pixelOffset
        const pixelOffsetX = (viewLeft - startX) * this.tileSizePx;
        const pixelOffsetY = (startZ - viewTop) * this.tileSizePx;

        // Iterate tiles (add +1 buffer for smooth edge scrolling)
        for (let row = 0; row <= this.tilesY + 1; row++) {
            for (let col = 0; col <= this.tilesX + 1; col++) {
                const worldX = startX + col;
                const worldZ = startZ - row;

                // Screen coordinates
                const x = Math.floor(col * this.tileSizePx - pixelOffsetX);
                const y = Math.floor(row * this.tileSizePx - pixelOffsetY);

                const { textureName, paletteIndex } = this.terrainGrid.getTextureAt(worldX, worldZ);
                const img = textureName ? this.paletteImages.get(textureName) : null;

                if (img) {
                    this.ctx.drawImage(img, x, y, this.tileSizePx, this.tileSizePx);
                } else {
                    this.ctx.fillStyle = this._fallbackColor(textureName, paletteIndex);
                    this.ctx.fillRect(x, y, this.tileSizePx, this.tileSizePx);
                }

                // Floor Layer (Inline for performance)
                const floor = this.terrainGrid.getFloorAt(worldX, worldZ);
                if (floor.textureName) {
                    const floorImg = this.paletteImages.get(floor.textureName);
                    if (floorImg) {
                        this.ctx.drawImage(floorImg, x, y, this.tileSizePx, this.tileSizePx);
                    }
                }
            }
        }

        // Things layer (items, buildings, stones)
        // Debug: Log things count periodically
        if (!this._lastThingsLog || Date.now() - this._lastThingsLog > 5000) {
            console.log('[MapRenderer] Rendering things:', this.things.length, 'thingsMap size:', this.thingsMap.size);
            this._lastThingsLog = Date.now();
        }
        for (const thing of this.things) {
            const pos = thing.position || thing.Position;
            if (!pos) continue;

            const posX = pos.x ?? pos.X;
            const posZ = pos.z ?? pos.Z;

            // Strict Culling with buffer
            if (posX < startX - 1 || posX > startX + this.tilesX + 1 ||
                posZ > startZ + 1 || posZ < startZ - this.tilesY - 1) {
                continue;
            }

            // Calculate screen pos using float math for smooth movement relative to map
            const screenX = (posX - viewLeft) * this.tileSizePx;
            // Z: WorldZ increases Up. ScreenY increases Down.
            // ScreenY = (viewTop - posZ) * tile
            const screenY = (viewTop - posZ) * this.tileSizePx;

            const defName = thing.def_name || thing.DefName || thing.Def;
            let img = this.thingImages.get(defName);

            // Apply Tint (if available)
            if (img && (thing.color || thing.Color)) {
                img = this._getTintedImage(img, thing.color || thing.Color);
            }

            const size = thing.size || thing.Size || { x: 1, X: 1, z: 1, Z: 1 };
            const sizeX = size.x ?? size.X ?? 1;
            const sizeZ = size.z ?? size.Z ?? 1;
            const rotation = thing.rotation ?? thing.Rotation ?? 0;

            if (img) {
                const scaleFactor = 1.2;
                const width = sizeX * this.tileSizePx * scaleFactor;
                const height = sizeZ * this.tileSizePx * scaleFactor;

                this.ctx.save();
                const offsetX = screenX - (width - this.tileSizePx) / 2;
                // Note: RimWorld (0,0) is bottom-left of thing? or center? Usually bottom-left.
                // If Bottom-Left, and sizeZ > 1, it extends UP (posZ increases).
                // ScreenY is Top of the tile.
                // If a thing is at (10, 10) size (1, 2). It covers (10,10) and (10,11).
                // posZ=10. screenY points to bottom of (10,11)? No.
                // Standard: render anchored at screenX, screenY.
                const offsetY = screenY - (height - this.tileSizePx) / 2;

                if (rotation > 0) {
                    const centerX = offsetX + width / 2;
                    const centerY = offsetY + height / 2;
                    this.ctx.translate(centerX, centerY);
                    this.ctx.rotate((rotation * Math.PI) / 2);
                    this.ctx.translate(-centerX, -centerY);
                }
                this.ctx.drawImage(img, offsetX, offsetY, width, height);
                this.ctx.restore();
            } else {
                const thingId = thing.thing_id ?? thing.ThingId ?? thing.Id ?? 0;
                this.ctx.fillStyle = this._fallbackColor(defName, thingId);

                const isBuilding = sizeX > 1 || sizeZ > 1 ||
                    (defName && (defName.includes('Wall') || defName.includes('Door') ||
                        defName.includes('Table') || defName.includes('Bed')));

                if (isBuilding) {
                    const pad = 2;
                    const w = sizeX * this.tileSizePx - pad * 2;
                    const h = sizeZ * this.tileSizePx - pad * 2;
                    // For multi-tile buildings extending Z+, we must draw UP (lower Y)
                    // If anchored at (x,z), and sizeZ=2, it covers z, z+1.
                    // ScreenY is the top-left of tile z. 
                    // To cover z+1, we draw at screenY - (sizeZ-1)*tile?
                    // Simplified: just draw at anchor for now (might clip).
                    // Actually, if screenY is top-left of tile z, then z+1 is ABOVE it (Y - tile).
                    // So we draw starting at screenY - (sizeZ-1)*tile.
                    const drawY = screenY - (sizeZ - 1) * this.tileSizePx;

                    this.ctx.fillRect(screenX + pad, drawY + pad, w, h);
                    this.ctx.strokeStyle = 'rgba(0,0,0,0.5)';
                    this.ctx.lineWidth = 1;
                    this.ctx.strokeRect(screenX + pad, drawY + pad, w, h);
                } else {
                    const itemSize = Math.max(this.tileSizePx * 0.4, 6);
                    this.ctx.fillRect(
                        screenX + (this.tileSizePx - itemSize) / 2,
                        screenY + (this.tileSizePx - itemSize) / 2,
                        itemSize,
                        itemSize
                    );
                }
            }
        }

        // Grid
        this.ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        for (let i = 0; i <= this.tilesX + 1; i++) {
            const p = Math.floor(i * this.tileSizePx - pixelOffsetX);
            this.ctx.moveTo(p, 0);
            this.ctx.lineTo(p, height);
        }
        for (let i = 0; i <= this.tilesY + 1; i++) {
            const p = Math.floor(i * this.tileSizePx - pixelOffsetY);
            this.ctx.moveTo(0, p);
            this.ctx.lineTo(width, p);
        }
        this.ctx.stroke();

        // Dots
        this.trackedDots.forEach((dot, dotId) => {
            // Calculate EXACT screen position from float coordinates
            const screenX = (dot.x - viewLeft) * this.tileSizePx;
            const screenY = (viewTop - dot.z) * this.tileSizePx;

            // Cull
            if (screenX < -50 || screenX > width + 50 || screenY < -50 || screenY > height + 50) return;

            const centerX = screenX + this.tileSizePx / 2;
            const centerY = screenY + this.tileSizePx / 2;
            const isMyPawn = dot.pawnId === String(STATE.myPawnId);
            const portraitData = dot.portraitData;

            // 1. Try Colonist Portrait (Highest Priority)
            if (portraitData) {
                let img = this.pawnPortraits.get(dotId);
                if (!img || img.portraitData !== portraitData) {
                    img = new Image();
                    img.src = `data:image/png;base64,${portraitData}`;
                    img.portraitData = portraitData;
                    this.pawnPortraits.set(dotId, img);
                }

                if (img.complete) {
                    const portraitSize = this.tileSizePx * 1.6;
                    this.ctx.save();
                    this.ctx.beginPath();
                    this.ctx.arc(centerX, centerY, portraitSize / 2, 0, Math.PI * 2);
                    this.ctx.clip();
                    this.ctx.drawImage(img, centerX - portraitSize / 2, centerY - portraitSize / 2, portraitSize, portraitSize);
                    this.ctx.restore();

                    if (isMyPawn) {
                        this.ctx.strokeStyle = '#00ff41';
                        this.ctx.lineWidth = 3;
                        this.ctx.beginPath();
                        this.ctx.arc(centerX, centerY, portraitSize / 2 + 2, 0, Math.PI * 2);
                        this.ctx.stroke();
                    }
                    return; // Done
                }
            }

            // 2. Try Animal Texture
            if (dot.type === 'animal' && dot.defName) {
                const img = this.thingImages.get(dot.defName);
                if (img && img.complete && img.naturalWidth > 0) {
                    const size = this.tileSizePx * 1.2;
                    this.ctx.drawImage(img, centerX - size / 2, centerY - size / 2, size, size);
                    return; // Done
                } else {
                    // Queue load if missing
                    if (!this.thingImages.has(dot.defName)) {
                        this.missingTextures.add(dot.defName);
                    }
                }
            }

            // 3. Fallback: Dot
            this._drawPawnDot(centerX, centerY, isMyPawn, dot.type);
        });

        // Trigger background load for any missing animal textures found this frame
        // Throttled: only load if we have pending items and aren't already loading too many
        if (this.missingTextures.size > 0 && this.loadingTextures.size < 16) {
            const missing = Array.from(this.missingTextures);
            this._loadTexturesBackground(missing);
        }

        if (this.hoverTile) {
            // Hover tile logic must also be updated to float math or reverse-projection
            // Re-calc based on current pixel offsets
            // Or just draw simple rect if we have the col/row relative to viewport?
            // hoverTile = _screenToTile gives absolute world coords.
            const hX = (this.hoverTile.x - viewLeft) * this.tileSizePx;
            const hY = (viewTop - this.hoverTile.z) * this.tileSizePx;

            this.ctx.strokeStyle = 'rgba(0,255,65,0.6)';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(hX, hY, this.tileSizePx, this.tileSizePx);
        }

        if (this.hoveredPawn) {
            this._drawLabel(this.hoveredPawn);
        }
    }

    _drawLabel(dot) {
        if (!dot || !dot.name) return;

        const { width, height } = this.canvas;
        const viewW = width / this.tileSizePx;
        const viewH = height / this.tileSizePx;
        const viewLeft = this.camera.x - (viewW / 2);
        const viewTop = this.camera.z + (viewH / 2);

        const screenX = (dot.x - viewLeft) * this.tileSizePx + (this.tileSizePx / 2);
        const screenY = (viewTop - dot.z) * this.tileSizePx - 5; // Above dot

        this.ctx.font = 'bold 12px "IBM Plex Mono", monospace';
        const text = dot.name.toUpperCase();
        const metrics = this.ctx.measureText(text);
        const padding = 4;

        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        this.ctx.fillRect(
            screenX - metrics.width / 2 - padding,
            screenY - 12 - padding,
            metrics.width + padding * 2,
            12 + padding * 2
        );

        this.ctx.fillStyle = '#00ff41'; // Green text
        if (dot.type === 'animal') this.ctx.fillStyle = '#ffc800'; // Yellow for animals

        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'bottom';
        this.ctx.fillText(text, screenX, screenY);
    }

    _drawStatus(text) {
        const { width, height } = this.canvas;
        this.ctx.fillStyle = '#0a0a0a';
        this.ctx.fillRect(0, 0, width, height);
        this.ctx.fillStyle = '#00ff41';
        this.ctx.font = '12px "IBM Plex Mono", monospace';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(text, width / 2, height / 2);

        // Hint when terrain is missing
        if (this.error && this.sessionId) {
            this.ctx.fillStyle = 'rgba(255,255,255,0.6)';
            this.ctx.font = '10px "IBM Plex Mono", monospace';
            this.ctx.fillText(`Session: ${this.sessionId}`, width / 2, height / 2 + 16);
        }
    }

    _animate() {
        if (!this.animating) return;

        const now = Date.now();
        const defaultDuration = 250;

        // Interpolate all pawn positions (legacy system for compatibility)
        for (const [id, data] of this.pawnPositions.entries()) {
            const elapsed = now - data.timestamp;
            const duration = data.duration || defaultDuration;

            const t = Math.min(elapsed / duration, 1.0);
            const smoothT = t * (2 - t); // ease-out-quad

            data.current.x = data.start.x + (data.target.x - data.start.x) * smoothT;
            data.current.z = data.start.z + (data.target.z - data.start.z) * smoothT;

            if (t >= 1.0) {
                data.current.x = data.target.x;
                data.current.z = data.target.z;
            }
        }

        // Interpolate tracked dots (primary rendering system)
        for (const [dotId, dot] of this.trackedDots.entries()) {
            const elapsed = now - dot.timestamp;
            const duration = dot.duration || defaultDuration;

            const t = Math.min(elapsed / duration, 1.0);
            const smoothT = t * (2 - t); // ease-out-quad

            // Lerp from start to target
            dot.x = dot.startX + (dot.targetX - dot.startX) * smoothT;
            dot.z = dot.startZ + (dot.targetZ - dot.startZ) * smoothT;

            // Snap when complete
            if (t >= 1.0) {
                dot.x = dot.targetX;
                dot.z = dot.targetZ;
            }
        }

        // CAMERA TRACKING: Update every frame to lock to interpolated position
        if (this.isFollowing && STATE.myPawnId) {
            const dotId = this.pawnIdToDotId.get(String(STATE.myPawnId));
            if (dotId) {
                const dot = this.trackedDots.get(dotId);
                if (dot) {
                    // Update camera to exact interpolated position
                    this.setCameraTarget(dot.x, dot.z);
                }
            }
        }

        this.render();
        requestAnimationFrame(() => this._animate());
    }

    _screenToTile(evt) {
        const rect = this.canvas.getBoundingClientRect();
        const x = evt.clientX - rect.left;
        const y = evt.clientY - rect.top;

        const col = Math.floor(x / this.tileSizePx);
        const row = Math.floor(y / this.tileSizePx);

        if (col < 0 || row < 0 || col >= this.tilesX || row >= this.tilesY) return null;

        const halfX = Math.floor(this.tilesX / 2);
        const halfY = Math.floor(this.tilesY / 2);

        const startX = Math.round(this.camera.x - halfX + 0.5);
        const startZ = Math.round(this.camera.z + halfY - 0.5);

        const worldX = startX + col;
        const worldZ = startZ - row;

        return { x: worldX, z: worldZ, col, row };
    }

    _fallbackColor(name, index) {
        // Deterministic pastel-ish color based on palette index/name
        const key = name || '';
        let hash = index || 0;
        for (let i = 0; i < key.length; i++) {
            hash = ((hash << 5) - hash) + key.charCodeAt(i);
            hash |= 0;
        }
        const r = 80 + (hash & 0xff) % 120;
        const g = 80 + ((hash >> 8) & 0xff) % 120;
        const b = 80 + ((hash >> 16) & 0xff) % 120;
        return `rgb(${r},${g},${b})`;
    }

    _drawPawnDot(x, y, isMyPawn, type) {
        if (type === 'animal') {
            this.ctx.fillStyle = 'rgba(255, 200, 0, 0.7)'; // Yellowish for animals
        } else {
            this.ctx.fillStyle = isMyPawn ? '#00ff41' : 'rgba(255,255,255,0.7)';
        }

        this.ctx.beginPath();
        this.ctx.arc(x, y, this.tileSizePx * 0.25, 0, Math.PI * 2);
        this.ctx.fill();
        if (isMyPawn) {
            this.ctx.strokeStyle = '#00ff41';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
        }
    }

    _getTintedImage(img, color) {
        if (!img || !img.complete || !color) return img;

        // Normalize color
        if (color.toLowerCase() === '#ffffff' || color.toLowerCase() === '#ffffffff') return img;

        const key = `${img.src}_${color}`;
        if (this.tintCache.has(key)) {
            return this.tintCache.get(key);
        }

        // Limit cache size - use LRU eviction instead of clearing all (prevents stutter)
        if (this.tintCache.size > 500) {
            // Remove oldest 25% of entries (Map maintains insertion order)
            const toRemove = Math.floor(this.tintCache.size * 0.25);
            let removed = 0;
            for (const key of this.tintCache.keys()) {
                if (removed >= toRemove) break;
                this.tintCache.delete(key);
                removed++;
            }
        }

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');

        // Draw image
        ctx.drawImage(img, 0, 0);

        // Multiply color
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Restore alpha from original image
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(img, 0, 0);

        this.tintCache.set(key, canvas);
        return canvas;
    }

    /**
     * Destroy the MapRenderer and release all resources.
     * MUST be called when leaving the My Pawn tab to prevent memory leaks.
     */
    destroy() {
        console.log('[MapRenderer] Destroying - releasing resources');

        // 1. Stop animation loop
        this.animating = false;

        // 2. Remove window resize listener
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            this._resizeHandler = null;
        }

        // 3. Clear all caches to release memory
        this.trackedDots.clear();
        this.pawnIdToDotId.clear();
        this.pawnPositions.clear();
        this.pawnPortraits.clear();
        this.thingImages.clear();
        this.paletteImages.clear();
        this.tintCache.clear();
        this.thingsMap.clear();
        this.missingTextures.clear();
        this.failedTextures.clear();
        this.loadingTextures.clear();

        // 4. Clear spatial hashes
        if (this.spatialHash) {
            this.spatialHash.clear();
            this.spatialHash = null;
        }
        if (this.thingsSpatialHash) {
            this.thingsSpatialHash.clear();
            this.thingsSpatialHash = null;
        }

        // 5. Clear things array
        this.things = [];

        // 6. Clear canvas
        if (this.ctx) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }

        // 7. Remove canvas from DOM
        if (this.container) {
            this.container.innerHTML = '';
        }

        // 8. Reset state flags
        this.ready = false;
        this.loading = false;
        this.lastGameState = null;

        console.log('[MapRenderer] Destroyed successfully');
    }
}
