using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Verse;
using RimWorld;
using UnityEngine;

namespace PlayerStoryteller
{
    public class PlayerStorytellerMapComponent : MapComponent
    {
        // CONFIGURATION CONSTANTS
        private const float ActionPollInterval = 2f; // Check for actions every 2 seconds
        private const int HttpTimeoutMilliseconds = 500; // RimAPI timeout (local calls should be fast)
        private const float GameStateUpdateInterval = 0.1f; // Send game state JSON every 100ms (10 Hz)
        private const float MinFastDataInterval = 0.1f; // Minimum fast data polling interval (Reduced for smooth tracking)
        private const float MinSlowDataInterval = 1f; // Minimum slow data polling interval
        private const float MinStaticDataInterval = 10f; // Minimum static data polling interval

        private static readonly HttpClient rimapiClient = new HttpClient();
        private Coroutine gameStateCoroutine;
        private Coroutine fastDataCoroutine;
        private Coroutine slowDataCoroutine;
        private Coroutine staticDataCoroutine;
        private Coroutine portraitCoroutine;
        private Coroutine actionCoroutine;
        private Coroutine sidecarMonitorCoroutine;
        private Coroutine settingsPollCoroutine;
        private Coroutine mapCaptureCoroutine;
        private Coroutine liveViewCoroutine; // ULTRAFAST TIER
        private Coroutine positionPollCoroutine; // ULTRAFAST TIER (Positions)
        private Coroutine heavyDataCoroutine; // HEAVY DATA TIER

        // HELPER CLASSES
        private SidecarManager sidecarManager;
        private GameDataCache gameDataCache;
        private RimApiClient apiClient;
        private GameDataPoller gameDataPoller;
        private ViewerActionProcessor viewerActionProcessor;
        private ActionSecurityManager actionSecurityManager;
        private GameActionExecutor gameActionExecutor;
        private GameStateStreamingService gameStateStreamingService;
        private ColonistDataPoller colonistDataPoller;
        private ItemIconManager itemIconManager;
        
        // MAP CAPTURE
        private MapCaptureManager mapCaptureManager;
        private ViewerManager viewerManager; // Added

        public PlayerStorytellerMapComponent(Map map) : base(map)
        {
            if(rimapiClient.Timeout != TimeSpan.FromMilliseconds(HttpTimeoutMilliseconds))
            {
                rimapiClient.Timeout = TimeSpan.FromMilliseconds(HttpTimeoutMilliseconds);
            }
        }

        public override void ExposeData()
        {
            base.ExposeData();
            // Component state is managed by coroutines, nothing to save/load
        }

        public override void MapRemoved()
        {
            base.MapRemoved();
            // Cleanup resources
            if (gameStateStreamingService != null)
            {
                gameStateStreamingService.Cleanup();
                gameStateStreamingService = null;
            }

            if (sidecarManager != null)
            {
                sidecarManager.Stop();
                sidecarManager = null;
            }
            
            if (mapCaptureManager != null)
            {
                mapCaptureManager.Cleanup();
                mapCaptureManager = null;
            }

            Log.Message("[Player Storyteller] Map component cleaned up (window capture mode)");
        }

        public override void MapComponentTick()
        {
            base.MapComponentTick();
            // Process actions on main thread
            viewerActionProcessor?.ProcessQueuedActions();
            // Process sidecar notifications (GPU driver warnings, etc.)
            SidecarManager.ProcessPendingNotifications();
        }

        public override void FinalizeInit()
        {
            base.FinalizeInit();

            // Reset connection on map load
            PlayerStorytellerMod.ResetConnection();

            // Initialize Helpers
            sidecarManager = new SidecarManager();
            gameDataCache = new GameDataCache();
            apiClient = new RimApiClient(); // Assumes default URL

            // Get Viewer Manager (MapComponent)
            viewerManager = map.GetComponent<ViewerManager>();

            // Initialize Logic Classes
            gameDataPoller = new GameDataPoller(apiClient, gameDataCache, map);
            actionSecurityManager = new ActionSecurityManager();
            viewerActionProcessor = new ViewerActionProcessor(actionSecurityManager, map);
            gameActionExecutor = new GameActionExecutor(map);

            // Wire up Action Processor to Executor
            viewerActionProcessor.SetActionHandler(gameActionExecutor.ExecuteAction);

            // Initialize Game State Streaming Service (WINDOW CAPTURE MODE)
            gameStateStreamingService = new GameStateStreamingService(gameDataCache, map);

            // Initialize Colonist Poller (for portraits)
            colonistDataPoller = new ColonistDataPoller(apiClient, gameDataCache, map);

            // Initialize Item Icon Manager
            itemIconManager = new ItemIconManager(gameDataCache);
            
            // Initialize Map Capture Manager
            mapCaptureManager = new MapCaptureManager();
            mapCaptureManager.SetCaptureCallback((data) => 
            {
                PlayerStorytellerMod.SendMapUpdateAsync(data);
            });

            // Ensure we have a coroutine handler
            if (map.GetComponent<CoroutineHandler>() == null)
            {
                var handler = new CoroutineHandler(map);
                map.components.Add(handler);
            }

            // Start Coroutines
            StartCoroutines();

            Log.Message("[Player Storyteller] Map component initialized with refactored architecture.");
        }

