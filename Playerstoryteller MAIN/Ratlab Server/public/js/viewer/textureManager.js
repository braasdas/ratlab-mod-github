export class TextureManager {
    constructor(options = {}) {
        this.cache = new Map();
        this.dbName = 'RatLabTextureCache';
        this.storeName = 'textures';
        this.db = null;
        this.sessionId = options.sessionId || null;
        this.initDB();
    }

    setSession(sessionId) {
        this.sessionId = sessionId;
    }

    // Initialize IndexedDB
    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'name' });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error("TextureDB Error:", event.target.error);
                resolve(null); // Fallback to memory-only
            };
        });
    }

    async getTexture(textureName, type = 'terrain') {
        // 1. Check Memory Cache
        const cacheKey = `${type}:${textureName}`;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        // 2. Check IndexedDB
        const dbImg = await this.getFromDB(cacheKey);
        if (dbImg) {
            const img = await this.createImageFromBlob(dbImg.blob);
            if (img) {
                this.cache.set(cacheKey, img);
                return img;
            }
            // Corrupted blob in IndexedDB - delete it and fall through to network fetch
            console.warn(`[TextureManager] Corrupted blob in IndexedDB for ${cacheKey}, refetching...`);
            this.deleteFromDB(cacheKey);
        }

        // 3. Fetch from Network
        try {
            let endpoint;

            if (type === 'item' || type === 'building' || type === 'thing') {
                // Global Texture Cache - route is /texture/:name (NOT /api/texture)
                endpoint = `/texture/${encodeURIComponent(textureName)}`;
            } else if (type === 'animal' || type === 'pawn') {
                // Session-specific animal/pawn textures (from mapThings)
                const qs = new URLSearchParams();
                if (this.sessionId) qs.set('sessionId', this.sessionId);
                qs.set('name', textureName);
                endpoint = `/api/v1/map/thing/image?${qs.toString()}`;
            } else {
                // Legacy Terrain Logic
                const qs = new URLSearchParams();
                if (this.sessionId) qs.set('sessionId', this.sessionId);
                qs.set('name', textureName);
                endpoint = `/api/v1/map/terrain/image?${qs.toString()}`;
            }

            const response = await fetch(endpoint);
            if (!response.ok) {
                if (type === 'animal' || type === 'pawn') {
                    console.warn(`[TextureManager] Animal texture not found: ${textureName} (${response.status}) - Mod needs to send animal textures via map-things-update`);
                } else {
                    console.warn(`[TextureManager] Texture fetch ${type}:${textureName} -> ${response.status}`);
                }
                return null;
            }

            const blob = await response.blob();
            this.saveToDB(cacheKey, blob); // Save for next time

            const img = await this.createImageFromBlob(blob);
            if (img) {
                this.cache.set(cacheKey, img);
            }
            return img;
        } catch (err) {
            console.error(`Failed to load texture: ${type}:${textureName}`, err);
            return null; // Return null or a placeholder
        }
    }

    // Helper: Promisify IndexedDB GET
    async getFromDB(key) {
        if (!this.db) return null;
        return new Promise((resolve) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
        });
    }

    // Helper: Save to IndexedDB
    saveToDB(name, blob) {
        if (!this.db) return;
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        store.put({ name, blob, timestamp: Date.now() });
    }

    // Helper: Delete from IndexedDB (for corrupted entries)
    deleteFromDB(key) {
        if (!this.db) return;
        try {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            store.delete(key);
        } catch (e) {
            console.warn('[TextureManager] Failed to delete from IndexedDB:', e);
        }
    }

    // Helper: Blob to HTMLImageElement (non-throwing)
    createImageFromBlob(blob) {
        return new Promise((resolve) => {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url); // FIX: Release blob reference to prevent memory leak
                resolve(img);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url); // FIX: Also release on error
                resolve(null);
            };
            img.src = url;
        });
    }

    // Clear all caches (memory and IndexedDB) - useful for fixing corrupted cache
    async clearAllCaches() {
        console.log('[TextureManager] Clearing all texture caches...');

        // Clear memory cache
        this.cache.clear();

        // Clear IndexedDB
        if (this.db) {
            try {
                const transaction = this.db.transaction([this.storeName], 'readwrite');
                const store = transaction.objectStore(this.storeName);
                const request = store.clear();

                await new Promise((resolve, reject) => {
                    request.onsuccess = () => {
                        console.log('[TextureManager] IndexedDB cache cleared successfully');
                        resolve();
                    };
                    request.onerror = () => {
                        console.warn('[TextureManager] Failed to clear IndexedDB cache');
                        reject();
                    };
                });
            } catch (e) {
                console.warn('[TextureManager] Error clearing IndexedDB:', e);
            }
        }

        return true;
    }
}