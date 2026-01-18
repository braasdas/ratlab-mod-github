const { EventEmitter } = require('events');

class SessionStore extends EventEmitter {
    constructor() {
        super();
        
        // sessionId -> { 
        //   streamKey, interactionPassword, 
        //   screenshot: Buffer, gameState: Object, 
        //   lastUpdate: Date, lastHeartbeat: Date, 
        //   players: [], actions: [], isPublic: boolean 
        // }
        this.gameSessions = new Map();
        
        // socketId -> { selectedGame: sessionId }
        this.viewers = new Map();
        
        // sessionId -> { streamer: WebSocket, viewers: Set<WebSocket>, initSegment: Buffer|null }
        // This is primarily used by the Stream Service (WebSocket) for fMP4 relay
        this.streamSessions = new Map();

        // Mapping for quick lookup
        this.streamKeyToSessionId = new Map(); // streamKey -> sessionId

        // Start cleanup interval
        setInterval(() => this.cleanupInactiveSessions(), 10000);
    }

    getSession(sessionId) {
        return this.gameSessions.get(sessionId);
    }

    // Create or update basic session info
    createSession(sessionId, data) {
        const now = new Date();
        // Check if it already exists to preserve state if called redundantly
        if (this.gameSessions.has(sessionId)) {
             return this.updateSession(sessionId, data);
        }

        // Track Stream Key Mapping
        if (data.streamKey) {
            this.streamKeyToSessionId.set(data.streamKey, sessionId);
        }

        const session = {
            streamKey: data.streamKey,
            interactionPassword: data.interactionPassword,
            screenshot: null,
            gameState: {},
            lastUpdate: now,
            lastHeartbeat: now,
            players: [],
            actions: [],
            isPublic: data.isPublic !== false,
            lastLogTime: 0,
            economy: {
                viewers: new Map(),
                coinRate: 10,
                actionCosts: {
                    // Helpful
                    healColonist: 100,
                    healAll: 500,
                    inspireColonist: 200,
                    inspireAll: 800,
                    sendWanderer: 300,
                    sendRefugee: 300,
                    
                    // Resources
                    dropFood: 100,
                    dropMedicine: 150,
                    dropSteel: 200,
                    dropComponents: 250,
                    dropSilver: 500,
                    legendary: 1000,
                    sendLegendary: 1000, // Alias
                    sendTrader: 200,
                    
                    // Animals & Nature (Good)
                    tameAnimal: 200,
                    spawnAnimal: 200,
                    goodEvent: 300,
                    psychicSoothe: 200,
                    ambrosiaSprout: 300,
                    farmAnimalsWanderIn: 200,
                    aurora: 150,
                    
                    // Neutral / Risky
                    thrumboPasses: 300,
                    herdMigration: 250,
                    wildManWandersIn: 200,
                    ransomDemand: 400,

                    // Weather
                    weatherClear: 100,
                    weatherRain: 100,
                    weatherFog: 100,
                    weatherSnow: 100,
                    weatherThunderstorm: 200,
                    // Expanded Weather
                    weatherVomit: 800,
                    weatherHeatWave: 400,
                    weatherColdSnap: 400,
                    weatherDryStorm: 200,
                    weatherFoggyRain: 200,
                    weatherSnowGentle: 200,
                    weatherSnowHard: 200,
                    volcanicWinter: 800,

                    // Threats
                    raid: 500,
                    manhunter: 600,
                    madAnimal: 300,
                    infestation: 800,
                    mechShip: 1000,
                    psychicDrone: 600,
                    shortCircuit: 300,
                    cropBlight: 400,
                    alphabeavers: 300,
                    
                    // Chaos
                    solarFlare: 500,
                    eclipse: 400,
                    toxicFallout: 800,
                    flashstorm: 600,
                    meteor: 500,
                    tornado: 1000,
                    lightning: 200,
                    randomEvent: 300,
                    
                    // Communication
                    sendLetter: 50,
                    ping: 10,

                    // DLC - Royalty
                    dlcLaborers: 300,
                    dlcTribute: 200,
                    dlcAnimaTree: 400,
                    dlcMechCluster: 600,
                    // DLC - Ideology
                    dlcRitual: 200,
                    dlcGauranlen: 400,
                    dlcHackerCamp: 300,
                    dlcInsectJelly: 200,
                    dlcSkylanterns: 200,
                    // DLC - Biotech
                    dlcDiabolus: 1000,
                    dlcWarqueen: 1200,
                    dlcApocriton: 1500,
                    dlcWastepack: 400,
                    dlcSanguophage: 500,
                    dlcGenepack: 300,
                    dlcPoluxTree: 400,
                    dlcAcidicSmog: 600,
                    dlcWastepackInfestation: 700,
                    // DLC - Anomaly
                    dlcDeathPall: 1000,
                    dlcBloodRain: 800,
                    dlcDarkness: 800,
                    dlcShamblers: 600,
                    dlcFleshbeasts: 700,
                    dlcPitGate: 900,
                    dlcChimera: 600,
                    dlcNociosphere: 1200,
                    dlcGoldenCube: 800,
                    dlcMetalhorror: 900,
                    // DLC - Odyssey
                    dlcGravship: 500,
                    dlcDrones: 600,
                    dlcOrbitalTrader: 300,
                    dlcOrbitalDebris: 600,
                    dlcMechanoidSignal: 400
                }
            },
            queue: {
                requests: [], // Array of pending requests
                lastProcessed: new Date(),
                settings: {
                    voteDuration: 600,
                    autoExecute: true,
                    maxQueueSize: 20,
                    allowedTypes: ['action', 'suggestion']
                }
            },
            mapTerrain: null,
            adoptions: {
                active: new Map(), // username -> { pawnId, name, adoptedAt }
                settings: {
                    cost: 1000, // Random adoption cost (1k)
                    manualCost: 2000, // Manual adoption from subjects tab (2k)
                    maxAdoptions: 5
                }
            },
            settings: {
                // Telemetry
                fastDataInterval: 2.0,
                slowDataInterval: 8.0,
                staticDataInterval: 45.0,
                
                // Stream Privacy
                enableLiveScreen: true,
                
                // Limits
                maxActionsPerMinute: 30,
                
                // Action Toggles (Defaults matching Mod)
                actions: {
                    // Helpful
                    heal_colonist: true,
                    heal_all: true,
                    inspire_colonist: true,
                    inspire_all: true,
                    send_wanderer: true,
                    send_refugee: true,
                    
                    // Resources
                    drop_food: true,
                    drop_medicine: true,
                    drop_steel: true,
                    drop_components: true,
                    drop_silver: true,
                    send_legendary: true,
                    send_trader: true,
                    
                    // Animals
                    tame_animal: true,
                    spawn_animal: true,
                    good_event: true,
                    
                    // Weather
                    weather_clear: true,
                    weather_rain: true,
                    weather_fog: true,
                    weather_snow: true,
                    weather_thunderstorm: true,
                    // New Weather
                    weather_vomit: true,
                    weather_heat_wave: true,
                    weather_cold_snap: true,
                    weather_dry_storm: true,
                    weather_foggy_rain: true,
                    weather_snow_gentle: true,
                    weather_snow_hard: true,
                    
                    // Dangerous
                    raid: true,
                    manhunter: true,
                    mad_animal: true,
                    solar_flare: true,
                    eclipse: true,
                    toxic_fallout: true,
                    flashstorm: true,
                    meteor: true,
                    tornado: true,
                    lightning: true,
                    random_event: true,
                    
                    // DLC
                    dlc_laborers: true,
                    dlc_tribute: true,
                    dlc_anima_tree: true,
                    dlc_mech_cluster: true,
                    dlc_ritual: true,
                    dlc_gauranlen: true,
                    dlc_hacker_camp: true,
                    dlc_insect_jelly: true,
                    dlc_skylanterns: true,
                    dlc_diabolus: true,
                    dlc_warqueen: true,
                    dlc_apocriton: true,
                    dlc_wastepack: true,
                    dlc_sanguophage: true,
                    dlc_genepack: true,
                    dlc_polux_tree: true,
                    dlc_acidic_smog: true,
                    dlc_wastepack_infestation: true,
                    dlc_death_pall: true,
                    dlc_blood_rain: true,
                    dlc_darkness: true,
                    dlc_shamblers: true,
                    dlc_fleshbeasts: true,
                    dlc_pit_gate: true,
                    dlc_chimera: true,
                    dlc_nociosphere: true,
                    dlc_golden_cube: true,
                    dlc_metalhorror: true,
                    dlc_gravship: true,
                    dlc_drones: true,
                    dlc_orbital_trader: true,
                    dlc_orbital_debris: true,
                    dlc_mechanoid_signal: true,
                    
                    // Communication
                    solar_flare: true,
                    eclipse: true,
                    toxic_fallout: true,
                    flashstorm: true,
                    meteor: true,
                    tornado: true,
                    lightning: true,
                    random_event: true,
                    
                    // Communication
                    send_letter: true,
                    ping: true
                }
            }
        };
        this.gameSessions.set(sessionId, session);
        return session;
    }