        private void StartCoroutines()
        {
            var handlerComponent = map.GetComponent<CoroutineHandler>();
            if (handlerComponent != null && gameStateCoroutine == null)
            {
                gameStateCoroutine = handlerComponent.StartCoroutine(GameStateCoroutine());
                fastDataCoroutine = handlerComponent.StartCoroutine(FastDataPollCoroutine());
                slowDataCoroutine = handlerComponent.StartCoroutine(SlowDataPollCoroutine());
                staticDataCoroutine = handlerComponent.StartCoroutine(StaticDataPollCoroutine());
                portraitCoroutine = handlerComponent.StartCoroutine(PortraitPollCoroutine());
                actionCoroutine = handlerComponent.StartCoroutine(ActionPollCoroutine());
                sidecarMonitorCoroutine = handlerComponent.StartCoroutine(SidecarMonitorCoroutine());
                settingsPollCoroutine = handlerComponent.StartCoroutine(SettingsPollCoroutine());
                mapCaptureCoroutine = handlerComponent.StartCoroutine(MapCaptureCoroutine());
                liveViewCoroutine = handlerComponent.StartCoroutine(LiveViewPollCoroutine());
                positionPollCoroutine = handlerComponent.StartCoroutine(PositionPollCoroutine());
                heavyDataCoroutine = handlerComponent.StartCoroutine(HeavyDataPollCoroutine());
            }
        }

        // ============================================
        // COROUTINES (Delegating to Helpers)
        // ============================================

        private IEnumerator PositionPollCoroutine()
        {
            yield return new WaitForSeconds(1f);
            while (true)
            {
                try
                {
                    gameDataPoller?.UpdatePawnPositionsAsync();
                }
                catch (Exception ex)
                {
                    Log.Error($"[Player Storyteller] Error in PositionPoll: {ex.Message}");
                }
                yield return new WaitForSecondsRealtime(0.1f); // 10Hz updates
            }
        }

        private IEnumerator LiveViewPollCoroutine()
        {
            yield return new WaitForSeconds(2f);
            while (true)
            {
                try
                {
                    gameDataPoller?.UpdateLiveViewAsync();
                }
                catch (Exception ex)
                {
                    Log.Error($"[Player Storyteller] Error in LiveViewPoll: {ex.Message}");
                }
                yield return new WaitForSecondsRealtime(1.0f); // Reverted to 1Hz
            }
        }

        private IEnumerator HeavyDataPollCoroutine()
        {
            yield return new WaitForSeconds(5f);
            while (true)
            {
                try
                {
                    gameDataPoller?.UpdateColonistDetailsAsync();
                }
                catch (Exception ex)
                {
                    Log.Error($"[Player Storyteller] Error in HeavyDataPoll: {ex.Message}");
                }
                yield return new WaitForSeconds(5.0f);
            }
        }

        private IEnumerator MapCaptureCoroutine()
        {
            Log.Message("[Player Storyteller] MapCaptureCoroutine started.");
            yield return new WaitForSeconds(5f);
            while (true)
            {
                bool shouldCapture = false;
                try
                {
                    shouldCapture = PlayerStorytellerMod.settings.enableMapRender;
                }
                catch (Exception ex)
                {
                    Log.Error($"[Player Storyteller] Error checking map capture settings: {ex.Message}");
                }

                if (shouldCapture && mapCaptureManager != null)
                {
                    // Log.Message("[Player Storyteller] Triggering CaptureFullMapRoutine...");
                    yield return mapCaptureManager.CaptureFullMapRoutine(map, 2048, 2048, 75);
                }
                else
                {
                    if (!shouldCapture) Log.Message("[Player Storyteller] Map capture skipped (Disabled in settings).");
                    if (mapCaptureManager == null) Log.Error("[Player Storyteller] Map capture skipped (Manager is null!)");
                }

                yield return new WaitForSeconds(5f);
            }
        }

