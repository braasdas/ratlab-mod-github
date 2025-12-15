using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
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

        private readonly Queue<string> pendingPortraits = new Queue<string>();
        private readonly HashSet<string> queuedPortraitIds = new HashSet<string>();

        /// <summary>
        /// Updates colonist portraits. Identifies missing portraits and fetches them one by one (throttled).
        /// Should be called frequently (e.g. every 2-3 seconds).
        /// </summary>
        public async Task UpdatePortraitsAsync()
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

                // Identify missing portraits and add to queue
                foreach (var colonistId in colonistIds)
                {
                    if (!dataCache.HasPortraitCached(colonistId) && !queuedPortraitIds.Contains(colonistId))
                    {
                        pendingPortraits.Enqueue(colonistId);
                        queuedPortraitIds.Add(colonistId);
                        Log.Message($"[Player Storyteller] Portrait queued for fetch: {colonistId}");
                    }
                }

                // Process ONE item from the queue (Throttling)
                if (pendingPortraits.Count > 0)
                {
                    string idToFetch = pendingPortraits.Dequeue();
                    queuedPortraitIds.Remove(idToFetch);

                    // Fetch
                    var (id, portrait) = await FetchColonistPortraitAsync(idToFetch);
                    if (!string.IsNullOrEmpty(portrait))
                    {
                        dataCache.CachePortrait(id, portrait);
                        // Log.Message($"[Player Storyteller] Portrait fetched: {id}");
                    }
                }

                // Build JSON with all cached portraits (ALWAYS update this to ensure cache consistency)
                var cachedPortraits = dataCache.GetAllCachedPortraits();
                var sb = new StringBuilder(capacity: cachedPortraits.Count * 256);
                sb.Append("{");
                bool first = true;
                foreach (var kvp in cachedPortraits)
                {
                    // Only include portraits for current colonists (cleanup)
                    // if (!colonistIds.Contains(kvp.Key)) continue; 
                    // Actually, keep them cached for now to avoid re-fetching if they flicker

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
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in UpdatePortraitsAsync: {ex}");
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



        #region Helper Methods

        /// <summary>
        /// Extracts colonist IDs from JSON data using Newtonsoft.Json.
        /// </summary>
        private List<string> ExtractColonistIds(string colonistsData)
        {
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
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error parsing colonist IDs: {ex}");
            }

            return colonistIds;
        }

        #endregion
    }
}
