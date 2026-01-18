using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Threading.Tasks;
using Verse;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace PlayerStoryteller
{
    /// <summary>
    /// HTTP client for communicating with RimAPI (localhost:8765).
    /// Handles all REST API calls to get game state data.
    /// </summary>
    public class RimApiClient
    {
        private const int HttpTimeoutMilliseconds = 1000; // Increased to 1s to avoid timeouts on load
        private const string RimApiBaseUrl = "http://localhost:8765/api/v1";

        private static readonly HttpClient httpClient = new HttpClient();

        public RimApiClient()
        {
            // CRITICAL: Timeout configuration
            if (httpClient.Timeout != TimeSpan.FromMilliseconds(HttpTimeoutMilliseconds))
            {
                httpClient.Timeout = TimeSpan.FromMilliseconds(HttpTimeoutMilliseconds);
            }
        }

        #region Public API Methods

        /// <summary>
        /// Fetches basic colonist data (Light payload: Pos, Health, etc.).
        /// </summary>
        public async Task<string> GetColonists(int mapId)
        {
            return await SafeFetchAsync($"{RimApiBaseUrl}/colonists?map_id={mapId}", "colonists_light");
        }

        /// <summary>
        /// Fetches ONLY colonist positions (Ultra-light payload).
        /// </summary>
        public async Task<string> GetColonistPositions(int mapId)
        {
            return await SafeFetchAsync($"{RimApiBaseUrl}/colonists/positions?map_id={mapId}", "colonist_positions");
        }

        /// <summary>
        /// Fetches detailed colonist data from RimAPI.
        /// </summary>
        public async Task<string> GetColonistsDetailed(int mapId)
        {
            return await SafeFetchAsync($"{RimApiBaseUrl}/colonists/detailed?map_id={mapId}", "colonists");
        }

        /// <summary>
        /// Fetches resource summary from RimAPI.
        /// </summary>
        public async Task<string> GetResourcesSummary(int mapId)
        {
            return await SafeFetchAsync($"{RimApiBaseUrl}/resources/summary?map_id={mapId}", "resources");
        }

        /// <summary>
        /// Fetches stored resources data from RimAPI.
        /// </summary>
        public async Task<string> GetStoredResources(int mapId)
        {
            return await SafeFetchAsync($"{RimApiBaseUrl}/resources/stored?map_id={mapId}", "stored_resources");
        }

        /// <summary>
        /// Fetches power information from RimAPI.
        /// </summary>
        public async Task<string> GetPowerInfo(int mapId)
        {
            return await SafeFetchAsync($"{RimApiBaseUrl}/map/power/info?map_id={mapId}", "power");
        }

        /// <summary>
        /// Fetches creatures summary from RimAPI.
        /// </summary>
        public async Task<string> GetCreaturesSummary(int mapId)
        {
            return await SafeFetchAsync($"{RimApiBaseUrl}/map/creatures/summary?map_id={mapId}", "creatures");
        }

        /// <summary>
        /// Fetches weather information from RimAPI.
        /// </summary>
        public async Task<string> GetWeatherInfo(int mapId)
        {
            return await SafeFetchAsync($"{RimApiBaseUrl}/map/weather?map_id={mapId}", "weather");
        }

        /// <summary>
        /// Fetches research progress from RimAPI.
        /// </summary>
        public async Task<string> GetResearchProgress()
        {
            return await SafeFetchAsync($"{RimApiBaseUrl}/research/progress", "research");
        }

        /// <summary>
        /// Fetches terrain grid (RLE) and palette for a map.
        /// </summary>
        public async Task<string> GetTerrainData(int mapId)
        {
            return await SafeFetchAsync($"{RimApiBaseUrl}/map/terrain?map_id={mapId}", "terrain");
        }

        /// <summary>
        /// Fetches all things on the map (plants, trees, buildings, items, etc.)
        /// </summary>
        public async Task<string> GetMapThings(int mapId)
        {
            return await SafeFetchAsync($"{RimApiBaseUrl}/map/things?map_id={mapId}", "things");
        }

        /// <summary>
        /// Fetches things within a specific radius (Optimized for Live View).
        /// </summary>
        public async Task<string> GetMapThingsInRadius(int mapId, int x, int z, int radius)
        {
            return await SafeFetchAsync($"{RimApiBaseUrl}/map/things/radius?map_id={mapId}&x={x}&z={z}&radius={radius}", "things_radius");
        }

        /// <summary>
        /// Fetches the terrain texture image for a given terrain def name.
        /// </summary>
        public async Task<string> GetTerrainTexture(string defName, int mapId)
        {
            try
            {
                var response = await httpClient.GetStringAsync($"{RimApiBaseUrl}/terrain/image?name={Uri.EscapeDataString(defName)}&map_id={mapId}");

                // RimAPI returns JSON: {"success":true, "data": {"result":"success", "imageBase64":"..."}}
                // Extract the base64 string from the response
                string extractedData = ExtractDataFromResponse(response);
                if (string.IsNullOrEmpty(extractedData))
                {
                    Log.Warning($"[Player Storyteller] Empty response for terrain texture {defName}");
                    return null;
                }

                var jToken = JToken.Parse(extractedData);
                if (jToken is JObject jObject)
                {
                    // Try all casing variations (RimAPI uses snake_case: image_base64)
                    var imageData = jObject["image_base64"] ?? jObject["ImageBase64"] ?? jObject["imageBase64"];
                    if (imageData != null)
                    {
                        return imageData.ToString();
                    }
                }

                Log.Warning($"[Player Storyteller] No image_base64 field in terrain texture response for {defName}");
                return null;
            }
            catch (Exception ex)
            {
                Log.Warning($"[Player Storyteller] Failed to fetch terrain texture {defName}: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// Fetches factions data from RimAPI.
        /// </summary>
        public async Task<string> GetFactions()
        {
            return await SafeFetchAsync($"{RimApiBaseUrl}/factions", "factions");
        }

        /// <summary>
        /// Fetches mods information from RimAPI.
        /// </summary>
        public async Task<string> GetModsInfo()
        {
            return await SafeFetchAsync($"{RimApiBaseUrl}/mods/info", "mods");
        }

        /// <summary>
        /// Fetches inventory for a specific colonist from RimAPI.
        /// </summary>
        public async Task<string> GetColonistInventory(string colonistId)
        {
            return await SafeFetchAsync($"{RimApiBaseUrl}/colonist/inventory?id={colonistId}", $"inventory_{colonistId}");
        }

        /// <summary>
        /// Fetches portrait for a specific colonist from RimAPI.
        /// </summary>
        public async Task<string> GetColonistPortrait(string colonistId)
        {
            return await SafeFetchAsync($"{RimApiBaseUrl}/pawn/portrait/image?id={colonistId}", $"portrait_{colonistId}");
        }

        /// <summary>
        /// Fetches icon for a specific item definition from RimAPI.
        /// </summary>
        public async Task<string> GetItemIcon(string defName)
        {
            try
            {
                var response = await SafeFetchAsync($"{RimApiBaseUrl}/item/image?name={defName}", $"icon_{defName}");
                
                if (string.IsNullOrEmpty(response)) return null;

                // RimAPI returns JSON: {"success":true, "data": {"result":"success", "image_base64":"..."}}
                // SafeFetchAsync already unwraps the outer "data" envelope if present.
                // So response is likely: {"result":"success", "image_base64":"..."}

                var jToken = JToken.Parse(response);
                if (jToken is JObject jObject)
                {
                    // Try all casing variations
                    var imageData = jObject["image_base64"] ?? jObject["ImageBase64"] ?? jObject["imageBase64"];
                    if (imageData != null)
                    {
                        return imageData.ToString();
                    }
                }
                
                return null;
            }
            catch (Exception ex)
            {
                Log.Warning($"[Player Storyteller] Failed to parse item icon for {defName}: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// Fetches quests data from RimAPI.
        /// </summary>
        public async Task<string> GetQuests(int mapId)
        {
            return await SafeFetchAsync($"{RimApiBaseUrl}/quests?map_id={mapId}", "quests");
        }

        /// <summary>
        /// Fetches buildings data from RimAPI.
        /// </summary>
        public async Task<string> GetMapBuildings(int mapId)
        {
            return await SafeFetchAsync($"{RimApiBaseUrl}/map/buildings?map_id={mapId}", "buildings");
        }

        /// <summary>
        /// Fetches plants data from RimAPI (trees, bushes, crops).
        /// </summary>
        public async Task<string> GetMapPlants(int mapId)
        {
            return await SafeFetchAsync($"{RimApiBaseUrl}/map/plants?map_id={mapId}", "plants");
        }

        /// <summary>
        /// Fetches map zones from RimAPI.
        /// </summary>
        public async Task<string> GetMapZones(int mapId)
        {
            return await SafeFetchAsync($"{RimApiBaseUrl}/map/zones?map_id={mapId}", "zones");
        }

        /// <summary>
        /// Fetches research summary from RimAPI.
        /// </summary>
        public async Task<string> GetResearchSummary()
        {
            return await SafeFetchAsync($"{RimApiBaseUrl}/research/summary", "research_summary");
        }

        /// <summary>
        /// Sets schedule (time assignment) for a colonist.
        /// assignmentType: "Work", "Joy", "Sleep", "Anything", "Meditate"
        /// </summary>
        public async Task<bool> SetColonistSchedule(string pawnId, int hour, string assignmentType)
        {
            try 
            {
                var payload = new 
                {
                    id = pawnId,
                    hour = hour,
                    assignment = assignmentType
                };
                
                var json = JsonConvert.SerializeObject(payload);
                var content = new StringContent(json, System.Text.Encoding.UTF8, "application/json");
                
                var response = await httpClient.PostAsync($"{RimApiBaseUrl}/colonist/time-assignment", content);
                return response.IsSuccessStatusCode;
            }
            catch (Exception ex)
            {
                Log.Warning($"[Player Storyteller] Failed to set schedule: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Selects a colonist in the game via RimAPI.
        /// </summary>
        public async Task<bool> SelectColonist(string pawnId)
        {
            try 
            {
                // First deselect all
                await httpClient.PostAsync($"{RimApiBaseUrl}/deselect?type=all", null);

                // Then select the pawn
                var response = await httpClient.PostAsync($"{RimApiBaseUrl}/select?type=pawn&id={pawnId}", null);
                return response.IsSuccessStatusCode;
            }
            catch (Exception ex)
            {
                Log.Warning($"[Player Storyteller] Failed to select colonist: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Sets work priorities for a colonist.
        /// </summary>
        public async Task<bool> SetColonistWorkPriorities(string pawnId, Dictionary<string, int> priorities)
        {
            try 
            {
                // API likely expects "work_priorities" based on the GET response structure
                var payload = new 
                {
                    id = pawnId,
                    work_priorities = priorities
                };
                
                var json = JsonConvert.SerializeObject(payload);
                var content = new StringContent(json, System.Text.Encoding.UTF8, "application/json");
                
                var response = await httpClient.PostAsync($"{RimApiBaseUrl}/colonist/work-priority", content);
                return response.IsSuccessStatusCode;
            }
            catch (Exception ex)
            {
                Log.Warning($"[Player Storyteller] Failed to set work priorities: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Polls for viewer actions from RimAPI.
        /// </summary>
        public async Task<string> PollActions()
        {
            string sessionId = PlayerStorytellerMod.GetSessionId();
            if (string.IsNullOrEmpty(sessionId))
            {
                return null;
            }

            return await SafeFetchAsync($"{RimApiBaseUrl}/actions/poll?session_id={sessionId}", "actions");
        }

        /// <summary>
        /// Fetches ALL definitions from RimAPI (Heavy payload).
        /// Uses a separate client with longer timeout.
        /// </summary>
        public async Task<string> GetAllDefinitions()
        {
            try
            {
                using (var longClient = new HttpClient())
                {
                    longClient.Timeout = TimeSpan.FromSeconds(10);
                    var response = await longClient.GetStringAsync($"{RimApiBaseUrl}/def/all");
                    string data = ExtractDataFromResponse(response);

                    if (!string.IsNullOrEmpty(data))
                    {
                        // COMPATIBILITY PATCH: Ensure 'race' is an object for older servers
                        return PatchDefinitionsForOldServer(data);
                    }
                    return data;
                }
            }
            catch (Exception ex)
            {
                Log.Warning($"[Player Storyteller] Failed to fetch definitions: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// Transforms the definitions JSON to ensure backward compatibility.
        /// Specifically, converts 'race' string in pawn_kind_defs to an object { def_name, animal }.
        /// </summary>
        private string PatchDefinitionsForOldServer(string json)
        {
            try
            {
                // Quick check to avoid parsing if not needed or if it looks wrong
                if (!json.Contains("pawn_kind_defs")) return json;

                var root = JToken.Parse(json);
                if (root is JObject obj)
                {
                    var pawns = obj["pawn_kind_defs"] as JArray;
                    if (pawns != null)
                    {
                        bool modified = false;
                        foreach (var pawn in pawns)
                        {
                            var raceToken = pawn["race"];
                            // If race is just a string (new API format), convert it to object (old API format)
                            if (raceToken != null && raceToken.Type == JTokenType.String)
                            {
                                string raceName = raceToken.ToString();
                                
                                // Heuristic: Humans and Mechs are not "animals" for this list
                                bool isAnimal = raceName != "Human" && !raceName.StartsWith("Mech_");

                                var newRaceObj = new JObject();
                                newRaceObj["def_name"] = raceName;
                                newRaceObj["animal"] = isAnimal;

                                pawn["race"] = newRaceObj;
                                modified = true;
                            }
                        }
                        
                        if (modified)
                        {
                            return obj.ToString(Formatting.None);
                        }
                    }
                }
                return json;
            }
            catch (Exception ex)
            {
                Log.Warning($"[Player Storyteller] Error patching definitions: {ex.Message}");
                return json; // Fallback to original
            }
        }

        #endregion

        #region Private Helper Methods

        /// <summary>
        /// Safely fetches data from RimAPI with error handling and validation.
        /// </summary>
        private async Task<string> SafeFetchAsync(string url, string sectionName)
        {
            try
            {
                var response = await httpClient.GetStringAsync(url);

                // Basic validation - just check if it's valid JSON
                if (string.IsNullOrWhiteSpace(response))
                {
                    Log.Warning($"[Player Storyteller] Empty response from {sectionName}");
                    return null;
                }

                response = response.Trim();

                // Extract data from wrapped response if present
                string extractedData = ExtractDataFromResponse(response);

                if (string.IsNullOrEmpty(extractedData))
                {
                    Log.Warning($"[Player Storyteller] No data extracted from {sectionName}");
                    return null;
                }

                // Must start with { or [
                if (!extractedData.StartsWith("{") && !extractedData.StartsWith("["))
                {
                    Log.Warning($"[Player Storyteller] Invalid JSON from {sectionName}: doesn't start with {{ or [. Data: {extractedData.Substring(0, Math.Min(50, extractedData.Length))}");
                    return null;
                }

                return extractedData;
            }
            catch (Exception ex)
            {
                if (!(ex is HttpRequestException || ex is TaskCanceledException))
                {
                    Log.Warning($"[Player Storyteller] Failed to fetch {sectionName}: {ex.Message}");
                }
                return null;
            }
        }

        /// <summary>
        /// Extracts the "data" field from the new RimAPI response format.
        /// Format: {"success":true, "data": ...} or just {"data": ...}
        /// </summary>
        private string ExtractDataFromResponse(string response)
        {
            try
            {
                // Try to parse as JObject first
                var jToken = JToken.Parse(response);

                // Check if it's an object with data field
                if (jToken is JObject jObject && jObject["data"] != null)
                {
                    // Extract the data field and serialize it back to JSON
                    var dataToken = jObject["data"];

                    // If data is null, return null
                    if (dataToken.Type == JTokenType.Null)
                        return null;

                    // Serialize the data field back to JSON string
                    return JsonConvert.SerializeObject(dataToken, Formatting.None);
                }
            }
            catch (Exception)
            {
                // If parsing fails, return original response
            }

            // Return original if not in new format or parsing failed
            return response;
        }

        #endregion
    }
}
