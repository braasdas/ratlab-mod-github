using System;
using System.Collections.Generic;
using System.Text;
using Verse;

namespace PlayerStoryteller
{
    /// <summary>
    /// Thread-safe storage for all cached game state data.
    /// Manages multiple data tiers with different update frequencies.
    /// </summary>
    public class GameDataCache
    {
        // Cached data from different polling tiers
        private string cachedFastData = "{}";      // Colonists - updates frequently
        private string cachedSlowData = "{}";      // Resources, power, creatures - updates slowly
        private string cachedStoredResources = "{}"; // Stored resources - updates slowly
        private string cachedStaticData = "{}";    // Factions, research projects - rarely changes
        private string cachedInventoryData = "{}"; // Colonist inventory - updates slowly
        private string cachedPortraits = "{}";     // Colonist portraits - updates rarely
        private string cachedItemIcons = "{}";     // Item icons for action panel - updates rarely
        private string cachedDLCData = "{}";       // Active DLCs - set once
        private string cachedPawnViews = "{}";     // Pawn views - updates frequently

        private readonly object dataLock = new object();

        public GameDataCache()
        {
            // Initialize DLC data once on startup
            cachedDLCData = DLCHelper.GetActiveDLCsJson();
        }

        // Portrait and item icon caches
        private readonly Dictionary<string, string> colonistPortraitCache = new Dictionary<string, string>();
        private readonly Dictionary<string, string> itemIconCache = new Dictionary<string, string>();

        // Action item definitions for icon caching
        public readonly List<string> ActionItemDefs = new List<string>
        {
            "MealSurvivalPack",
            "MedicineIndustrial",
            "Steel",
            "ComponentIndustrial",
            "Silver"
        };

        #region Thread-Safe Getters and Setters

        public void SetFastData(string data)
        {
            lock (dataLock)
            {
                cachedFastData = data ?? "{}";
            }
        }

        public void SetSlowData(string data)
        {
            lock (dataLock)
            {
                cachedSlowData = data ?? "{}";
            }
        }

        public void SetStoredResources(string data)
        {
            lock (dataLock)
            {
                cachedStoredResources = data ?? "{}";
            }
        }

        public void SetStaticData(string data)
        {
            lock (dataLock)
            {
                cachedStaticData = data ?? "{}";
            }
        }

        public void SetInventoryData(string data)
        {
            lock (dataLock)
            {
                cachedInventoryData = data ?? "{}";
            }
        }

        public void SetPortraits(string data)
        {
            lock (dataLock)
            {
                cachedPortraits = data ?? "{}";
            }
        }

        public void SetItemIcons(string data)
        {
            lock (dataLock)
            {
                cachedItemIcons = data ?? "{}";
            }
        }

        public void SetPawnViews(string data)
        {
            lock (dataLock)
            {
                cachedPawnViews = data ?? "{}";
            }
        }

        public string GetFastData()
        {
            lock (dataLock)
            {
                return cachedFastData;
            }
        }

        public string GetSlowData()
        {
            lock (dataLock)
            {
                return cachedSlowData;
            }
        }

        public string GetStoredResources()
        {
            lock (dataLock)
            {
                return cachedStoredResources;
            }
        }

        public string GetStaticData()
        {
            lock (dataLock)
            {
                return cachedStaticData;
            }
        }

        public string GetInventoryData()
        {
            lock (dataLock)
            {
                return cachedInventoryData;
            }
        }

        public string GetPortraits()
        {
            lock (dataLock)
            {
                return cachedPortraits;
            }
        }

        public string GetItemIcons()
        {
            lock (dataLock)
            {
                return cachedItemIcons;
            }
        }

        public string GetPawnViews()
        {
            lock (dataLock)
            {
                return cachedPawnViews;
            }
        }

        #endregion

        #region Portrait and Icon Cache Management

        public bool HasPortraitCached(string colonistId)
        {
            lock (dataLock)
            {
                return colonistPortraitCache.ContainsKey(colonistId);
            }
        }

        public void CachePortrait(string colonistId, string base64Portrait)
        {
            lock (dataLock)
            {
                colonistPortraitCache[colonistId] = base64Portrait;
            }
        }

        public string GetCachedPortrait(string colonistId)
        {
            lock (dataLock)
            {
                return colonistPortraitCache.TryGetValue(colonistId, out var portrait) ? portrait : null;
            }
        }

        public bool HasItemIconCached(string defName)
        {
            lock (dataLock)
            {
                return itemIconCache.ContainsKey(defName);
            }
        }

        public void CacheItemIcon(string defName, string base64Icon)
        {
            lock (dataLock)
            {
                itemIconCache[defName] = base64Icon;
            }
        }

        public string GetCachedItemIcon(string defName)
        {
            lock (dataLock)
            {
                return itemIconCache.TryGetValue(defName, out var icon) ? icon : null;
            }
        }

        public Dictionary<string, string> GetAllCachedPortraits()
        {
            lock (dataLock)
            {
                return new Dictionary<string, string>(colonistPortraitCache);
            }
        }

        public Dictionary<string, string> GetAllCachedItemIcons()
        {
            lock (dataLock)
            {
                return new Dictionary<string, string>(itemIconCache);
            }
        }

