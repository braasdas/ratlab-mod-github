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
        private string cachedAnimalData = "{}";    // Animals - updates frequently
        private string cachedSlowData = "{}";      // Resources, power, creatures - updates slowly
        private string cachedStoredResources = "{}"; // Stored resources - updates slowly
        private string cachedStaticData = "{}";    // Factions, research projects - rarely changes
        private string cachedInventoryData = "{}"; // Colonist inventory - updates slowly
        private string cachedPortraits = "{}";     // Colonist portraits - updates rarely
        private string cachedItemIcons = "{}";     // Item icons for action panel - updates rarely
        private string cachedDLCData = "{}";       // Active DLCs - set once
        private string cachedPawnViews = "{}";     // Pawn views - updates frequently

        private readonly System.Threading.ReaderWriterLockSlim rwLock = new System.Threading.ReaderWriterLockSlim();

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
            rwLock.EnterWriteLock();
            try
            {
                cachedFastData = data ?? "{}";
            }
            finally
            {
                rwLock.ExitWriteLock();
            }
        }

        public void SetAnimalData(string data)
        {
            rwLock.EnterWriteLock();
            try
            {
                cachedAnimalData = data ?? "{}";
            }
            finally
            {
                rwLock.ExitWriteLock();
            }
        }

        public void SetSlowData(string data)
        {
            rwLock.EnterWriteLock();
            try
            {
                cachedSlowData = data ?? "{}";
            }
            finally
            {
                rwLock.ExitWriteLock();
            }
        }

        public void SetStoredResources(string data)
        {
            rwLock.EnterWriteLock();
            try
            {
                cachedStoredResources = data ?? "{}";
            }
            finally
            {
                rwLock.ExitWriteLock();
            }
        }

        public void SetStaticData(string data)
        {
            rwLock.EnterWriteLock();
            try
            {
                cachedStaticData = data ?? "{}";
            }
            finally
            {
                rwLock.ExitWriteLock();
            }
        }

        public void SetInventoryData(string data)
        {
            rwLock.EnterWriteLock();
            try
            {
                cachedInventoryData = data ?? "{}";
            }
            finally
            {
                rwLock.ExitWriteLock();
            }
        }

        public void SetPortraits(string data)
        {
            rwLock.EnterWriteLock();
            try
            {
                cachedPortraits = data ?? "{}";
            }
            finally
            {
                rwLock.ExitWriteLock();
            }
        }

        public void SetItemIcons(string data)
        {
            rwLock.EnterWriteLock();
            try
            {
                cachedItemIcons = data ?? "{}";
            }
            finally
            {
                rwLock.ExitWriteLock();
            }
        }

        public void SetPawnViews(string data)
        {
            rwLock.EnterWriteLock();
            try
            {
                cachedPawnViews = data ?? "{}";
            }
            finally
            {
                rwLock.ExitWriteLock();
            }
        }

        public string GetFastData()
        {
            rwLock.EnterReadLock();
            try
            {
                return cachedFastData;
            }
            finally
            {
                rwLock.ExitReadLock();
            }
        }

        public string GetAnimalData()
        {
            rwLock.EnterReadLock();
            try
            {
                return cachedAnimalData;
            }
            finally
            {
                rwLock.ExitReadLock();
            }
        }

        public string GetSlowData()
        {
            rwLock.EnterReadLock();
            try
            {
                return cachedSlowData;
            }
            finally
            {
                rwLock.ExitReadLock();
            }
        }

        public string GetStoredResources()
        {
            rwLock.EnterReadLock();
            try
            {
                return cachedStoredResources;
            }
            finally
            {
                rwLock.ExitReadLock();
            }
        }

        public string GetStaticData()
        {
            rwLock.EnterReadLock();
            try
            {
                return cachedStaticData;
            }
            finally
            {
                rwLock.ExitReadLock();
            }
        }

        public string GetInventoryData()
        {
            rwLock.EnterReadLock();
            try
            {
                return cachedInventoryData;
            }
            finally
            {
                rwLock.ExitReadLock();
            }
        }

        public string GetPortraits()
        {
            rwLock.EnterReadLock();
            try
            {
                return cachedPortraits;
            }
            finally
            {
                rwLock.ExitReadLock();
            }
        }

        public string GetItemIcons()
        {
            rwLock.EnterReadLock();
            try
            {
                return cachedItemIcons;
            }
            finally
            {
                rwLock.ExitReadLock();
            }
        }

        public string GetPawnViews()
        {
            rwLock.EnterReadLock();
            try
            {
                return cachedPawnViews;
            }
            finally
            {
                rwLock.ExitReadLock();
            }
        }

        #endregion

        #region Portrait and Icon Cache Management

        public bool HasPortraitCached(string colonistId)
        {
            rwLock.EnterReadLock();
            try
            {
                return colonistPortraitCache.ContainsKey(colonistId);
            }
            finally
            {
                rwLock.ExitReadLock();
            }
        }

        public void CachePortrait(string colonistId, string base64Portrait)
        {
            rwLock.EnterWriteLock();
            try
            {
                colonistPortraitCache[colonistId] = base64Portrait;
            }
            finally
            {
                rwLock.ExitWriteLock();
            }
        }

        public string GetCachedPortrait(string colonistId)
        {
            rwLock.EnterReadLock();
            try
            {
                return colonistPortraitCache.TryGetValue(colonistId, out var portrait) ? portrait : null;
            }
            finally
            {
                rwLock.ExitReadLock();
            }
        }

        public bool HasItemIconCached(string defName)
        {
            rwLock.EnterReadLock();
            try
            {
                return itemIconCache.ContainsKey(defName);
            }
            finally
            {
                rwLock.ExitReadLock();
            }
        }

        public void CacheItemIcon(string defName, string base64Icon)
        {
            rwLock.EnterWriteLock();
            try
            {
                itemIconCache[defName] = base64Icon;
            }
            finally
            {
                rwLock.ExitWriteLock();
            }
        }

        public string GetCachedItemIcon(string defName)
        {
            rwLock.EnterReadLock();
            try
            {
                return itemIconCache.TryGetValue(defName, out var icon) ? icon : null;
            }
            finally
            {
                rwLock.ExitReadLock();
            }
        }

        public Dictionary<string, string> GetAllCachedPortraits()
        {
            rwLock.EnterReadLock();
            try
            {
                return new Dictionary<string, string>(colonistPortraitCache);
            }
            finally
            {
                rwLock.ExitReadLock();
            }
        }

        public Dictionary<string, string> GetAllCachedItemIcons()
        {
            rwLock.EnterReadLock();
            try
            {
                return new Dictionary<string, string>(itemIconCache);
            }
            finally
            {
                rwLock.ExitReadLock();
            }
        }

        #endregion

        #region Snapshot Generation

        /// <summary>
        /// Creates a thread-safe snapshot of all cached data.
        /// This method can be called from background threads.
        /// </summary>
        public (string fast, string animal, string slow, string staticData, string portraits, string inventory, string storedResources, string itemIcons, string dlcData, string pawnViews) GetSnapshot()
        {
            rwLock.EnterReadLock();
            try
            {
                return (
                    cachedFastData,
                    cachedAnimalData,
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
            finally
            {
                rwLock.ExitReadLock();
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
                snapshot.animal,
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

        private string MergeCachedDataOffThread(string fast, string animal, string slow, string staticStr, string portraits, string inventory, string storedResources, string itemIcons, string dlcData, string pawnViews, string cameraBounds)
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

            if (!string.IsNullOrEmpty(animal) && animal != "{}")
            {
                string trimmed = animal.Trim();
                if (trimmed.Length > 2)
                {
                    if (hasContent) sb.Append(',');
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
