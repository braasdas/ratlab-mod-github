using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Verse;

namespace PlayerStoryteller
{
    /// <summary>
    /// Polls RimAPI for colonist-specific data (portraits, inventory).
    /// Manages caching to avoid redundant fetches.
    /// </summary>
    public class ColonistDataPoller
    {
        private static readonly HttpClient rimapiClient = new HttpClient();
        private const string RimApiBaseUrl = "http://localhost:8765/api/v1";
        private const int HttpTimeoutMilliseconds = 3000; // Increased to 3s for portrait generation

        private readonly RimApiClient apiClient;
        private readonly GameDataCache dataCache;
        private readonly Map map;

        public ColonistDataPoller(RimApiClient apiClient, GameDataCache dataCache, Map map)
        {
            this.apiClient = apiClient;
            this.dataCache = dataCache;
            this.map = map;

            // Set timeout for HTTP client
            if (rimapiClient.Timeout != TimeSpan.FromMilliseconds(HttpTimeoutMilliseconds))
            {
                rimapiClient.Timeout = TimeSpan.FromMilliseconds(HttpTimeoutMilliseconds);
            }
        }

        #region Portrait Data

        /// <summary>
        /// Updates colonist portraits, fetching only missing portraits.
        /// Should be called every 30 seconds.
        /// </summary>
        public async void UpdatePortraitsAsync()
        {
            try
            {
                // Get list of current colonists from cached fast data
                string colonistsData = dataCache.GetFastData();

                if (string.IsNullOrEmpty(colonistsData) || colonistsData == "{}")
                {
                    return;
                }

                // Parse colonist IDs from JSON
                var colonistIds = ExtractColonistIds(colonistsData);

                if (colonistIds.Count == 0)
                {
                    return;
                }

                // Only log the first time we discover colonists
                var cachedPortraits = dataCache.GetAllCachedPortraits();
                if (cachedPortraits.Count == 0 && colonistIds.Count > 0)
                {
                    Log.Message($"[Player Storyteller] Found {colonistIds.Count} colonists, will fetch portraits");
                }

                // Fetch portraits for colonists we don't have cached
                // SEQUENTIAL FETCH to prevent flooding the API and causing timeouts
                int fetchCount = 0;
                int successCount = 0;
                
                foreach (var colonistId in colonistIds)
                {
                    if (!dataCache.HasPortraitCached(colonistId))
                    {
                        fetchCount++;
                        // Await each request individually
                        var (id, portrait) = await FetchColonistPortraitAsync(colonistId);
                        if (!string.IsNullOrEmpty(portrait))
                        {
                            dataCache.CachePortrait(id, portrait);
                            successCount++;
                        }
                        
                        // Small delay to be gentle
                        await Task.Delay(50); 
                    }
                }

                if (successCount > 0)
                {
                    Log.Message($"[Player Storyteller] Successfully fetched {successCount}/{fetchCount} colonist portraits");
                }

                // Build JSON with all cached portraits
                cachedPortraits = dataCache.GetAllCachedPortraits();
                var sb = new StringBuilder(capacity: cachedPortraits.Count * 256);
                sb.Append("{");
                bool first = true;
                foreach (var kvp in cachedPortraits)
                {
                    // Only include portraits for current colonists
                    if (!colonistIds.Contains(kvp.Key)) continue;

                    if (!first) sb.Append(',');
                    sb.Append("\"");
                    sb.Append(kvp.Key);
                    sb.Append("\":\"");
                    sb.Append(kvp.Value);
                    sb.Append("\"");
                    first = false;
                }
                sb.Append("}");

                dataCache.SetPortraits(sb.ToString());

                if (successCount > 0) // Only log if we actually updated something
                {
                    Log.Message($"[Player Storyteller] Portrait cache updated: {cachedPortraits.Count} portraits");
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in UpdatePortraitsAsync: {ex.Message}");
            }
        }

        private async Task<(string id, string portrait)> FetchColonistPortraitAsync(string pawnId)
        {
            try
            {
                // RIMAPI portrait endpoint uses GET (not POST)
                // URL encode the pawn ID in case it contains special characters
                string encodedPawnId = Uri.EscapeDataString(pawnId);
                string url = $"{RimApiBaseUrl}/pawn/portrait/image?pawn_id={encodedPawnId}&width=64&height=64&direction=south";

                var response = await rimapiClient.GetAsync(url);

                if (response.IsSuccessStatusCode)
                {
                    var jsonResponse = await response.Content.ReadAsStringAsync();

                    // Extract base64 image from JSON (simple string search)
                    // Looking for "image":"..." or "base64":"..." or "image_base64":"..."
                    string[] possibleKeys = { "\"image\":\"", "\"base64\":\"", "\"image_base64\":\"" };
                    foreach (var key in possibleKeys)
                    {
                        int imageIndex = jsonResponse.IndexOf(key);
                        if (imageIndex != -1)
                        {
                            int startIndex = imageIndex + key.Length;
                            int endIndex = jsonResponse.IndexOf("\"", startIndex);
                            if (endIndex != -1)
                            {
                                string base64Image = jsonResponse.Substring(startIndex, endIndex - startIndex);
                                return (pawnId, base64Image);
                            }
                        }
                    }
                }

                return (pawnId, null);
            }
            catch (Exception ex)
            {
                Log.Warning($"[Player Storyteller] Failed to fetch portrait for colonist {pawnId}: {ex.Message}");
                return (pawnId, null);
            }
        }

        #endregion

        #region Inventory Data

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

                // Parse colonist IDs
                var colonistIds = ExtractColonistIds(colonistsData);

                if (colonistIds.Count == 0) return;

                // Fetch inventory for all colonists in parallel
                var inventoryTasks = colonistIds.Select(id => apiClient.GetColonistInventory(id)).ToList();
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

        #region Helper Methods

        /// <summary>
        /// Extracts colonist IDs from JSON data using simple string parsing.
        /// Avoids JSON library dependency.
        /// </summary>
        private List<string> ExtractColonistIds(string colonistsData)
        {
            var colonistIds = new List<string>();
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
                // Remove quotes if present (handle both numeric and string IDs)
                idValue = idValue.Trim('"', ' ', '\t', '\n', '\r');

                if (!string.IsNullOrEmpty(idValue))
                {
                    colonistIds.Add(idValue);
                }

                startIndex = valueEnd;
            }

            return colonistIds;
        }

        #endregion
    }
}