        #endregion

        #region Snapshot Generation

        /// <summary>
        /// Creates a thread-safe snapshot of all cached data.
        /// This method can be called from background threads.
        /// </summary>
        public (string fast, string slow, string staticData, string portraits, string inventory, string storedResources, string itemIcons, string dlcData, string pawnViews) GetSnapshot()
        {
            lock (dataLock)
            {
                return (
                    cachedFastData,
                    cachedSlowData,
                    cachedStaticData,
                    cachedPortraits,
                    cachedInventoryData,
                    cachedStoredResources,
                    cachedItemIcons,
                    cachedDLCData,
                    cachedPawnViews
                );
            }
        }

        /// <summary>
        /// Merges all cached data into a single JSON object.
        /// Can be called from background threads - does not access Unity objects.
        /// </summary>
        public string GetCombinedSnapshot(string cameraBounds)
        {
            var snapshot = GetSnapshot();
            return MergeCachedDataOffThread(
                snapshot.fast,
                snapshot.slow,
                snapshot.staticData,
                snapshot.portraits,
                snapshot.inventory,
                snapshot.storedResources,
                snapshot.itemIcons,
                snapshot.dlcData,
                snapshot.pawnViews,
                cameraBounds
            );
        }

        private string MergeCachedDataOffThread(string fast, string slow, string staticStr, string portraits, string inventory, string storedResources, string itemIcons, string dlcData, string pawnViews, string cameraBounds)
        {
            // PERFORMANCE FIX: Use StringBuilder instead of string concatenation
            // This runs on a background thread - safe to do heavy string manipulation
            var sb = new StringBuilder(capacity: 2048);
            sb.Append("{");

            bool hasContent = false;

            if (!string.IsNullOrEmpty(fast) && fast != "{}")
            {
                string trimmed = fast.Trim();
                if (trimmed.Length > 2)
                {
                    sb.Append(trimmed, 1, trimmed.Length - 2); // Skip outer braces
                    hasContent = true;
                }
            }

            if (!string.IsNullOrEmpty(slow) && slow != "{}")
            {
                string trimmed = slow.Trim();
                if (trimmed.Length > 2)
                {
                    if (hasContent) sb.Append(',');
                    sb.Append(trimmed, 1, trimmed.Length - 2);
                    hasContent = true;
                }
            }

            if (!string.IsNullOrEmpty(staticStr) && staticStr != "{}")
            {
                string trimmed = staticStr.Trim();
                if (trimmed.Length > 2)
                {
                    if (hasContent) sb.Append(',');
                    sb.Append(trimmed, 1, trimmed.Length - 2);
                    hasContent = true;
                }
            }

            // Add colonist portraits
            if (!string.IsNullOrEmpty(portraits) && portraits != "{}")
            {
                string trimmed = portraits.Trim();
                if (trimmed.Length > 2)
                {
                    if (hasContent) sb.Append(',');
                    sb.Append("\"colonist_portraits\":");
                    sb.Append(trimmed);
                    hasContent = true;
                }
            }

            // Add colonist inventory data
            if (!string.IsNullOrEmpty(inventory) && inventory != "{}")
            {
                string trimmed = inventory.Trim();
                if (trimmed.Length > 2)
                {
                    if (hasContent) sb.Append(',');
                    sb.Append("\"inventory\":");
                    sb.Append(trimmed);
                    hasContent = true;
                }
            }

            // Add stored resources data
            if (!string.IsNullOrEmpty(storedResources) && storedResources != "{}")
            {
                string trimmed = storedResources.Trim();
                if (trimmed.Length > 2)
                {
                    if (hasContent) sb.Append(',');
                    sb.Append("\"stored_resources\":");
                    sb.Append(trimmed);
                    hasContent = true;
                }
            }

            // Add item icons
            if (!string.IsNullOrEmpty(itemIcons) && itemIcons != "{}")
            {
                string trimmed = itemIcons.Trim();
                if (trimmed.Length > 2)
                {
                    if (hasContent) sb.Append(',');
                    sb.Append("\"item_icons\":");
                    sb.Append(trimmed);
                    hasContent = true;
                }
            }

            // Add pawn views
            if (!string.IsNullOrEmpty(pawnViews) && pawnViews != "{}")
            {
                string trimmed = pawnViews.Trim();
                if (trimmed.Length > 2)
                {
                    if (hasContent) sb.Append(',');
                    sb.Append("\"pawn_views\":");
                    sb.Append(trimmed);
                    hasContent = true;
                }
            }

            // Add active DLCs
            if (!string.IsNullOrEmpty(dlcData) && dlcData != "{}")
            {
                if (hasContent) sb.Append(',');
                sb.Append("\"active_dlcs\":");
                sb.Append(dlcData);
                hasContent = true;
            }

            // Add camera bounds
            if (!string.IsNullOrEmpty(cameraBounds) && cameraBounds != "{}")
            {
                string trimmed = cameraBounds.Trim();
                if (trimmed.Length > 2)
                {
                    if (hasContent) sb.Append(',');
                    sb.Append("\"camera\":");
                    sb.Append(trimmed);
                    hasContent = true;
                }
            }

            sb.Append("}");
            return sb.ToString();
        }

        #endregion
    }
}
