const fetch = require('node-fetch');

class DefinitionManager {
    constructor() {
        this.definitions = {
            weather: [],
            incidents: [],
            animals: [],
            items: []
        };
        this.lastFetch = 0;
        this.fetchInterval = 60 * 1000; // 1 minute cache
        this.gameApiUrl = 'http://localhost:8765/api/v1/def/all';
    }

    async fetchDefinitions() {
        // Prevent spamming the game API
        if (Date.now() - this.lastFetch < this.fetchInterval && this.definitions.weather.length > 0) {
            return this.definitions;
        }

        try {
            console.log('[DefinitionManager] Fetching definitions from Game API...');
            const response = await fetch(this.gameApiUrl);
            
            if (!response.ok) {
                throw new Error(`Game API returned ${response.status}`);
            }

            const json = await response.json();
            
            if (!json.success || !json.data) {
                throw new Error('Invalid JSON structure from Game API');
            }

            this.processDefinitions(json.data);
            this.lastFetch = Date.now();
            console.log('[DefinitionManager] Definitions updated successfully.');
            
            return this.definitions;
        } catch (error) {
            console.warn(`[DefinitionManager] Failed to fetch definitions: ${error.message}. Is the game running?`);
            // Return cached (even if empty) on failure
            return this.definitions;
        }
    }

    processDefinitions(data) {
        // 1. Weather
        if (data.weather_defs) {
            this.definitions.weather = data.weather_defs.map(d => ({
                defName: d.def_name,
                label: d.label,
                description: d.description
            }));
        }

        // 2. Incidents (Events)
        if (data.incidents_defs) {
            this.definitions.incidents = data.incidents_defs
                .filter(d => ['ThreatBig', 'ThreatSmall', 'Misc'].includes(d.category))
                .map(d => ({
                    defName: d.def_name,
                    label: d.label,
                    category: d.category,
                    baseChance: d.base_chance
                }));
        }

        // 3. Animals (PawnKind)
        if (data.pawn_kind_defs) {
            this.definitions.animals = data.pawn_kind_defs
                .filter(d => d.race && d.race.animal) // Ensure it's an animal
                .map(d => ({
                    defName: d.def_name,
                    label: d.label,
                    combatPower: d.combat_power,
                    race: d.race.def_name
                }));
        }
        
        // 4. Items (ThingDef) - Optional for now, but useful for "Force Equip"
        if (data.things_defs) {
            this.definitions.items = data.things_defs
                .filter(d => d.is_weapon || d.is_apparel) // Only equipment
                .map(d => ({
                    defName: d.def_name,
                    label: d.label,
                    marketValue: d.market_value,
                    isWeapon: d.is_weapon
                }));
        }
    }

    getDefinitions() {
        return this.definitions;
    }
}

module.exports = new DefinitionManager();
