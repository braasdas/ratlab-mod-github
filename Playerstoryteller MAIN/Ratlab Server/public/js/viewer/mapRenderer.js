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
        this.sessionId = null;
        this.things = []; // Array of things on the map (Render List)
        this.thingsMap = new Map(); // Persistent storage (ID -> Thing)

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
        window.addEventListener('resize', () => this._resize());
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
            const thingsResp = await fetch(`/api/v1/map/things?sessionId=${this.sessionId}`);
            if (thingsResp.ok) {
                const initialThings = await thingsResp.json();
                this.handleThingsUpdate({ things: initialThings });
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
        
        // Debug delay
        // console.log('[MapRenderer] Update received:', (data.things || []).length, 'items', Date.now());

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
        
        if (thingsList.length > 0 || (data.focus_zones && data.focus_zones.length > 0)) {
            
            // A. Cleanup Ghosts (if focus zones provided)
            if (data.focus_zones && Array.isArray(data.focus_zones)) {
                // Create lookup for new items
                const newIds = new Set();
                thingsList.forEach(t => {
                    const pos = t.position || t.Position || {x:0, z:0};
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
                        const rSq = zone.radius * zone.radius; // usually 25*25=625
                        
                        if (dx*dx + dz*dz <= rSq) {
                            this.thingsMap.delete(id);
                            break; // Deleted, move to next item
                        }
                    }
                }
            }

            // B. Merge New/Updated Things
            thingsList.forEach(thing => {
                // Generate robust ID
                const pos = thing.position || thing.Position || {x:0, z:0};
                const def = thing.def_name || thing.DefName || thing.Def || 'Unknown';
                const id = thing.thing_id || thing.ThingId || thing.Id || `${def}_${pos.x}_${pos.z}`;
                
                this.thingsMap.set(String(id), thing);
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
        const BATCH_SIZE = 8;
        const loadBatch = async () => {
            for (let i = 0; i < defs.length; i += BATCH_SIZE) {
                const batch = defs.slice(i, i + BATCH_SIZE).map(async (defName) => {
                    try {
                        const img = await this.textureManager.getTexture(defName, 'thing');
                        if (img) {
                            // If it's a new image object, ensure we render when ready
                            if (!img.complete) {
                                img.onload = () => this.requestRender();
                            }
                            this.thingImages.set(defName, img);
                            this.missingTextures.delete(defName);
                        } else {
                            this.missingTextures.add(defName);
                        }
                    } catch (e) {
                        // console.warn(`[MapRenderer] Failed to load texture for ${defName}`, e);
                    }
                });
                await Promise.all(batch);
                // No forced render here - let image.onload handle it
            }
        };
        loadBatch();
    }

    requestRender() {
        if (this.animating) return; // Main loop handles it
        if (this.renderPending) return;
        this.renderPending = true;
        requestAnimationFrame(() => {
            this.render();
            this.renderPending = false;
        });
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

        // Update all pawn target positions for interpolation
        const pawns = gameState.colonists || [];
        const now = Date.now();

        for (const entry of pawns) {
            const pawn = entry.colonist || entry;
            const id = String(pawn.id || pawn.pawn_id);
            const pos = pawn.position;
            if (!pos) continue;

            const existing = this.pawnPositions.get(id);
            if (existing) {
                // Only update if position actually changed
                if (existing.target.x !== pos.x || existing.target.z !== pos.z) {
                    // Store current position as start of interpolation
                    existing.start = { x: existing.current.x, z: existing.current.z };
                    existing.target = { x: pos.x, z: pos.z };
                    existing.timestamp = now;
                }
            } else {
                // New pawn - set all to same position (no interpolation needed)
                this.pawnPositions.set(id, {
                    start: { x: pos.x, z: pos.z },
                    current: { x: pos.x, z: pos.z },
                    target: { x: pos.x, z: pos.z },
                    timestamp: now
                });
            }
        }

        // Update camera to follow my pawn's interpolated position
        const myPawnData = this.pawnPositions.get(String(pawnId));
        if (myPawnData && this.isFollowing) {
            this.setCameraTarget(myPawnData.current.x, myPawnData.current.z);
        }

        this.lastGameState = gameState;

        // Start animation loop if not already running
        if (!this.animating) {
            this.animating = true;
            this._animate();
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

        const halfX = Math.floor(this.tilesX / 2);
        const halfY = Math.floor(this.tilesY / 2);
        
        // Round to keep the pawn centered even on odd tile counts
        const startX = Math.round(this.camera.x - halfX + 0.5);
        const startZ = Math.round(this.camera.z + halfY - 0.5);

        // Terrain layer
        for (let row = 0; row < this.tilesY; row++) {
            for (let col = 0; col < this.tilesX; col++) {
                const worldX = startX + col;
                const worldZ = startZ - row;

                const { textureName, paletteIndex } = this.terrainGrid.getTextureAt(worldX, worldZ);
                const img = textureName ? this.paletteImages.get(textureName) : null;

                const x = col * this.tileSizePx;
                const y = row * this.tileSizePx;

                if (img) {
                    this.ctx.drawImage(img, x, y, this.tileSizePx, this.tileSizePx);
                } else {
                    this.ctx.fillStyle = this._fallbackColor(textureName, paletteIndex);
                    this.ctx.fillRect(x, y, this.tileSizePx, this.tileSizePx);
                }
            }
        }

        // Floor layer (constructed floors on top of terrain)
        for (let row = 0; row < this.tilesY; row++) {
            for (let col = 0; col < this.tilesX; col++) {
                const worldX = startX + col;
                const worldZ = startZ - row;

                const { textureName } = this.terrainGrid.getFloorAt(worldX, worldZ);
                if (textureName) {
                    const img = this.paletteImages.get(textureName);
                    const x = col * this.tileSizePx;
                    const y = row * this.tileSizePx;

                    if (img) {
                        this.ctx.drawImage(img, x, y, this.tileSizePx, this.tileSizePx);
                    }
                }
            }
        }

        // Things layer (items, buildings, stones) - rendered between floor and pawns
        for (const thing of this.things) {
            // Support both snake_case (RimAPI) and PascalCase
            const pos = thing.position || thing.Position;
            if (!pos) continue;

            const posX = pos.x ?? pos.X;
            const posZ = pos.z ?? pos.Z;

            // Quick Cull: Is it even near the camera?
            if (posX < startX || posX >= startX + this.tilesX || 
                posZ > startZ || posZ <= startZ - this.tilesY) {
                continue;
            }

            const col = posX - startX;
            const row = startZ - posZ;
            // Redundant check but keeps logic clean
            if (col < 0 || row < 0 || col >= this.tilesX || row >= this.tilesY) continue;

            const defName = thing.def_name || thing.DefName || thing.Def;
            const img = this.thingImages.get(defName);

            const x = col * this.tileSizePx;
            const y = row * this.tileSizePx;

            // Get thing size (default 1x1) - support both formats
            const size = thing.size || thing.Size || { x: 1, X: 1, z: 1, Z: 1 };
            const sizeX = size.x ?? size.X ?? 1;
            const sizeZ = size.z ?? size.Z ?? 1;
            const rotation = thing.rotation ?? thing.Rotation ?? 0;

            if (img) {
                // Render the texture
                // SCALE THINGS 1.2x (reduced from 2.1x)
                const scaleFactor = 1.2;
                const width = sizeX * this.tileSizePx * scaleFactor;
                const height = sizeZ * this.tileSizePx * scaleFactor;

                this.ctx.save();
                // Center the scaled image on the tile
                const offsetX = x - (width - this.tileSizePx) / 2;
                const offsetY = y - (height - this.tileSizePx) / 2;

                // Rotate if needed (rotation is 0-3 in RimWorld, each = 90 degrees)
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
                // Fallback: Geometric Rendering for Missing Textures
                const thingId = thing.thing_id ?? thing.ThingId ?? thing.Id ?? 0;
                this.ctx.fillStyle = this._fallbackColor(defName, thingId);
                
                // Heuristic: Buildings (Walls, Doors, Tables) should fill the tile.
                // Items (Meals, Steel) should be small.
                const isBuilding = sizeX > 1 || sizeZ > 1 || 
                                   (defName && (defName.includes('Wall') || defName.includes('Door') || 
                                   defName.includes('Table') || defName.includes('Bed') || 
                                   defName.includes('Cooler') || defName.includes('Heater')));

                if (isBuilding) {
                    // Draw full block structure
                    const pad = 2;
                    const w = sizeX * this.tileSizePx - pad * 2;
                    const h = sizeZ * this.tileSizePx - pad * 2;
                    
                    this.ctx.fillRect(x + pad, y + pad, w, h);
                    
                    // Add border for definition
                    this.ctx.strokeStyle = 'rgba(0,0,0,0.5)';
                    this.ctx.lineWidth = 1;
                    this.ctx.strokeRect(x + pad, y + pad, w, h);
                } else {
                    // Draw small item box (debris style)
                    const itemSize = Math.max(this.tileSizePx * 0.4, 6);
                    this.ctx.fillRect(
                        x + (this.tileSizePx - itemSize) / 2,
                        y + (this.tileSizePx - itemSize) / 2,
                        itemSize,
                        itemSize
                    );
                }
            }
        }

        // Grid overlay (subtle)
        this.ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        this.ctx.lineWidth = 1;
        
        // Vertical lines
        for (let i = 0; i <= this.tilesX; i++) {
            const p = i * this.tileSizePx;
            this.ctx.beginPath();
            this.ctx.moveTo(p, 0);
            this.ctx.lineTo(p, this.tilesY * this.tileSizePx);
            this.ctx.stroke();
        }
        
        // Horizontal lines
        for (let i = 0; i <= this.tilesY; i++) {
            const p = i * this.tileSizePx;
            this.ctx.beginPath();
            this.ctx.moveTo(0, p);
            this.ctx.lineTo(this.tilesX * this.tileSizePx, p);
            this.ctx.stroke();
        }

        // Dynamic: colonists
        const pawns = this.lastGameState?.colonists || [];
        pawns.forEach((entry) => {
            const pawn = entry.colonist || entry;
            const pawnId = String(pawn.id || pawn.pawn_id);

            // Use interpolated position if available, otherwise fall back to raw position
            const interpData = this.pawnPositions.get(pawnId);
            const pos = interpData ? interpData.current : (pawn.position || { x: 0, z: 0 });
            if (!pos) return;

            const col = pos.x - startX;
            const row = startZ - pos.z;
            if (col < 0 || row < 0 || col > this.tilesX || row > this.tilesY) return;

            const centerX = col * this.tileSizePx + this.tileSizePx / 2;
            const centerY = row * this.tileSizePx + this.tileSizePx / 2;
            const isMyPawn = pawnId === String(STATE.myPawnId);

            // Try to get portrait from STATE.colonistPortraits
            const portraitData = STATE.colonistPortraits?.[pawnId];

            if (portraitData) {
                // Use cached Image object or create new one
                let img = this.pawnPortraits.get(pawnId);
                if (!img || img.portraitData !== portraitData) {
                    img = new Image();
                    img.src = `data:image/png;base64,${portraitData}`;
                    img.portraitData = portraitData; // Track for cache invalidation
                    this.pawnPortraits.set(pawnId, img);
                }

                if (img.complete) {
                    // Scale pawn 2x (1.6x tile size, up from 0.8x)
                    const portraitSize = this.tileSizePx * 1.6; 
                    this.ctx.save();

                    // Draw circular clipped portrait
                    this.ctx.beginPath();
                    this.ctx.arc(centerX, centerY, portraitSize / 2, 0, Math.PI * 2);
                    this.ctx.clip();
                    this.ctx.drawImage(img,
                        centerX - portraitSize / 2,
                        centerY - portraitSize / 2,
                        portraitSize,
                        portraitSize
                    );
                    this.ctx.restore();

                    // Add border for my pawn
                    if (isMyPawn) {
                        this.ctx.strokeStyle = '#00ff41';
                        this.ctx.lineWidth = 3;
                        this.ctx.beginPath();
                        this.ctx.arc(centerX, centerY, portraitSize / 2 + 2, 0, Math.PI * 2);
                        this.ctx.stroke();
                    }
                } else {
                    // Fallback while loading
                    this._drawPawnDot(centerX, centerY, isMyPawn);
                }
            } else {
                // No portrait available - draw dot
                this._drawPawnDot(centerX, centerY, isMyPawn);
            }
        });

        // Hover highlight
        if (this.hoverTile) {
            const col = this.hoverTile.col;
            const row = this.hoverTile.row;
            this.ctx.strokeStyle = 'rgba(0,255,65,0.6)';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(col * this.tileSizePx, row * this.tileSizePx, this.tileSizePx, this.tileSizePx);
        }
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
        const interpolationTime = 500; // Match polling rate (500ms)

        // Interpolate all pawn positions
        for (const [id, data] of this.pawnPositions.entries()) {
            const elapsed = now - data.timestamp;
            const t = Math.min(elapsed / interpolationTime, 1.0);

            // Smooth interpolation - ease out cubic for more natural movement
            const smoothT = 1 - Math.pow(1 - t, 3);

            // Lerp from start to target position
            data.current.x = data.start.x + (data.target.x - data.start.x) * smoothT;
            data.current.z = data.start.z + (data.target.z - data.start.z) * smoothT;

            // Snap to target when complete
            if (t >= 1.0) {
                data.current.x = data.target.x;
                data.current.z = data.target.z;
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

    _drawPawnDot(x, y, isMyPawn) {
        this.ctx.fillStyle = isMyPawn ? '#00ff41' : 'rgba(255,255,255,0.7)';
        this.ctx.beginPath();
        this.ctx.arc(x, y, this.tileSizePx * 0.25, 0, Math.PI * 2);
        this.ctx.fill();
        if (isMyPawn) {
            this.ctx.strokeStyle = '#00ff41';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
        }
    }
}
