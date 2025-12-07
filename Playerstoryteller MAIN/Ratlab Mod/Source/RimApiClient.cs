using System;
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
            return await SafeFetchAsync($"{RimApiBaseUrl}/colonist/portrait?id={colonistId}", $"portrait_{colonistId}");
        }

        /// <summary>
        /// Fetches icon for a specific item definition from RimAPI.
        /// </summary>
        public async Task<string> GetItemIcon(string defName)
        {
            return await SafeFetchAsync($"{RimApiBaseUrl}/item/icon?def={defName}", $"icon_{defName}");
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
                    return ExtractDataFromResponse(response);
                }
            }
            catch (Exception ex)
            {
                Log.Warning($"[Player Storyteller] Failed to fetch definitions: {ex.Message}");
                return null;
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
        /// Format: {"success":true, "data": ...}
        /// </summary>
        private string ExtractDataFromResponse(string response)
        {
            try
            {
                // Try to parse as JObject first
                var jToken = JToken.Parse(response);

                // Check if it's an object with success and data fields
                if (jToken is JObject jObject && jObject["success"] != null && jObject["data"] != null)
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
