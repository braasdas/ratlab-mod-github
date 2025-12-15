using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Verse;
using Newtonsoft.Json.Linq;

namespace PlayerStoryteller
{
    /// <summary>
    /// Manages fetching and caching of item icons for the UI.
    /// Icons are cached aggressively to avoid redundant fetches.
    /// </summary>
    public class ItemIconManager
    {
        private static readonly HttpClient rimapiClient = new HttpClient();
        private const string RimApiBaseUrl = "http://localhost:8765/api/v1";
        private const int HttpTimeoutMilliseconds = 500;

        private readonly GameDataCache dataCache;

        public ItemIconManager(GameDataCache dataCache)
        {
            this.dataCache = dataCache;

            // Set timeout for HTTP client
            if (rimapiClient.Timeout != TimeSpan.FromMilliseconds(HttpTimeoutMilliseconds))
            {
                rimapiClient.Timeout = TimeSpan.FromMilliseconds(HttpTimeoutMilliseconds);
            }
        }

        /// <summary>
        /// Updates item icons by fetching icons for items in inventory and storage.
        /// Only fetches icons that aren't already cached.
        /// Should be called every 5-10 seconds.
        /// </summary>
        public async Task UpdateItemIconsAsync()
        {
            try
            {
                // Collect ALL unique defNames from stored resources and inventories
                var defNamesToFetch = new HashSet<string>();

                // Add action panel items (always needed)
                foreach (var defName in dataCache.ActionItemDefs)
                {
                    defNamesToFetch.Add(defName);
                }

                // Parse stored resources from cached data to extract defNames
                string storedResourcesData = dataCache.GetStoredResources();

                if (!string.IsNullOrEmpty(storedResourcesData) && storedResourcesData != "{}")
                {
                    // Extract def_name fields from JSON
                    ExtractDefNamesFromJson(storedResourcesData, defNamesToFetch);
                }

                // Parse inventory data from cached data to extract defNames
                string inventoryData = dataCache.GetInventoryData();

                if (!string.IsNullOrEmpty(inventoryData) && inventoryData != "{}")
                {
                    // Extract defName fields from JSON
                    ExtractDefNamesFromJson(inventoryData, defNamesToFetch);
                }

                // Only fetch icons we don't already have
                var defNamesToFetchNow = defNamesToFetch.Where(defName => !dataCache.HasItemIconCached(defName)).ToList();

                if (defNamesToFetchNow.Count > 0)
                {
                    // Fetch in batches of 10 to avoid overwhelming RimAPI
                    const int batchSize = 10;
                    int successCount = 0;

                    for (int i = 0; i < defNamesToFetchNow.Count; i += batchSize)
                    {
                        var batch = defNamesToFetchNow.Skip(i).Take(batchSize).ToList();
                        var iconTasks = batch.Select(defName => FetchItemIconAsync(defName)).ToList();
                        var results = await Task.WhenAll(iconTasks);

                        foreach (var (defName, icon) in results)
                        {
                            if (!string.IsNullOrEmpty(icon))
                            {
                                dataCache.CacheItemIcon(defName, icon);
                                successCount++;
                            }
                        }

                        // Small delay between batches
                        if (i + batchSize < defNamesToFetchNow.Count)
                        {
                            await Task.Delay(100);
                        }
                    }

                    if (successCount > 0)
                    {
                        var allCachedIcons = dataCache.GetAllCachedItemIcons();
                        Log.Message($"[Player Storyteller] Fetched {successCount} new item icons (total cached: {allCachedIcons.Count})");
                    }
                }

                // Build JSON with all cached icons
                var allIcons = dataCache.GetAllCachedItemIcons();
                var sb = new StringBuilder(capacity: allIcons.Count * 1024);
                sb.Append("{");
                bool first = true;
                foreach (var kvp in allIcons)
                {
                    if (!first) sb.Append(',');
                    sb.Append("\"");
                    sb.Append(kvp.Key);
                    sb.Append("\":\"");
                    sb.Append(kvp.Value);
                    sb.Append("\"");
                    first = false;
                }
                sb.Append("}");

                dataCache.SetItemIcons(sb.ToString());
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in UpdateItemIconsAsync: {ex}");
            }
        }

        #region Private Helper Methods

        /// <summary>
        /// Extracts defName/def_name fields from JSON string using JSON.NET.
        /// </summary>
        private void ExtractDefNamesFromJson(string json, HashSet<string> defNames)
        {
            if (string.IsNullOrEmpty(json)) return;

            try
            {
                var token = JToken.Parse(json);

                // Recursively search for def_name or defName properties
                ExtractDefNamesRecursive(token, defNames);
            }
            catch (Exception ex)
            {
                Log.Warning($"[Player Storyteller] Failed to parse JSON for defNames: {ex.Message}");
            }
        }

        /// <summary>
        /// Recursively extracts defName/def_name fields from a JSON token.
        /// </summary>
        private void ExtractDefNamesRecursive(JToken token, HashSet<string> defNames)
        {
            if (token is JObject obj)
            {
                foreach (var property in obj.Properties())
                {
                    if ((property.Name == "def_name" || property.Name == "defName") && property.Value.Type == JTokenType.String)
                    {
                        string defName = property.Value.ToString();
                        if (!string.IsNullOrEmpty(defName))
                        {
                            defNames.Add(defName);
                        }
                    }
                    else
                    {
                        ExtractDefNamesRecursive(property.Value, defNames);
                    }
                }
            }
            else if (token is JArray array)
            {
                foreach (var item in array)
                {
                    ExtractDefNamesRecursive(item, defNames);
                }
            }
        }

        /// <summary>
        /// Fetches a single item icon from RimAPI.
        /// </summary>
        private async Task<(string defName, string icon)> FetchItemIconAsync(string defName)
        {
            try
            {
                string encodedDefName = Uri.EscapeDataString(defName);
                string url = $"{RimApiBaseUrl}/item/image?name={encodedDefName}";

                var response = await rimapiClient.GetAsync(url);

                if (response.IsSuccessStatusCode)
                {
                    var jsonResponse = await response.Content.ReadAsStringAsync();

                    // Extract base64 image from JSON
                    // Looking for "image":"..." or "base64":"..." or "image_base64":"..."
                    string[] possibleKeys = { "\"image\":\"", "\"base64\":\"", "\"image_base64\":\"" };
                    foreach (var key in possibleKeys)
                    {
                        int imageIndex = jsonResponse.IndexOf(key);
                        if (imageIndex != -1)
                        {
                            int imageStart = imageIndex + key.Length;
                            int imageEnd = jsonResponse.IndexOf("\"", imageStart);
                            if (imageEnd != -1)
                            {
                                string base64Image = jsonResponse.Substring(imageStart, imageEnd - imageStart);
                                return (defName, base64Image);
                            }
                        }
                    }
                }
            }
            catch (Exception)
            {
                // Silently fail for item icons
            }

            return (defName, null);
        }

        #endregion
    }
}
