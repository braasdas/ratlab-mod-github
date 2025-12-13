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
        this.missingTextures = new Set();
        this.sessionId = null;

        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.overlay = document.createElement('div');

        this.viewportTiles = 31; // 15 tile radius around pawn
        this.tileSizePx = 32;
        this.camera = { x: 0, z: 0 };
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
        this.canvas.addEventListener('mousemove', (e) => {
            const tile = this._screenToTile(e);
            if (!tile) return;
            this.hoverTile = tile;
            this.render();
        });

        this.canvas.addEventListener('mouseleave', () => {
            this.hoverTile = null;
            this.render();
        });

        this.canvas.addEventListener('click', (e) => {
            if (!this.onOrder) return;
            const tile = this._screenToTile(e);
            if (!tile) return;
            this.onOrder(tile.x, tile.z);
        });

        // Basic zoom on wheel: clamp between 0.5x and 3x
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = -Math.sign(e.deltaY);
            const next = this.tileSizePx + delta * 2;
            this.tileSizePx = Math.min(48, Math.max(16, next));
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

        if (this.missingTextures.size > 0) {
            console.warn('[MapRenderer] Missing textures (will use fallback colors):', Array.from(this.missingTextures));
            // Don't set error - fallback colors work fine
        }

        this.ready = true;
        this.loading = false;
        this.render();
        return true;
    }

    setCameraTarget(x, z) {
        if (Number.isFinite(x) && Number.isFinite(z)) {
            // Clamp camera to valid map bounds to prevent rendering empty space
            const halfRange = Math.floor(this.viewportTiles / 2);
            const mapWidth = this.terrainGrid.width;
            const mapHeight = this.terrainGrid.height;

            this.camera.x = Math.max(halfRange, Math.min(mapWidth - halfRange, x));
            this.camera.z = Math.max(halfRange, Math.min(mapHeight - halfRange, z));
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
        if (myPawnData) {
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
        this.tileSizePx = Math.floor(Math.min(clientWidth, clientHeight) / this.viewportTiles);
        this.tileSizePx = Math.max(16, Math.min(48, this.tileSizePx || 32));
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

        const halfRange = Math.floor(this.viewportTiles / 2);
        // Round to keep the pawn centered even on odd tile counts
        const startX = Math.round(this.camera.x - halfRange + 0.5);
        const startZ = Math.round(this.camera.z + halfRange - 0.5);

        // Terrain layer
        for (let row = 0; row < this.viewportTiles; row++) {
            for (let col = 0; col < this.viewportTiles; col++) {
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
        for (let row = 0; row < this.viewportTiles; row++) {
            for (let col = 0; col < this.viewportTiles; col++) {
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

        // Grid overlay (subtle)
        this.ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        this.ctx.lineWidth = 1;
        for (let i = 0; i <= this.viewportTiles; i++) {
            const p = i * this.tileSizePx;
            this.ctx.beginPath();
            this.ctx.moveTo(p, 0);
            this.ctx.lineTo(p, this.viewportTiles * this.tileSizePx);
            this.ctx.stroke();

            this.ctx.beginPath();
            this.ctx.moveTo(0, p);
            this.ctx.lineTo(this.viewportTiles * this.tileSizePx, p);
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
            if (col < 0 || row < 0 || col > this.viewportTiles || row > this.viewportTiles) return;

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
                    const portraitSize = this.tileSizePx * 0.8; // 80% of tile
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

        if (col < 0 || row < 0 || col >= this.viewportTiles || row >= this.viewportTiles) return null;

        const halfRange = Math.floor(this.viewportTiles / 2);
        // Use same calculation as render() to ensure coordinates match
        const startX = Math.round(this.camera.x - halfRange + 0.5);
        const startZ = Math.round(this.camera.z + halfRange - 0.5);

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