    updateSession(sessionId, updates) {
        const session = this.gameSessions.get(sessionId);
        if (!session) return null;

        // Special handling for password to only update if changed (matches original logic)
        if (updates.interactionPassword !== undefined && session.interactionPassword !== updates.interactionPassword) {
            session.interactionPassword = updates.interactionPassword;
        }
        
        // Update other fields
        if (updates.isPublic !== undefined) session.isPublic = updates.isPublic;
        
        if (updates.streamKey !== undefined) {
            // Clean up old key if it changed
            if (session.streamKey && session.streamKey !== updates.streamKey) {
                this.streamKeyToSessionId.delete(session.streamKey);
            }
            session.streamKey = updates.streamKey;
            this.streamKeyToSessionId.set(session.streamKey, sessionId);
        }

        session.lastUpdate = new Date();
        session.lastHeartbeat = new Date();
        return session;
    }

    removeSession(sessionId) {
        const session = this.gameSessions.get(sessionId);
        if (session && session.streamKey) {
            this.streamKeyToSessionId.delete(session.streamKey);
        }
        
        this.gameSessions.delete(sessionId);
        // streamSessions are managed by the Stream Service mostly, but good to clean up here too
        // if we want to force disconnect.
        // However, the original code had separate cleanups. We'll emit an event.
        this.emit('session-ended', sessionId);
    }

