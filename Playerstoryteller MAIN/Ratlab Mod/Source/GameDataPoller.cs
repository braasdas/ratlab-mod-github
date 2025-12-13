using System;
using System.Collections.Generic;
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

        public GameDataPoller(RimApiClient apiClient, GameDataCache dataCache, Map map)
        {
            this.apiClient = apiClient;
            this.dataCache = dataCache;
            this.map = map;
        }

        #region Fast Data (Colonists - frequently changing)

        /// <summary>
        /// Updates fast-changing data (colonists).
        /// Should be called every 1-2 seconds.
        /// </summary>
        public async void UpdateFastDataAsync()
        {
            try
            {
                int mapId = map.uniqueID;

                // PERFORMANCE FIX: Simplified - only fetch colonists detailed
                string colonistsJson = await apiClient.GetColonistsDetailed(mapId);

                // Get Adoptions
                var viewerManager = map.GetComponent<ViewerManager>();
                string adoptionsJson = "";
                if (viewerManager != null)
                {
                    var adoptions = viewerManager.GetAdoptionsList();
                    if (adoptions.Count > 0)
                    {
                        var sb = new StringBuilder();
                        sb.Append(",\"adoptions\":[");
                        bool first = true;
                        foreach (var kvp in adoptions)
                        {
                            if (!first) sb.Append(",");
                            sb.Append($"{{\"username\":\"{kvp.Key}\",\"pawnId\":\"{kvp.Value}\"}}");
                            first = false;
                        }
                        sb.Append("]");
                        adoptionsJson = sb.ToString();
                    }
                }

                if (!string.IsNullOrEmpty(colonistsJson))
                {
                    string result = "{\"colonists\":" + colonistsJson + adoptionsJson + "}";
                    dataCache.SetFastData(result);
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in UpdateFastDataAsync: {ex.Message}");
            }
        }

        #endregion

        #region Slow Data (Resources, power, creatures - moderately changing)

        /// <summary>
        /// Updates slow-changing data (resources, power, creatures, quests, zones).
        /// Should be called every 5-10 seconds.
        /// </summary>
        public async void UpdateSlowDataAsync()
        {
            try
            {
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
                Log.Error($"[Player Storyteller] Error in UpdateSlowDataAsync: {ex.Message}");
            }
        }

        #endregion

        #region Stored Resources (Items in storage zones)

        /// <summary>
        /// Updates stored resources data.
        /// Should be called every 5-10 seconds.
        /// </summary>
        public async void UpdateStoredResourcesAsync()
        {
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
                Log.Error($"[Player Storyteller] Error in UpdateStoredResourcesAsync: {ex.Message}");
            }
        }

        #endregion

        #region Inventory (Items carried by colonists)

        /// <summary>
        /// Updates inventory data for all colonists.
        /// Should be called every 5-10 seconds.
        /// </summary>
        public async void UpdateInventoryAsync()
        {
            try
            {
                // Get list of current colonists from cached fast data
                string colonistsData = dataCache.GetFastData();

                if (string.IsNullOrEmpty(colonistsData) || colonistsData == "{}") return;

                // Parse colonist IDs (simple string search to avoid JSON library dependency)
                var colonistIds = new System.Collections.Generic.List<string>();
                int startIndex = 0;
                while (true)
                {
                    int idIndex = colonistsData.IndexOf("\"id\":", startIndex);
                    if (idIndex == -1) break;

                    int valueStart = idIndex + 5;
                    int commaIndex = colonistsData.IndexOf(',', valueStart);
                    int braceIndex = colonistsData.IndexOf('}', valueStart);
                    int valueEnd = commaIndex != -1 && (braceIndex == -1 || commaIndex < braceIndex) ? commaIndex : braceIndex;

                    if (valueEnd == -1) break;

                    string idValue = colonistsData.Substring(valueStart, valueEnd - valueStart).Trim();
                    // Remove quotes if present
                    idValue = idValue.Trim('"', ' ', '\t', '\n', '\r');

                    if (!string.IsNullOrEmpty(idValue))
                    {
                        colonistIds.Add(idValue);
                    }

                    startIndex = valueEnd;
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
                Log.Error($"[Player Storyteller] Error in UpdateInventoryAsync: {ex.Message}");
            }
        }

        #endregion

        private bool hasPushedDefinitions = false;

        #region Static Data (Factions, research - rarely changes)

        /// <summary>
        /// Updates static data (factions, research, mods, network quality).
        /// Should be called every 30-60 seconds.
        /// </summary>
        public async void UpdateStaticDataAsync()
        {
            try
            {
                int mapId = map.uniqueID;

                // First run: Push Definitions to Server
                if (!hasPushedDefinitions)
                {
                    hasPushedDefinitions = true; // Set immediately to prevent re-entry
                    PushDefinitionsAsync();
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
                Log.Error($"[Player Storyteller] Error in UpdateStaticDataAsync: {ex.Message}");
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

        private async void PushDefinitionsAsync()
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
