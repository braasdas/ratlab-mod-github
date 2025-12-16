using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using Verse;
using RimWorld;
using UnityEngine;

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
        
        // Global Texture Cache
        private readonly HashSet<string> knownRemoteTextures = new HashSet<string>();
        private bool manifestSynced = false;
        private int manifestSyncFailures = 0;
        // 3 failures before backoff; quick retry for transient errors, then slow down
        private const int MAX_MANIFEST_SYNC_FAILURES = 3;

        // Sequence ID for position updates (prevents out-of-order packet processing)
        private long positionSequenceId = 0;
        private readonly object positionSequenceLock = new object();

        // PERF FIX #2: Reusable StringBuilder (saves 36,000 allocs/hour at 10Hz)
        private readonly StringBuilder positionBuilder = new StringBuilder(1024);

        // PERF FIX #1: Delta tracking - only send positions that changed
        private readonly Dictionary<int, (int x, int z)> lastPawnPositions = new Dictionary<int, (int x, int z)>();

        public GameDataPoller(RimApiClient apiClient, GameDataCache dataCache, Map map)
        {
            this.apiClient = apiClient;
            this.dataCache = dataCache;
            this.map = map;
        }

        private async Task EnsureManifestSynced()
        {
            // PERFORMANCE FIX: Re-sync manifest every 30 updates to catch server restarts
            // But don't spam retries if server is unreachable
            // 30 ticks = ~30 seconds at 1Hz LiveView rate; re-sync to catch server restarts
            if (manifestSynced && liveViewTickCounter % 30 != 0) return;

            // 100 ticks = ~100 seconds backoff when server is unreachable to reduce log spam
            if (manifestSyncFailures >= MAX_MANIFEST_SYNC_FAILURES && liveViewTickCounter % 100 != 0) return;

            try
            {
                var manifest = await PlayerStorytellerMod.FetchTextureManifestAsync();
                if (manifest != null && manifest.Count > 0)
                {
                    lock(knownRemoteTextures)
                    {
                        knownRemoteTextures.Clear(); // Clear before re-populating
                        foreach(var t in manifest) knownRemoteTextures.Add(t);
                    }
                    Log.Message($"[Player Storyteller] Synced {knownRemoteTextures.Count} cached textures from server.");
                }
                manifestSynced = true;
                manifestSyncFailures = 0; // Reset on success
            }
            catch(Exception ex)
            {
                manifestSyncFailures++;
                if (manifestSyncFailures <= MAX_MANIFEST_SYNC_FAILURES)
                {
                    Log.Warning($"[Player Storyteller] Manifest sync warning ({manifestSyncFailures}/{MAX_MANIFEST_SYNC_FAILURES}): {ex.Message}");
                }
                manifestSynced = false; // Retry next time (with backoff)
            }
        }

        #region Fast Data (Colonists - frequently changing)

        /// <summary>
        /// Updates fast-changing data (colonists positions/health).
        /// Note: Synchronous method - runs on main thread for direct game access.
        /// </summary>
        public void UpdateFastData()
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
                    c["drafted"] = pawn.Drafted;
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
                Log.Error($"[Player Storyteller] Error in UpdateFastData: {ex}");
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
                var pawns = map.mapPawns.SpawnedPawnsInFaction(Faction.OfPlayer);
                if (pawns == null || pawns.Count == 0) return;

                long timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                long sequenceId;
                lock (positionSequenceLock)
                {
                    sequenceId = ++positionSequenceId;
                }

                // PERF FIX #2: Reuse StringBuilder instead of new allocation
                positionBuilder.Clear();
                positionBuilder.Append("{\"pawn_positions\":[");
                bool first = true;
                int changedCount = 0;
                var currentPawnIds = new HashSet<int>();

                foreach (var pawn in pawns)
                {
                    if (pawn == null || !pawn.Spawned) continue;

                    int pawnId = pawn.thingIDNumber;
                    int x = pawn.Position.x;
                    int z = pawn.Position.z;
                    currentPawnIds.Add(pawnId);

                    // PERF FIX #1: Delta tracking - skip if position unchanged
                    bool changed = true;
                    if (lastPawnPositions.TryGetValue(pawnId, out var lastPos))
                    {
                        changed = (lastPos.x != x || lastPos.z != z);
                    }

                    if (changed)
                    {
                        lastPawnPositions[pawnId] = (x, z);
                        changedCount++;

                        if (!first) positionBuilder.Append(",");
                        positionBuilder.Append("{\"id\":");
                        positionBuilder.Append(pawnId);
                        positionBuilder.Append(",\"position\":{\"x\":");
                        positionBuilder.Append(x);
                        positionBuilder.Append(",\"z\":");
                        positionBuilder.Append(z);
                        positionBuilder.Append("},\"timestamp\":");
                        positionBuilder.Append(timestamp);
                        positionBuilder.Append("}");
                        first = false;
                    }
                }

                // Cleanup tracking for dead/despawned pawns (every ~50 calls to avoid overhead)
                if (sequenceId % 50 == 0 && lastPawnPositions.Count > currentPawnIds.Count)
                {
                    var toRemove = new List<int>();
                    foreach (var id in lastPawnPositions.Keys)
                        if (!currentPawnIds.Contains(id)) toRemove.Add(id);
                    foreach (var id in toRemove) lastPawnPositions.Remove(id);
                }

                // Only send if something changed
                if (changedCount > 0)
                {
                    // PERF FIX #3: Build final JSON directly - no JArray.Parse roundtrip
                    positionBuilder.Append("],\"sequence_id\":");
                    positionBuilder.Append(sequenceId);
                    positionBuilder.Append("}");

                    var payload = new UpdatePayload { gameState = positionBuilder.ToString() };
                    await PlayerStorytellerMod.SendUpdateToServerAsync(payload);
                }
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
        /// Note: Synchronous method - runs on main thread for direct game access.
        /// </summary>
        public void UpdateAnimalData()
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
                 Log.Error($"[Player Storyteller] Error in UpdateAnimalData: {ex}");
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
            if (!PlayerStorytellerMod.settings.enableLiveScreen)
            {
                // Log.Message("[Player Storyteller] LiveView skipped - enableLiveScreen is false");
                return;
            }
            if (isUpdatingLiveView) return;

            isUpdatingLiveView = true;
            try
            {
                liveViewTickCounter++;

                // PERFORMANCE FIX: Don't clear sentTextures - server maintains the cache
                // Clearing this forces re-rendering of all textures every 30 seconds!
                // Instead, rely on knownRemoteTextures synced from server manifest

                // Capture focus positions on Main Thread
                var focusPositions = GetFocusPositions();
                if (focusPositions.Count == 0)
                {
                    isUpdatingLiveView = false;
                    return;
                }

                // Debug: Log texture cache stats every 30 ticks (~30 seconds at 1Hz)
                if (liveViewTickCounter % 30 == 0)
                {
                    Log.Message($"[Player Storyteller] LiveView tick {liveViewTickCounter}: sentTextures={sentTextures.Count}, knownRemote={knownRemoteTextures.Count}");
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
                    // 15 cells = ~700 cells queried vs 25 cells = ~2000 cells; balances visibility vs CPU cost
                    const int radius = 15;

                    // Get all things in radius using RimWorld's native spatial query
                    var thingsInRadius = GenRadial.RadialDistinctThingsAround(center, map, radius, true);

                    foreach (var thing in thingsInRadius)
                    {
                        if (thing == null || thing.def == null) continue;
                        
                        // EXCLUDE PAWNS: They are handled by UpdatePawnPositionsAsync and UpdateFastData
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
                            ["Size"] = new JObject { ["x"] = thing.def.size.x, ["z"] = thing.def.size.z },
                            ["Color"] = "#" + ColorUtility.ToHtmlStringRGB(thing.DrawColor)
                        };

                        allThings.Add(thingObj);
                        uniqueDefNames.Add(thing.def.defName);
                    }
                }

                // DELTA OPTIMIZATION REMOVED: Always send update to ensure frontend sync
                lastLiveViewThingIds = currentThingIds;
                
                // Ensure we know what the server has
                await EnsureManifestSynced();

                // 2. Fetch Textures (Optimized: Only new DefNames, smaller batches to prevent spikes)
                var textures = new JObject();
                // 50 textures/tick max; caps RimAPI calls per frame to prevent game stutter
                const int MAX_TEXTURES_PER_TICK = 50;

                // PERFORMANCE FIX: Check BOTH local cache (sentTextures) AND server cache (knownRemoteTextures)
                // This prevents re-fetching if server manifest is empty/failed
                var texturesToFetch = uniqueDefNames
                    .Where(defName => !sentTextures.Contains(defName) && !knownRemoteTextures.Contains(defName))
                    .Take(MAX_TEXTURES_PER_TICK)
                    .ToList();

                // Batch texture fetching to spread load over time
                if (texturesToFetch.Count > 0)
                {
                    var newTexturesForServer = new JObject();

                    // 5 concurrent RimAPI calls per batch; small enough to not block main thread
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
                                newTexturesForServer[result.defName] = result.base64String;
                                sentTextures.Add(result.defName);
                            }
                        }

                        // 10ms yield between batches; lets Unity process other work without noticeable delay
                        if (i + BATCH_SIZE < texturesToFetch.Count)
                        {
                            await Task.Delay(10);
                        }
                    }

                    // Upload new textures to server cache (Wait for success before caching locally)
                    if (newTexturesForServer.Count > 0)
                    {
                        Log.Message($"[Player Storyteller] Uploading {newTexturesForServer.Count} textures to server cache...");
                        // Wrap in "textures" key as server expects { textures: { DefName: base64, ... } }
                        var payload = new JObject { ["textures"] = newTexturesForServer };
                        bool success = await PlayerStorytellerMod.SendTexturesBatchAsync(payload.ToString(Newtonsoft.Json.Formatting.None));
                        Log.Message($"[Player Storyteller] Texture upload {(success ? "succeeded" : "FAILED")}");
                        if (success)
                        {
                            lock(knownRemoteTextures)
                            {
                                foreach (var prop in newTexturesForServer.Properties())
                                {
                                    knownRemoteTextures.Add(prop.Name);
                                }
                            }
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
                    z["radius"] = 15; // Must match query radius above for frontend culling
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