        private IEnumerator SidecarMonitorCoroutine()
        {
            yield return new WaitForSeconds(10f);
            string sessionId = PlayerStorytellerMod.GetSessionId();
            if (string.IsNullOrEmpty(sessionId)) sessionId = "default-session";

            while (true)
            {
                try
                {
                    sidecarManager?.EnsureRunning(sessionId, PlayerStorytellerMod.settings.secretKey);
                }
                catch (Exception ex)
                {
                    Log.Error($"[Player Storyteller] Error in SidecarMonitor: {ex.Message}");
                }
                yield return new WaitForSeconds(5f);
            }
        }

        private IEnumerator GameStateCoroutine()
        {
            yield return new WaitForSeconds(1f);
            while (true)
            {
                try
                {
                    // Send game state (video is captured externally by Go sidecar)
                    gameStateStreamingService?.SendGameState();
                }
                catch (Exception ex)
                {
                    Log.Error($"[Player Storyteller] Error in GameStateCoroutine: {ex.Message}");
                }

                yield return new WaitForSecondsRealtime(GameStateUpdateInterval);
            }
        }

        private IEnumerator FastDataPollCoroutine()
        {
            yield return new WaitForSeconds(0.5f);
            while (true)
            {
                try
                {
                    gameDataPoller?.UpdateFastDataAsync();
                }
                catch (Exception ex)
                {
                    Log.Error($"[Player Storyteller] Error in FastDataPollCoroutine: {ex.Message}");
                }

                float interval = PlayerStorytellerMod.settings.fastDataInterval;
                if (interval < MinFastDataInterval) interval = MinFastDataInterval;
                yield return new WaitForSeconds(interval);
            }
        }

        private IEnumerator SlowDataPollCoroutine()
        {
            yield return new WaitForSeconds(2f);
            while (true)
            {
                try
                {
                    gameDataPoller?.UpdateSlowDataAsync();
                    gameDataPoller?.UpdateStoredResourcesAsync();
                    itemIconManager?.UpdateItemIconsAsync();
                    gameDataPoller?.UpdateInventoryAsync();
                }
                catch (Exception ex)
                {
                    Log.Error($"[Player Storyteller] Error in SlowDataPollCoroutine: {ex.Message}");
                }

                float interval = PlayerStorytellerMod.settings.slowDataInterval;
                if (interval < MinSlowDataInterval) interval = MinSlowDataInterval;
                yield return new WaitForSeconds(interval);
            }
        }

        private IEnumerator StaticDataPollCoroutine()
        {
            yield return new WaitForSeconds(3f);
            while (true)
            {
                try
                {
                    gameDataPoller?.UpdateStaticDataAsync();
                }
                catch (Exception ex)
                {
                    Log.Error($"[Player Storyteller] Error in StaticDataPollCoroutine: {ex.Message}");
                }

                float interval = PlayerStorytellerMod.settings.staticDataInterval;
                if (interval < MinStaticDataInterval) interval = MinStaticDataInterval;
                yield return new WaitForSeconds(interval);
            }
        }

        private IEnumerator PortraitPollCoroutine()
        {
            yield return new WaitForSeconds(5f);
            while (true)
            {
                try
                {
                    colonistDataPoller?.UpdatePortraitsAsync();
                }
                catch (Exception ex)
                {
                    Log.Error($"[Player Storyteller] Error in PortraitPollCoroutine: {ex.Message}");
                }
                yield return new WaitForSeconds(30f);
            }
        }

        private IEnumerator ActionPollCoroutine()
        {
            yield return new WaitForSeconds(1.5f);
            while (true)
            {
                try
                {
                    viewerActionProcessor?.PollForActionsAsync();
                }
                catch (Exception ex)
                {
                    Log.Error($"[Player Storyteller] Error in ActionPollCoroutine: {ex.Message}");
                }
                yield return new WaitForSeconds(ActionPollInterval);
            }
        }

        private IEnumerator SettingsPollCoroutine()
        {
            yield return new WaitForSeconds(5f);
            while (true)
            {
                try
                {
                    _ = PlayerStorytellerMod.PollRemoteSettingsAsync();
                }
                catch (Exception ex)
                {
                    Log.Error($"[Player Storyteller] Error in SettingsPollCoroutine: {ex.Message}");
                }
                yield return new WaitForSeconds(5f);
            }
        }
    }
}