    addViewer(socketId, sessionId, username = null) {
        this.viewers.set(socketId, { selectedGame: sessionId, username });
        const session = this.gameSessions.get(sessionId);
        if (session && !session.players.includes(socketId)) {
            session.players.push(socketId);
        }
        
        // Initialize economy profile if username provided
        if (username && session) {
            if (!session.economy.viewers.has(username)) {
                session.economy.viewers.set(username, {
                    coins: 0,
                    watchStart: new Date(),
                    lastSeen: new Date()
                });
            } else {
                // Update last seen
                const profile = session.economy.viewers.get(username);
                profile.lastSeen = new Date();
            }
        }
    }

    removeViewer(socketId) {
        const viewer = this.viewers.get(socketId);
        if (viewer && viewer.selectedGame) {
            const session = this.gameSessions.get(viewer.selectedGame);
            if (session) {
                session.players = session.players.filter(id => id !== socketId);
            }
            this.viewers.delete(socketId);
            return viewer.selectedGame;
        }
        return null;
    }

    cleanupInactiveSessions() {
        const now = new Date();
        for (const [sessionId, session] of this.gameSessions.entries()) {
            const timeDiff = (now - session.lastHeartbeat) / 1000;
            if (timeDiff > 30) {
                console.log(`[Store] Removing inactive session: ${sessionId} (no updates for ${Math.round(timeDiff)}s)`);
                
                // Remove all players from this session (logic moved from server.js)
                session.players.forEach(playerId => {
                    this.viewers.delete(playerId);
                });

                this.removeSession(sessionId);
            }
        }
    }
}

// Export a singleton instance
module.exports = new SessionStore();
