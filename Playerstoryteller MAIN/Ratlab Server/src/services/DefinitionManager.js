class DefinitionManager {
    constructor() {
        // Map of sessionId -> definitions
        this.sessionDefinitions = new Map();
    }

    processAndStore(sessionId, inputData) {
        // Handle wrapped data (in case Mod didn't unwrap it or API changed)
        const data = (inputData && inputData.data && (inputData.data.weather_defs || inputData.data.incidents_defs || inputData.data.pawn_kind_defs)) 
            ? inputData.data 
            : inputData;

        const processed = {
            weather: [],
            incidents: [],
            animals: [],
            items: []
        };

        // 1. Weather
        if (data.weather_defs) {
            processed.weather = data.weather_defs.map(d => ({
                defName: d.def_name,
                label: d.label,
                description: d.description
            }));
        }

        // 2. Incidents (Events)
        if (data.incidents_defs) {
            processed.incidents = data.incidents_defs
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
            processed.animals = data.pawn_kind_defs
                .filter(d => {
                    // Handle both old object format and new string format
                    const raceName = (typeof d.race === 'string') ? d.race : (d.race ? d.race.def_name : null);
                    
                    if (!raceName) return false;

                    // Exclude Humans and Mechs to isolate Animals
                    if (raceName === 'Human') return false;
                    if (raceName.startsWith('Mech_')) return false;

                    // If old format has explicit flag, use it
                    if (typeof d.race === 'object' && d.race.animal !== undefined) {
                        return d.race.animal;
                    }

                    return true;
                }) 
                .map(d => ({
                    defName: d.def_name,
                    label: d.label,
                    combatPower: d.combat_power,
                    race: (typeof d.race === 'string') ? d.race : (d.race ? d.race.def_name : 'Unknown')
                }));
        }
        
        // 4. Items (ThingDef)
        if (data.things_defs) {
            processed.items = data.things_defs
                .filter(d => d.is_weapon || d.is_apparel) // Only equipment
                .map(d => ({
                    defName: d.def_name,
                    label: d.label,
                    marketValue: d.market_value,
                    isWeapon: d.is_weapon
                }));
        }

        console.log(`[DefinitionManager] Stored definitions for session ${sessionId}. (Events: ${processed.incidents.length}, Weather: ${processed.weather.length})`);
        this.sessionDefinitions.set(sessionId, processed);
    }

    getDefinitions(sessionId) {
        return this.sessionDefinitions.get(sessionId) || null;
    }
}

module.exports = new DefinitionManager();