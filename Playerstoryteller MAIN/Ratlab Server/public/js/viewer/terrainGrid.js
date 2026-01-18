export class TerrainGrid {
    constructor() {
        this.width = 0;
        this.height = 0;
        this.palette = []; // Array of terrain texture names e.g. ["Soil", "Sand"]
        this.grid = null;  // Int16Array storing terrain palette indices
        this.floorPalette = []; // Array of floor texture names e.g. ["WoodPlankFloor", "Concrete"]
        this.floorGrid = null;  // Int16Array storing floor palette indices (0 = no floor)
        this.loaded = false;
    }

    async fetchMap(mapId = 0, sessionId = null) {
        try {
            const qs = new URLSearchParams();
            if (sessionId) qs.set('sessionId', sessionId);
            qs.set('map_id', mapId);

            const response = await fetch(`/api/v1/map/terrain?${qs.toString()}`);
            if (!response.ok) {
                console.warn(`[Terrain] fetch failed (${response.status}) for session ${sessionId || 'n/a'}`);
                return false;
            }
            
            const data = await response.json();

            this.width = data.width;
            this.height = data.height;
            this.palette = data.palette;
            this.grid = this.decompressRLE(data.grid, this.width * this.height);

            // Load floor data if available
            if (data.floorPalette && data.floorGrid) {
                this.floorPalette = data.floorPalette;
                this.floorGrid = this.decompressRLE(data.floorGrid, this.width * this.height);
                console.log(`Map loaded: ${this.width}x${this.height}, ${this.floorPalette.length} floor types`);
            } else {
                this.floorPalette = [];
                this.floorGrid = null;
                console.log(`Map loaded: ${this.width}x${this.height} (no floor data)`);
            }

            this.loaded = true;
            return true;
        } catch (err) {
            console.error("Terrain load error:", err);
            return false;
        }
    }

    decompressRLE(rleData, expectedSize) {
        const result = new Int16Array(expectedSize);
        let writeIndex = 0;

        // C# sends RLE as [count, value, count, value...]
        for (let i = 0; i < rleData.length; i += 2) {
            const count = rleData[i];     // Count comes first
            const value = rleData[i + 1]; // Value comes second

            for (let c = 0; c < count; c++) {
                if (writeIndex < expectedSize) {
                    result[writeIndex++] = value;
                }
            }
        }
        return result;
    }

    // Get texture name at world coordinates
    getTextureAt(x, z) {
        if (!this.loaded) return { textureName: null, paletteIndex: null };
        if (x < 0 || x >= this.width || z < 0 || z >= this.height) return { textureName: null, paletteIndex: null };

        const index = z * this.width + x;
        const paletteIndex = this.grid[index];
        return { textureName: this.palette[paletteIndex], paletteIndex };
    }

    // Get floor texture name at world coordinates (returns null if no floor)
    getFloorAt(x, z) {
        if (!this.loaded || !this.floorGrid) return { textureName: null, paletteIndex: null };
        if (x < 0 || x >= this.width || z < 0 || z >= this.height) return { textureName: null, paletteIndex: null };

        const index = z * this.width + x;
        const paletteIndex = this.floorGrid[index];

        // Index 0 means no floor (null)
        if (paletteIndex === 0) return { textureName: null, paletteIndex: 0 };

        // Floor palette indices are offset by 1 (1 = first floor, 2 = second, etc.)
        return { textureName: this.floorPalette[paletteIndex - 1], paletteIndex };
    }
}