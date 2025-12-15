using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using Verse;
using RimWorld;

namespace PlayerStoryteller
{
    /// <summary>
    /// Polls RimAPI for game state data and updates the cache.
    /// Handles fast, slow, static, and stored resources data.
    /// </summary>
    public class GameDataPoller
    {
        private readonly RimApiClient apiClient;
        private readonly GameDataCache dataCache;
        private readonly Map map;
        private bool terrainPushed = false;
        private readonly HashSet<string> sentTextures = new HashSet<string>();

        // Sequence ID for position updates (prevents out-of-order packet processing)
        private long positionSequenceId = 0;
        private readonly object positionSequenceLock = new object();

        public GameDataPoller(RimApiClient apiClient, GameDataCache dataCache, Map map)
        {
            this.apiClient = apiClient;
            this.dataCache = dataCache;
            this.map = map;
        }

        #region Fast Data (Colonists - frequently changing)

        /// <summary>
        /// Updates fast-changing data (colonists positions/health).
        /// </summary>
        public void UpdateFastDataAsync()
        {
            if (isUpdatingFastData) return;
            isUpdatingFastData = true;

            try
            {
                // PERFORMANCE FIX: Direct memory access instead of RimAPI call
                var colonists = map.mapPawns.FreeColonists;
                var colonistsArray = new JArray();

                foreach (var pawn in colonists)
                {
                    if (pawn == null || !pawn.Spawned) continue;

                    var c = new JObject();
                    // API uses numeric ID (thingIDNumber)
                    c["id"] = pawn.thingIDNumber;
                    // Also include pawn_id as numeric for consistency
                    c["pawn_id"] = pawn.thingIDNumber; 
                    
                    c["name"] = pawn.LabelShortCap;
                    c["gender"] = pawn.gender.ToString();
                    c["age"] = pawn.ageTracker.AgeBiologicalYears;

                    float health = pawn.health?.summaryHealth?.SummaryHealthPercent ?? 0f;
                    c["health"] = Math.Round(health, 2);

                    float mood = 0f;
                    if (pawn.needs != null && pawn.needs.mood != null)
                    {
                        mood = pawn.needs.mood.CurLevelPercentage;
                    }
                    c["mood"] = Math.Round(mood, 2);

                    float hunger = 0f;
                    if (pawn.needs != null && pawn.needs.food != null)
                    {
                        hunger = pawn.needs.food.CurLevelPercentage;
                    }
                    c["hunger"] = Math.Round(hunger, 4);

                    var pos = new JObject();
                    pos["x"] = pawn.Position.x;
                    pos["z"] = pawn.Position.z;
                    pos["y"] = 0;
                    c["position"] = pos;

                    colonistsArray.Add(c);
                }

                // Get Adoptions (Fast enough to keep here)
                var viewerManager = map.GetComponent<ViewerManager>();
                JArray adoptionsArray = null;
                if (viewerManager != null)
                {
                    var adoptions = viewerManager.GetAdoptionsList();
                    if (adoptions.Count > 0)
                    {
                        adoptionsArray = new JArray();
                        foreach (var kvp in adoptions)
                        {
                            var a = new JObject();
                            a["username"] = kvp.Key;
                            a["pawnId"] = kvp.Value;
                            adoptionsArray.Add(a);
                        }
                    }
                }

                if (colonistsArray.Count > 0)
                {
                    // Build result as JObject to avoid string concatenation in hot path
                    var resultObj = new JObject();
                    resultObj["colonists_light"] = colonistsArray;
                    if (adoptionsArray != null)
                    {
                        resultObj["adoptions"] = adoptionsArray;
                    }

                    string result = resultObj.ToString(Newtonsoft.Json.Formatting.None);
                    dataCache.SetFastData(result);
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in UpdateFastDataAsync: {ex}");
            }
            finally
            {
                isUpdatingFastData = false;
            }
        }

        private bool isSendingPawnPositions = false;
        private bool isUpdatingFastData = false;
        private bool isUpdatingSlowData = false;
        private bool isUpdatingStaticData = false;
        private bool isUpdatingStoredResources = false;
        private bool isUpdatingInventory = false;

        /// <summary>
        /// ULTRAFAST TIER: Updates ONLY pawn positions for smooth map interpolation.
        /// DIRECT ACCESS - bypasses RimAPI for zero latency.
        /// </summary>
        public async Task UpdatePawnPositionsAsync()
        {
            if (isSendingPawnPositions) return;
            isSendingPawnPositions = true;

            try
            {
                // Direct access to pawns - no RimAPI call!
                // CHANGED: Include all player pawns (colonists + animals) for smooth rendering
                var pawns = map.mapPawns.SpawnedPawnsInFaction(Faction.OfPlayer);
                if (pawns == null || pawns.Count == 0) return;

                // Get current timestamp and sequence ID
                long timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                long sequenceId;
                lock (positionSequenceLock)
                {
                    sequenceId = ++positionSequenceId;
                }

                var sb = new StringBuilder(capacity: 512);
                sb.Append("[");
                bool first = true;

                foreach (var pawn in pawns)
                {
                    if (pawn == null || !pawn.Spawned) continue;

                    if (!first) sb.Append(",");

                    // Minimal JSON: ID, position, and timestamp to prevent old data from overwriting new
                    // FIXED: Use thingIDNumber (numeric) to match other data streams and avoid duplication
                    sb.Append("{\"id\":");
                    sb.Append(pawn.thingIDNumber);
                    sb.Append(",\"position\":{\"x\":");
                    sb.Append(pawn.Position.x);
                    sb.Append(",\"z\":");
                    sb.Append(pawn.Position.z);
                    sb.Append("},\"timestamp\":");
                    sb.Append(timestamp);
                    sb.Append("}");

                    first = false;
                }

                sb.Append("]");

                // Build result as JObject to avoid string concatenation in hot path
                var positionsArray = JArray.Parse(sb.ToString());
                var resultObj = new JObject();
                resultObj["pawn_positions"] = positionsArray;
                resultObj["sequence_id"] = sequenceId;
                string result = resultObj.ToString(Newtonsoft.Json.Formatting.None);

                // Send directly to avoid cache/batching delay
                var payload = new UpdatePayload { gameState = result };
                await PlayerStorytellerMod.SendUpdateToServerAsync(payload);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in UpdatePawnPositionsAsync: {ex}");
            }
            finally
            {
                isSendingPawnPositions = false;
            }
        }

        /// <summary>
        /// Updates heavy colonist data (Skills, Gear, Needs).
        /// Should be called less frequently (e.g. every 5s).
        /// </summary>
        public async Task UpdateColonistDetailsAsync()
        {
            try
            {
                int mapId = map.uniqueID;
                string detailedJson = await apiClient.GetColonistsDetailed(mapId);

                if (!string.IsNullOrEmpty(detailedJson))
                {
                    // Parse the nested structure from RIMAPI
                    var colonistsArray = JArray.Parse(detailedJson);

                    // Flatten each colonist to unified structure
                    var flattenedArray = new JArray();
                    foreach (var colonist in colonistsArray)
                    {
                        var flattened = ColonistDtoTransformer.FlattenColonistDetailed(colonist);
                        flattenedArray.Add(flattened);
                    }

                    // Send flattened structure as 'colonists_full'
                    string result = "{\"colonists_full\":" + flattenedArray.ToString(Newtonsoft.Json.Formatting.None) + "}";

                    // Send as direct update to ensure immediate delivery
                    var payload = new UpdatePayload { gameState = result };
                    await PlayerStorytellerMod.SendUpdateToServerAsync(payload);
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in UpdateColonistDetailsAsync: {ex}");
            }
        }

        /// <summary>
        /// Updates animal data (Health, Name, etc).
        /// Should be called moderately (e.g. every 2-5s).
        /// </summary>
        public void UpdateAnimalDataAsync()
        {
            try 
            {
                var animals = map.mapPawns.SpawnedColonyAnimals;
                if (animals == null || animals.Count == 0) return;

                var animalsArray = new JArray();

                foreach (var pawn in animals)
                {
                    if (pawn == null || !pawn.Spawned) continue;

                    var c = new JObject();
                    c["id"] = pawn.thingIDNumber;
                    c["name"] = pawn.Name?.ToStringShort ?? pawn.LabelShort;
                    c["def_name"] = pawn.def.defName;
                    c["label"] = pawn.Label;
                    c["type"] = "animal"; // EXPLICIT TYPE TAG
                    
                    float health = pawn.health?.summaryHealth?.SummaryHealthPercent ?? 0f;
                    c["health"] = Math.Round(health, 2);

                    var pos = new JObject();
                    pos["x"] = pawn.Position.x;
                    pos["z"] = pawn.Position.z;
                    c["position"] = pos;

                    animalsArray.Add(c);
                }

                if (animalsArray.Count > 0)
                {
                    var resultObj = new JObject();
                    resultObj["animals_light"] = animalsArray;
                    string result = resultObj.ToString(Newtonsoft.Json.Formatting.None);
                    
                    dataCache.SetAnimalData(result);
                }
            }
            catch (Exception ex)
            {
                 Log.Error($"[Player Storyteller] Error in UpdateAnimalDataAsync: {ex}");
            }
        }

        #endregion

        #region Slow Data (Resources, power, creatures - moderately changing)

        /// <summary>
        /// Updates slow-changing data (resources, power, creatures, quests, zones).
        /// Should be called every 5-10 seconds.
        /// </summary>
        public async Task UpdateSlowDataAsync()
        {
            if (isUpdatingSlowData) return;
            isUpdatingSlowData = true;

            try
            {
                // Capture focus positions on Main Thread before any await
                var focusPositions = GetFocusPositions();

                int mapId = map.uniqueID;

                // PERFORMANCE FIX: Fetch all in parallel for speed
                var resourcesTask = apiClient.GetResourcesSummary(mapId);
                var powerTask = apiClient.GetPowerInfo(mapId);
                var creaturesTask = apiClient.GetCreaturesSummary(mapId);
                var questsTask = apiClient.GetQuests(mapId);
                var zonesTask = apiClient.GetMapZones(mapId);

                // Wait for all to complete in parallel
                await Task.WhenAll(resourcesTask, powerTask, creaturesTask, questsTask, zonesTask);

                // Check if we got at least some data before updating cache
                string resourcesJson = await resourcesTask;
                string powerJson = await powerTask;
                string creaturesJson = await creaturesTask;
                string questsJson = await questsTask;
                string zonesJson = await zonesTask;

                // If all failed, don't update cache
                if (string.IsNullOrEmpty(resourcesJson) && string.IsNullOrEmpty(powerJson) && 
                    string.IsNullOrEmpty(creaturesJson) && string.IsNullOrEmpty(questsJson) && 
                    string.IsNullOrEmpty(zonesJson))
                {
                    return;
                }

                // PERFORMANCE FIX: Use StringBuilder for JSON construction
                var sb = new StringBuilder(capacity: 1024);
                sb.Append("{");
                bool hasContent = false;

                if (!string.IsNullOrEmpty(resourcesJson))
                {
                    sb.Append("\"resources\":");
                    sb.Append(resourcesJson);
                    hasContent = true;
                }

                if (!string.IsNullOrEmpty(powerJson))
                {
                    if (hasContent) sb.Append(',');
                    sb.Append("\"power\":");
                    sb.Append(powerJson);
                    hasContent = true;
                }

                if (!string.IsNullOrEmpty(creaturesJson))
                {
                    if (hasContent) sb.Append(',');
                    sb.Append("\"creatures\":");
                    sb.Append(creaturesJson);
                    hasContent = true;
                }

                if (!string.IsNullOrEmpty(questsJson))
                {
                    if (hasContent) sb.Append(',');
                    sb.Append("\"quests\":");
                    sb.Append(questsJson);
                    hasContent = true;
                }

                if (!string.IsNullOrEmpty(zonesJson))
                {
                    if (hasContent) sb.Append(',');
                    sb.Append("\"zones\":");
                    sb.Append(zonesJson);
                }

                sb.Append("}");
                string result = sb.ToString();

                dataCache.SetSlowData(result);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in UpdateSlowDataAsync: {ex}");
            }
            finally
            {
                isUpdatingSlowData = false;
            }
        }

        #endregion

        // Helper to get positions of interest (adopted pawns)
        private List<IntVec3> GetFocusPositions()
        {
            var positions = new List<IntVec3>();
            try 
            {
                var viewerManager = map.GetComponent<ViewerManager>();
                if (viewerManager != null)
                {
                    var pawns = viewerManager.GetActivePawns();
                    foreach (var p in pawns.Values)
                    {
                        if (p != null && p.Spawned && p.Map == map)
                        {
                            positions.Add(p.Position);
                        }
                    }
                }

                // Debug: Also include selected pawn
                if (Find.Selector != null && Find.Selector.SingleSelectedThing is Pawn selected && selected.Map == map)
                {
                    positions.Add(selected.Position);
                }
            }
            catch(Exception) { /* Safely ignore main thread access errors if any */ }
            
            return positions;
        }

        #region Stored Resources (Items in storage zones)

        /// <summary>
        /// Updates stored resources data.
        /// Should be called every 5-10 seconds.
        /// </summary>
        public async Task UpdateStoredResourcesAsync()
        {
            if (isUpdatingStoredResources) return;
            isUpdatingStoredResources = true;

            try
            {
                int mapId = map.uniqueID;

                string json = await apiClient.GetStoredResources(mapId);

                if (!string.IsNullOrEmpty(json))
                {
                    dataCache.SetStoredResources(json);
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in UpdateStoredResourcesAsync: {ex}");
            }
            finally
            {
                isUpdatingStoredResources = false;
            }
        }

        #endregion

        #region Inventory (Items carried by colonists)

        /// <summary>
        /// Updates inventory data for all colonists.
        /// Should be called every 5-10 seconds.
        /// </summary>
        public async Task UpdateInventoryAsync()
        {
            if (isUpdatingInventory) return;
            isUpdatingInventory = true;

            try
            {
                // Get list of current colonists from cached fast data
                string colonistsData = dataCache.GetFastData();

                if (string.IsNullOrEmpty(colonistsData) || colonistsData == "{}") return;

                // Parse colonist IDs using Newtonsoft.Json
                var colonistIds = new List<string>();

                try
                {
                    var root = JObject.Parse(colonistsData);
                    var colonistsArray = root["colonists_light"] as JArray;
                    
                    if (colonistsArray != null)
                    {
                        foreach (var item in colonistsArray)
                        {
                            string id = item["id"]?.ToString();
                            if (!string.IsNullOrEmpty(id))
                            {
                                colonistIds.Add(id);
                            }
                        }
                    }
                }
                catch (Exception jsonEx)
                {
                    Log.Error($"[Player Storyteller] Error parsing colonist IDs in UpdateInventoryAsync: {jsonEx.Message}");
                    return;
                }

                if (colonistIds.Count == 0) return;

                // Fetch inventory for all colonists in parallel
                var inventoryTasks = new System.Collections.Generic.List<Task<string>>();
                foreach (var id in colonistIds)
                {
                    inventoryTasks.Add(apiClient.GetColonistInventory(id));
                }
                
                var inventories = await Task.WhenAll(inventoryTasks);

                // Build JSON
                var sb = new StringBuilder(capacity: 1024);
                sb.Append("{");
                bool first = true;
                bool hasData = false;

                for (int i = 0; i < colonistIds.Count; i++)
                {
                    string inventoryJson = inventories[i];
                    if (!string.IsNullOrEmpty(inventoryJson))
                    {
                        if (!first) sb.Append(',');
                        sb.Append($"\"{colonistIds[i]}\":");
                        sb.Append(inventoryJson);
                        first = false;
                        hasData = true;
                    }
                }

                sb.Append("}");
                
                if (hasData)
                {
                    dataCache.SetInventoryData(sb.ToString());
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in UpdateInventoryAsync: {ex}");
            }
            finally
            {
                isUpdatingInventory = false;
            }
        }

        #endregion

        private bool hasPushedDefinitions = false;

        #region Static Data (Factions, research - rarely changes)

        /// <summary>
        /// Updates static data (factions, research, mods, network quality).
        /// Should be called every 30-60 seconds.
        /// </summary>
        public async Task UpdateStaticDataAsync()
        {
            if (isUpdatingStaticData) return;
            isUpdatingStaticData = true;

            try
            {
                int mapId = map.uniqueID;

                // First run: Push Definitions to Server
                if (!hasPushedDefinitions)
                {
                    hasPushedDefinitions = true; // Set immediately to prevent re-entry
                    _ = PushDefinitionsAsync();
                }

                // PERFORMANCE FIX: Fetch all in parallel
                var researchTask = apiClient.GetResearchProgress();
                var researchSummaryTask = apiClient.GetResearchSummary();
                var factionsTask = apiClient.GetFactions();
                var modsTask = apiClient.GetModsInfo();

                // Wait for all to complete in parallel
                await Task.WhenAll(researchTask, researchSummaryTask, factionsTask, modsTask);

                string researchJson = await researchTask;
                string researchSummaryJson = await researchSummaryTask;
                string factionsJson = await factionsTask;
                string modsJson = await modsTask;

                // If everything failed, don't update
                if (string.IsNullOrEmpty(researchJson) && string.IsNullOrEmpty(factionsJson) && string.IsNullOrEmpty(modsJson))
                {
                    return;
                }

                // PERFORMANCE FIX: Use StringBuilder for JSON construction
                var sb = new StringBuilder(capacity: 1024); // Increased capacity for mods list
                sb.Append("{");
                bool hasContent = false;

                if (!string.IsNullOrEmpty(researchJson))
                {
                    sb.Append("\"research\":");
                    sb.Append(researchJson);
                    hasContent = true;
                }

                if (!string.IsNullOrEmpty(researchSummaryJson))
                {
                    if (hasContent) sb.Append(',');
                    sb.Append("\"research_summary\":");
                    sb.Append(researchSummaryJson);
                    hasContent = true;
                }

                if (!string.IsNullOrEmpty(factionsJson))
                {
                    if (hasContent) sb.Append(',');
                    sb.Append("\"factions\":");
                    sb.Append(factionsJson);
                    hasContent = true;
                }

                if (!string.IsNullOrEmpty(modsJson))
                {
                    if (hasContent) sb.Append(',');
                    sb.Append("\"mods\":");
                    sb.Append(modsJson);
                    hasContent = true;
                }

                // Add network quality from settings
                if (hasContent) sb.Append(',');
                sb.Append("\"networkQuality\":\"high\"");

                // Add Map Name
                string mapName = map.Parent.Label;
                if (!string.IsNullOrEmpty(mapName))
                {
                    sb.Append($",\"mapName\":\"{mapName.Replace("\"", "\\\"")}\"");
                }

                // Add Map Size
                sb.Append($",\"map_size\":{{\"x\":{map.Size.x},\"z\":{map.Size.z}}}");

                sb.Append("}");
                string result = sb.ToString();

                dataCache.SetStaticData(result);

                // Low-frequency: send terrain grid + textures once per session
                _ = PushTerrainDataAsync(mapId);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in UpdateStaticDataAsync: {ex}");
            }
            finally
            {
                isUpdatingStaticData = false;
            }
        }

        #endregion

        private async Task PushTerrainDataAsync(int mapId)
        {
            if (terrainPushed) return;

            try
            {
                Log.Message("[Player Storyteller] Starting terrain data push...");

                string terrainJson = await apiClient.GetTerrainData(mapId);
                if (string.IsNullOrEmpty(terrainJson))
                {
                    Log.Warning("[Player Storyteller] Terrain data unavailable from RimAPI; optical view will fallback.");
                    return;
                }

                var payload = JObject.Parse(terrainJson);
                var palette = payload["palette"]?.ToObject<List<string>>() ?? new List<string>();

                var textures = new JObject();
                foreach (var defName in palette)
                {
                    if (string.IsNullOrEmpty(defName)) continue;
                    try
                    {
                        var base64String = await apiClient.GetTerrainTexture(defName, mapId);
                        if (!string.IsNullOrEmpty(base64String))
                        {
                            textures[defName] = base64String;
                        }
                        else
                        {
                            Log.Warning($"[Player Storyteller] RimAPI returned no texture data for {defName}");
                        }
                    }
                    catch (Exception texEx)
                    {
                        Log.Warning($"[Player Storyteller] Failed to fetch terrain texture {defName}: {texEx.Message}");
                    }
                }

                payload["textures"] = textures;

                bool sent = await PlayerStorytellerMod.SendTerrainDataAsync(payload.ToString(Newtonsoft.Json.Formatting.None));
                if (sent)
                {
                    terrainPushed = true;
                    Log.Message("[Player Storyteller] Terrain data pushed to server (grid + textures).");
                }
                else
                {
                    Log.Warning("[Player Storyteller] Failed to push terrain data to server.");
                }
            }
            catch (Exception ex)
            {
                Log.Warning($"[Player Storyteller] Failed to push terrain data: {ex.Message}");
            }
        }

        private bool isUpdatingLiveView = false;
        private HashSet<string> lastLiveViewThingIds = new HashSet<string>();
        private int liveViewTickCounter = 0;

        /// <summary>
        /// OPTIMIZED TIER: Updates the Live Optical View.
        /// Direct game access, no RimAPI calls, delta updates only.
        /// </summary>
        public async Task UpdateLiveViewAsync()
        {
            if (!PlayerStorytellerMod.settings.enableLiveScreen) return;
            if (isUpdatingLiveView) return;

            isUpdatingLiveView = true;
            try
            {
                // Periodically clear texture cache to handle client refreshes (every ~30 updates)
                liveViewTickCounter++;
                if (liveViewTickCounter % 30 == 0)
                {
                    sentTextures.Clear();
                }

                // Capture focus positions on Main Thread
                var focusPositions = GetFocusPositions();
                if (focusPositions.Count == 0)
                {
                    isUpdatingLiveView = false;
                    return;
                }

                // LOCALIZED: Direct game access instead of RimAPI
                var allThings = new JArray();
                var processedIds = new HashSet<string>();
                var uniqueDefNames = new HashSet<string>();
                var currentThingIds = new HashSet<string>();

                // 1. Directly query map things (NO RimAPI call)
                foreach (var pos in focusPositions)
                {
                    IntVec3 center = new IntVec3(pos.x, 0, pos.z);
                    const int radius = 25;

                    // Get all things in radius using RimWorld's native spatial query
                    var thingsInRadius = GenRadial.RadialDistinctThingsAround(center, map, radius, true);

                    foreach (var thing in thingsInRadius)
                    {
                        if (thing == null || thing.def == null) continue;
                        
                        // EXCLUDE PAWNS: They are handled by UpdatePawnPositionsAsync and UpdateFastDataAsync
                        // Sending them here causes double-rendering and ID conflicts ("Human123" vs 123)
                        if (thing is Pawn) continue;

                        string thingId = thing.ThingID;
                        if (processedIds.Contains(thingId)) continue;

                        processedIds.Add(thingId);
                        currentThingIds.Add(thingId);

                        // Build minimal JSON object
                        var thingObj = new JObject
                        {
                            ["ThingId"] = thingId,
                            ["DefName"] = thing.def.defName,
                            ["Position"] = new JObject { ["x"] = thing.Position.x, ["z"] = thing.Position.z },
                            ["Size"] = new JObject { ["x"] = thing.def.size.x, ["z"] = thing.def.size.z }
                        };

                        allThings.Add(thingObj);
                        uniqueDefNames.Add(thing.def.defName);
                    }
                }

                // DELTA OPTIMIZATION REMOVED: Always send update to ensure frontend sync
                // Previously, if the set of IDs didn't change, we sent nothing.
                // But if the frontend missed a packet or cleared its cache, it would show empty/checkered.
                // At 1Hz, sending the JSON for visible things is acceptable bandwidth.
                
                lastLiveViewThingIds = currentThingIds;

                // 2. Fetch Textures (Optimized: Only new DefNames, smaller batches to prevent spikes)
                var textures = new JObject();
                const int MAX_TEXTURES_PER_TICK = 50; 

                var texturesToFetch = uniqueDefNames
                    .Where(defName => !sentTextures.Contains(defName))
                    .Take(MAX_TEXTURES_PER_TICK)
                    .ToList();

                // Debug Log (Periodic) to monitor stream health
                if (liveViewTickCounter % 10 == 0)
                {
                    // Log.Message($"[Player Storyteller] LiveView: Sending {allThings.Count} things, fetching {texturesToFetch.Count} textures.");
                }

                // Batch texture fetching to spread load over time
                if (texturesToFetch.Count > 0)
                {
                    // Process in smaller batches of 5 to prevent blocking
                    const int BATCH_SIZE = 5;
                    for (int i = 0; i < texturesToFetch.Count; i += BATCH_SIZE)
                    {
                        var batch = texturesToFetch.Skip(i).Take(BATCH_SIZE).ToList();

                        var textureTasks = batch.Select(async defName =>
                        {
                            try
                            {
                                var base64String = await apiClient.GetItemIcon(defName);
                                if (!string.IsNullOrEmpty(base64String))
                                {
                                    return new { defName, base64String };
                                }
                            }
                            catch (Exception) { /* Ignore */ }
                            return null;
                        }).ToList();

                        var results = await Task.WhenAll(textureTasks);

                        foreach (var result in results)
                        {
                            if (result != null)
                            {
                                textures[result.defName] = result.base64String;
                                sentTextures.Add(result.defName);
                            }
                        }

                        // Small yield between batches to let other work happen
                        if (i + BATCH_SIZE < texturesToFetch.Count)
                        {
                            await Task.Delay(10); // 10ms pause between batches
                        }
                    }
                }

                // 3. Bundle & Send
                var bundled = new JObject();
                bundled["things"] = allThings;
                bundled["textures"] = textures;
                
                // Add focus zones for frontend cleanup
                var zones = new JArray();
                foreach(var pos in focusPositions)
                {
                    var z = new JObject();
                    z["x"] = pos.x;
                    z["z"] = pos.z;
                    z["radius"] = 25;
                    zones.Add(z);
                }
                bundled["focus_zones"] = zones;

                await PlayerStorytellerMod.SendMapThingsAsync(bundled.ToString(Newtonsoft.Json.Formatting.None));
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Live View Error: {ex}");
            }
            finally
            {
                isUpdatingLiveView = false;
            }
        }

        private async Task PushDefinitionsAsync()
        {
            try
            {
                // Notify player that initial data gathering is happening (may cause lag)
                Messages.Message("RatLab mod loaded. Gathering game definitions... (may cause brief lag)", MessageTypeDefOf.NeutralEvent);

                string defsJson = await apiClient.GetAllDefinitions();
                if (string.IsNullOrEmpty(defsJson)) return;

                string serverUrl = PlayerStorytellerMod.GetServerUrl();
                string sessionId = PlayerStorytellerMod.GetSessionId();
                string streamKey = PlayerStorytellerMod.settings.secretKey;

                using (var client = new System.Net.Http.HttpClient())
                {
                    var content = new System.Net.Http.StringContent(defsJson, Encoding.UTF8, "application/json");
                    content.Headers.Add("x-stream-key", streamKey);
                    
                    var response = await client.PostAsync($"{serverUrl}/api/definitions/{Uri.EscapeDataString(sessionId)}", content);
                    
                    if (response.IsSuccessStatusCode)
                    {
                        Log.Message("[Player Storyteller] Successfully pushed definitions to server.");
                    }
                    else
                    {
                        Log.Warning($"[Player Storyteller] Failed to push definitions. Server returned: {response.StatusCode}");
                        hasPushedDefinitions = false; // Retry later
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Warning($"[Player Storyteller] Error pushing definitions: {ex.Message}");
                hasPushedDefinitions = false; // Retry later
            }
        }
    }
}
