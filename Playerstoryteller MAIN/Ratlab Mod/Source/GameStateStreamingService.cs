using System;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using Verse;
using RimWorld;

namespace PlayerStoryteller
{
    /// <summary>
    /// Manages game state streaming to the server.
    /// WINDOW CAPTURE MODE: Video is captured externally by Go sidecar.
    /// This service only sends JSON game state (colonists, resources, etc).
    /// </summary>
    public class GameStateStreamingService
    {
        private readonly GameDataCache dataCache;
        private readonly Map map;

        // Cached view rect for background thread access
        private CellRect cachedViewRect;

        public GameStateStreamingService(GameDataCache dataCache, Map map)
        {
            this.dataCache = dataCache;
            this.map = map;
        }

        /// <summary>
        /// Captures camera bounds and sends game state to server.
        /// Must be called from main thread.
        /// </summary>
        public async Task SendGameState()
        {
            try
            {
                // Capture camera bounds on main thread
                cachedViewRect = Find.CameraDriver.CurrentViewRect;

                // Get cached game data snapshot (thread-safe)
                var snapshot = dataCache.GetSnapshot();

                // Use cached bounds to avoid Unity API call on background thread
                // Build camera bounds as JObject to avoid string interpolation in hot path
                CellRect viewRect = cachedViewRect;
                var cameraBoundsObj = new JObject();
                cameraBoundsObj["minX"] = viewRect.minX;
                cameraBoundsObj["maxX"] = viewRect.maxX;
                cameraBoundsObj["minZ"] = viewRect.minZ;
                cameraBoundsObj["maxZ"] = viewRect.maxZ;
                cameraBoundsObj["width"] = viewRect.Width;
                cameraBoundsObj["height"] = viewRect.Height;
                string cameraBounds = cameraBoundsObj.ToString(Newtonsoft.Json.Formatting.None);

                // Move heavy processing OFF main thread
                string combinedGameState = await Task.Run(() =>
                {
                    // Merge JSON strings off main thread (including portraits)
                    return dataCache.GetCombinedSnapshot(cameraBounds);
                });

                // Send Game State to server via WebSocket (Async, Non-blocking)
                // This acts as the HEARTBEAT and provides game state to viewers
                // Video is captured externally by Go sidecar
                PlayerStorytellerMod.SendStreamingUpdateAsync(null, 0, combinedGameState);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in SendGameState: {ex.Message}\n{ex.StackTrace}");
            }
        }

        /// <summary>
        /// Cleanup resources when map is removed.
        /// </summary>
        public void Cleanup()
        {
            // Nothing to clean up anymore - window capture is external
        }
    }
}
