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
        private const int MaxActionsPerMinuteDefault = 60; // Server-side enforces 30, we allow up to 60
        private const int MaxMessageLength = 500; // Maximum characters in user messages
        private const int MinMessageLength = 3; // Minimum characters in user messages
        private const float MinScreenshotInterval = 0.1f; // Minimum time between screenshots (10 FPS)
        private const float MinFastDataInterval = 0.5f; // Minimum fast data polling interval
        private const float MinSlowDataInterval = 1f; // Minimum slow data polling interval
        private const float MinStaticDataInterval = 10f; // Minimum static data polling interval
        internal const int CoroutineCheckInterval = 30; // Check coroutines every 30 ticks (0.5s) - internal for CoroutineHandler
        private const int RateLimitWindowTicks = 3600; // 1 minute at normal speed

        private static readonly HttpClient rimapiClient = new HttpClient();
        private Coroutine screenshotCoroutine;
        private Coroutine fastDataCoroutine;
        private Coroutine slowDataCoroutine;
        private Coroutine staticDataCoroutine;
        private Coroutine actionCoroutine;

        // Cached data from different polling tiers
        private string cachedFastData = "{}";      // Colonists - updates frequently
        private string cachedSlowData = "{}";      // Resources, power, creatures - updates slowly
        private string cachedStoredResources = "{}"; // Stored resources - updates slowly
        private string cachedStaticData = "{}";    // Factions, research projects - rarely changes
        private string cachedInventoryData = "{}"; // Colonist inventory - updates slowly
        private string cachedPortraits = "{}";     // Colonist portraits - updates rarely
        private string cachedItemIcons = "{}";     // Item icons for action panel - updates rarely
        private readonly object dataLock = new object();
        private readonly Dictionary<string, string> colonistPortraitCache = new Dictionary<string, string>();
        private readonly Dictionary<string, string> itemIconCache = new Dictionary<string, string>();
        private readonly List<string> actionItemDefs = new List<string> { "MealSurvivalPack", "MedicineIndustrial", "Steel", "ComponentIndustrial", "Silver" };
        private Coroutine portraitCoroutine;

        // Thread-safe action queue for processing actions on main thread
        private readonly ConcurrentQueue<Action> mainThreadActionQueue = new ConcurrentQueue<Action>();

        // Rate limiting for viewer actions
        private Queue<int> actionTimestamps = new Queue<int>(); // Store tick times of recent actions
        private readonly object rateLimitLock = new object();

        // PERFORMANCE FIX: Instance-based screenshot manager to avoid static Unity object warnings
        private ScreenshotManager screenshotManager;

        public PlayerStorytellerMapComponent(Map map) : base(map)
        {
            // It's better to initialize the client once.
            // CRITICAL: Very short timeout since RimAPI is local - don't block game thread waiting
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
            // PERFORMANCE FIX: Clean up GPU resources when map is closed
            if (screenshotManager != null)
            {
                screenshotManager.Cleanup();
                screenshotManager = null;
            }
            Log.Message("[Player Storyteller] Map component cleaned up, GPU resources released");
        }

        public override void MapComponentTick()
        {
            base.MapComponentTick();

            // Process queued actions on the main thread
            while (!mainThreadActionQueue.IsEmpty)
            {
                if (mainThreadActionQueue.TryDequeue(out var action))
                {
                    try
                    {
                        Log.Message("[Player Storyteller] Dequeued action from queue, executing now...");
                        action();
                    }
                    catch (Exception ex)
                    {
                        Log.Error($"[Player Storyteller] Error executing queued action: {ex}");
                    }
                }
            }
        }

        public override void FinalizeInit()
        {
            base.FinalizeInit();

            // Reset connection on map load (in case it was paused)
            PlayerStorytellerMod.ResetConnection();

            // PERFORMANCE FIX: Initialize screenshot manager instance with async callback
            screenshotManager = new ScreenshotManager();
            screenshotManager.SetScreenshotCallback(OnScreenshotReady);

            // Ensure we have a coroutine handler
            if (map.GetComponent<CoroutineHandler>() == null)
            {
                // Add the handler if it doesn't exist
                var handler = new CoroutineHandler(map);
                map.components.Add(handler);
            }

            // Start coroutines if they haven't been started yet
            var handlerComponent = map.GetComponent<CoroutineHandler>();
            if (handlerComponent != null && screenshotCoroutine == null)
            {
                screenshotCoroutine = handlerComponent.StartCoroutine(ScreenshotCoroutine());
                fastDataCoroutine = handlerComponent.StartCoroutine(FastDataPollCoroutine());
                slowDataCoroutine = handlerComponent.StartCoroutine(SlowDataPollCoroutine());
                staticDataCoroutine = handlerComponent.StartCoroutine(StaticDataPollCoroutine());
                portraitCoroutine = handlerComponent.StartCoroutine(PortraitPollCoroutine());
                actionCoroutine = handlerComponent.StartCoroutine(ActionPollCoroutine());

                Log.Message("[Player Storyteller] Map component initialized with AsyncGPUReadback support and colonist portrait caching");
            }
        }

        private IEnumerator ScreenshotCoroutine()
        {
            // Wait a bit before starting
            yield return new WaitForSeconds(1f);

            while (true)
            {
                try
                {
                    SendScreenshotUpdate();
                }
                catch (Exception ex)
                {
                    Log.Error($"[Player Storyteller] Error in ScreenshotCoroutine: {ex.Message}");
                }

                // Wait for the configured update interval
                float interval = PlayerStorytellerMod.settings.updateInterval;
                if (interval < MinScreenshotInterval) interval = MinScreenshotInterval;

                yield return new WaitForSeconds(interval);
            }
        }

        // FAST DATA: Colonists (health, needs, activities change frequently)
        // Default: every 1-2 seconds
        private IEnumerator FastDataPollCoroutine()
        {
            yield return new WaitForSeconds(0.5f);

            while (true)
            {
                try
                {
                    UpdateFastDataAsync();
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

        // SLOW DATA: Resources, power, creatures, weather (changes moderately)
        // Default: every 5-10 seconds
        private IEnumerator SlowDataPollCoroutine()
        {
            yield return new WaitForSeconds(2f);

            while (true)
            {
                try
                {
                    UpdateSlowDataAsync();
                    UpdateInventoryAsync();
                    UpdateStoredResourcesAsync();
                    UpdateItemIconsAsync(); // Fetch item icons for visible items
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

        // STATIC DATA: Factions, research progress (rarely changes)
        // Default: every 30-60 seconds or on-demand
        private IEnumerator StaticDataPollCoroutine()
        {
            yield return new WaitForSeconds(3f);

            while (true)
            {
                try
                {
                    UpdateStaticDataAsync();
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

        // PORTRAIT DATA: Colonist portraits (rarely changes, cached aggressively)
        // Default: every 20-30 seconds
        private IEnumerator PortraitPollCoroutine()
        {
            // Wait before starting to let colonist data load first
            yield return new WaitForSeconds(5f);

            while (true)
            {
                try
                {
                    UpdatePortraitsAsync();
                }
                catch (Exception ex)
                {
                    Log.Error($"[Player Storyteller] Error in PortraitPollCoroutine: {ex.Message}");
                }

                // Update portraits every 30 seconds (they don't change often)
                yield return new WaitForSeconds(30f);
            }
        }

        private IEnumerator ActionPollCoroutine()
        {
            // Wait a bit before starting
            yield return new WaitForSeconds(1.5f);

            while (true)
            {
                try
                {
                    PollForActionsAsync();
                }
                catch (Exception ex)
                {
                    Log.Error($"[Player Storyteller] Error in ActionPollCoroutine: {ex.Message}");
                }

                yield return new WaitForSeconds(ActionPollInterval);
            }
        }

        private async void PollForActionsAsync()
        {
            try
            {
                var actions = await PlayerStorytellerMod.GetPlayerActionsAsync();
                foreach (var action in actions)
                {
                    // Queue for main thread execution
                    Log.Message($"[Player Storyteller] Enqueuing action: {action.action} with data: {action.data}");
                    mainThreadActionQueue.Enqueue(() => ProcessPlayerAction(action));
                }
                if (actions.Count > 0)
                {
                    Log.Message($"[Player Storyteller] Queue size after enqueue: {mainThreadActionQueue.Count}");
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error polling for actions: {ex.Message}");
            }
        }

        private bool CheckRateLimit()
        {
            lock (rateLimitLock)
            {
                int currentTick = Find.TickManager.TicksGame;
                int oneMinuteAgo = currentTick - RateLimitWindowTicks;

                // Remove timestamps older than 1 minute
                while (actionTimestamps.Count > 0 && actionTimestamps.Peek() < oneMinuteAgo)
                {
                    actionTimestamps.Dequeue();
                }

                // Check if we're under the limit
                if (actionTimestamps.Count >= PlayerStorytellerMod.settings.maxActionsPerMinute)
                {
                    Messages.Message($"Action rate limit exceeded! Max {PlayerStorytellerMod.settings.maxActionsPerMinute} actions per minute.", MessageTypeDefOf.RejectInput);
                    return false;
                }

                // Add current timestamp
                actionTimestamps.Enqueue(currentTick);
                return true;
            }
        }

        private bool IsActionEnabled(string actionName)
        {
            var settings = PlayerStorytellerMod.settings;
            switch (actionName)
            {
                case "healColonist": return settings.enableHealColonist;
                case "healAll": return settings.enableHealAll;
                case "inspireColonist": return settings.enableInspireColonist;
                case "inspireAll": return settings.enableInspireAll;
                case "sendWanderer": return settings.enableSendWanderer;
                case "sendRefugee": return settings.enableSendRefugee;
                case "dropFood": return settings.enableDropFood;
                case "dropMedicine": return settings.enableDropMedicine;
                case "dropSteel": return settings.enableDropSteel;
                case "dropComponents": return settings.enableDropComponents;
                case "dropSilver": return settings.enableDropSilver;
                case "legendary": return settings.enableLegendary;
                case "sendTrader": return settings.enableSendTrader;
                case "tameAnimal": return settings.enableTameAnimal;
                case "spawnAnimal": return settings.enableSpawnAnimal;
                case "goodEvent": return settings.enableGoodEvent;
                case "weatherClear": return settings.enableWeatherClear;
                case "weatherRain": return settings.enableWeatherRain;
                case "weatherFog": return settings.enableWeatherFog;
                case "weatherSnow": return settings.enableWeatherSnow;
                case "weatherThunderstorm": return settings.enableWeatherThunderstorm;
                case "raid": return settings.enableRaid;
                case "manhunter": return settings.enableManhunter;
                case "madAnimal": return settings.enableMadAnimal;
                case "solarFlare": return settings.enableSolarFlare;
                case "eclipse": return settings.enableEclipse;
                case "toxicFallout": return settings.enableToxicFallout;
                case "flashstorm": return settings.enableFlashstorm;
                case "meteor": return settings.enableMeteor;
                case "tornado": return settings.enableTornado;
                case "lightning": return settings.enableLightning;
                case "randomEvent": return settings.enableRandomEvent;
                case "sendLetter": return settings.enableSendLetter;
                case "ping": return settings.enablePing;
                default: return true; // Allow unknown actions by default
            }
        }

        private void ProcessPlayerAction(PlayerAction action)
        {
            try
            {
                if (action == null || string.IsNullOrEmpty(action.action))
                {
                    Log.Warning("[Player Storyteller] Received an action that was null or had no action name.");
                    return;
                }

                // Check if action is enabled
                if (!IsActionEnabled(action.action))
                {
                    Messages.Message($"Action '{action.action}' is disabled in mod settings.", MessageTypeDefOf.RejectInput);
                    Log.Message($"[Player Storyteller] Action '{action.action}' blocked - disabled in settings");
                    return;
                }

                // Check rate limiting
                if (!CheckRateLimit())
                {
                    Log.Message($"[Player Storyteller] Action '{action.action}' blocked - rate limit exceeded");
                    return;
                }

                Log.Message($"[Player Storyteller] Processing action: {action.action} with data: {action.data}");

                switch (action.action)
                {
                    // ===== COMMUNICATION =====
                    case "sendLetter":
                        ShowLetter(action.data);
                        break;
                    case "ping":
                        CreatePing(action.data);
                        break;

                    // ===== COLONISTS & PEOPLE =====
                    case "sendRefugee":
                        SendRefugee();
                        break;
                    case "sendWanderer":
                        SendWanderer();
                        break;
                    case "healColonist":
                        HealRandomColonist();
                        break;
                    case "healAll":
                        HealAllColonists();
                        break;
                    case "inspireColonist":
                        InspireRandomColonist();
                        break;
                    case "inspireAll":
                        InspireAllColonists();
                        break;
                    case "startQuest":
                        StartQuest();
                        break;

                    // ===== RESOURCES & SUPPLIES =====
                    case "dropFood":
                        DropPodResource("Food", 75);
                        break;
                    case "dropMedicine":
                        DropPodResource("Medicine", 30);
                        break;
                    case "dropSteel":
                        DropPodResource("Steel", 200);
                        break;
                    case "dropComponents":
                        DropPodResource("Components", 25);
                        break;
                    case "dropSilver":
                        DropPodResource("Silver", 1000);
                        break;
                    case "legendary":
                        GiftLegendaryItem();
                        break;

                    // ===== ECONOMY & TRADE =====
                    case "sendTrader":
                        SendTraderCaravan();
                        break;

                    // ===== ANIMALS =====
                    case "tameAnimal":
                        TameRandomAnimal();
                        break;
                    case "spawnAnimal":
                        SpawnRandomAnimal();
                        break;

                    // ===== EVENTS - POSITIVE =====
                    case "goodEvent":
                        TriggerPositiveEvent();
                        break;
                    case "weatherClear":
                        ChangeWeather("Clear");
                        break;

                    // ===== EVENTS - CHALLENGES =====
                    case "raid":
                        TriggerRaid();
                        break;
                    case "manhunter":
                        TriggerManhunterPack();
                        break;
                    case "madAnimal":
                        TriggerMadAnimal();
                        break;
                    case "solarFlare":
                        TriggerSolarFlare();
                        break;
                    case "eclipse":
                        TriggerEclipse();
                        break;
                    case "toxicFallout":
                        TriggerToxicFallout();
                        break;
                    case "flashstorm":
                        TriggerFlashstorm();
                        break;

                    // ===== CHAOS EVENTS =====
                    case "meteor":
                        TriggerMeteorShower();
                        break;
                    case "tornado":
                        TriggerTornado();
                        break;
                    case "lightning":
                        TriggerLightningStrike();
                        break;
                    case "randomEvent":
                        TriggerRandomEvent();
                        break;

                    // ===== WEATHER =====
                    case "weatherRain":
                        ChangeWeather("Rain");
                        break;
                    case "weatherFog":
                        ChangeWeather("Fog");
                        break;
                    case "weatherSnow":
                        ChangeWeather("Snow");
                        break;
                    case "weatherThunderstorm":
                        ChangeWeather("RainyThunderstorm");
                        break;

                    // ===== FACTIONS =====
                    case "changeFactionGoodwill":
                        ChangeFactionGoodwill(action.data);
                        break;

                    default:
                        Log.Warning($"[Player Storyteller] Unknown player action: {action.action}");
                        break;
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error processing action '{action.action}': {ex.Message}");
            }
        }

        // ============================================
        // COLONISTS & PEOPLE
        // ============================================

        private void StartQuest()
        {
            try
            {
                // Find all quest-related incidents
                var questIncidents = DefDatabase<IncidentDef>.AllDefs
                    .Where(d => d.defName.Contains("Quest_") && d.TargetAllowed(map) && d.Worker.CanFireNow(StorytellerUtility.DefaultParmsNow(d.category, map)))
                    .ToList();

                if (questIncidents.Count == 0)
                {
                    Messages.Message("No quests available to start.", MessageTypeDefOf.RejectInput);
                    return;
                }

                IncidentDef questDef = questIncidents.RandomElement();
                IncidentParms parms = StorytellerUtility.DefaultParmsNow(questDef.category, map);
                parms.forced = true;

                if (questDef.Worker.TryExecute(parms))
                {
                    Messages.Message($"Viewers started a quest: {questDef.label}", MessageTypeDefOf.PositiveEvent);
                    Log.Message($"[Player Storyteller] Started quest: {questDef.defName}");
                }
                else
                {
                    Messages.Message("Failed to start quest.", MessageTypeDefOf.RejectInput);
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error starting quest: {ex.Message}");
            }
        }

        private void SendRefugee()
        {
            try
            {
                // Try various refugee incident names
                IncidentDef refugeeDef = DefDatabase<IncidentDef>.GetNamedSilentFail("RefugeeChased")
                    ?? DefDatabase<IncidentDef>.GetNamedSilentFail("RefugeePodCrash");

                if (refugeeDef == null)
                {
                    Messages.Message("Refugee incident not available.", MessageTypeDefOf.RejectInput);
                    Log.Warning("[Player Storyteller] Refugee incident not found in database.");
                    return;
                }

                IncidentParms parms = StorytellerUtility.DefaultParmsNow(IncidentCategoryDefOf.Misc, map);
                parms.forced = true;

                refugeeDef.Worker.TryExecute(parms);

                Messages.Message("A refugee is seeking shelter!", MessageTypeDefOf.PositiveEvent);
                Log.Message("[Player Storyteller] Sent refugee.");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error sending refugee: {ex.Message}");
            }
        }

        private void SendWanderer()
        {
            try
            {
                // Trigger the wanderer joins incident
                IncidentDef wandererDef = IncidentDefOf.WandererJoin;
                IncidentParms parms = StorytellerUtility.DefaultParmsNow(IncidentCategoryDefOf.Misc, map);
                parms.forced = true;

                wandererDef.Worker.TryExecute(parms);

                Messages.Message("A wanderer has joined your colony!", MessageTypeDefOf.PositiveEvent);
                Log.Message("[Player Storyteller] Sent wanderer.");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error sending wanderer: {ex.Message}");
            }
        }

        private void HealRandomColonist()
        {
            try
            {
                var colonists = map.mapPawns.FreeColonists.Where(c => c.health.hediffSet.hediffs.Any(h => h.def.isBad)).ToList();

                if (colonists.Count == 0)
                {
                    Messages.Message("All colonists are healthy!", MessageTypeDefOf.NeutralEvent);
                    return;
                }

                Pawn colonist = colonists.RandomElement();
                var hediffs = colonist.health.hediffSet.hediffs.ToList();
                foreach (var hediff in hediffs)
                {
                    if (hediff.def.makesSickThought || hediff.def.isBad)
                    {
                        colonist.health.RemoveHediff(hediff);
                    }
                }

                Messages.Message($"{colonist.Name.ToStringShort} has been healed!", MessageTypeDefOf.PositiveEvent);
                Log.Message($"[Player Storyteller] Healed {colonist.Name.ToStringShort}.");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error healing colonist: {ex.Message}");
            }
        }

        private void InspireRandomColonist()
        {
            try
            {
                var colonists = map.mapPawns.FreeColonists.ToList();
                if (colonists.Count == 0) return;

                Pawn colonist = colonists.RandomElement();

                // Try to give a random inspiration
                var allInspirations = DefDatabase<InspirationDef>.AllDefsListForReading;
                if (allInspirations.Count > 0)
                {
                    var inspiration = allInspirations.RandomElement();
                    colonist.mindState.inspirationHandler.TryStartInspiration(inspiration);
                    Messages.Message($"{colonist.Name.ToStringShort} has been inspired: {inspiration.label}!", MessageTypeDefOf.PositiveEvent);
                    Log.Message($"[Player Storyteller] Inspired {colonist.Name.ToStringShort} with {inspiration.defName}.");
                }
                else
                {
                     // Fallback to mood boost if no inspirations found (rare)
                    if (colonist.needs?.joy != null) colonist.needs.joy.CurLevel = 1f;
                    if (colonist.needs?.comfort != null) colonist.needs.comfort.CurLevel = 1f;
                    if (colonist.needs?.beauty != null) colonist.needs.beauty.CurLevel = 1f;
                    Messages.Message($"{colonist.Name.ToStringShort} feels inspired!", MessageTypeDefOf.PositiveEvent);
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error inspiring colonist: {ex.Message}");
            }
        }

        private void HealAllColonists()
        {
            try
            {
                int healed = 0;
                foreach (Pawn colonist in map.mapPawns.FreeColonists)
                {
                    // Heal all health conditions
                    var hediffs = colonist.health.hediffSet.hediffs.ToList();
                    foreach (var hediff in hediffs)
                    {
                        if (hediff.def.makesSickThought || hediff.def.isBad)
                        {
                            colonist.health.RemoveHediff(hediff);
                        }
                    }
                    healed++;
                }

                Messages.Message($"Viewers healed all {healed} colonists!", MessageTypeDefOf.PositiveEvent);
                Log.Message($"[Player Storyteller] Healed {healed} colonists.");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error healing colonists: {ex.Message}");
            }
        }

        private void InspireAllColonists()
        {
            try
            {
                int inspired = 0;
                foreach (Pawn colonist in map.mapPawns.FreeColonists)
                {
                    // Try to give a random inspiration
                    var allInspirations = DefDatabase<InspirationDef>.AllDefsListForReading;
                    if (allInspirations.Count > 0)
                    {
                        var inspiration = allInspirations.RandomElement();
                        colonist.mindState.inspirationHandler.TryStartInspiration(inspiration);
                    }
                    else
                    {
                        // Fallback to mood boost
                        if (colonist.needs?.joy != null) colonist.needs.joy.CurLevel = 1f;
                        if (colonist.needs?.comfort != null) colonist.needs.comfort.CurLevel = 1f;
                        if (colonist.needs?.beauty != null) colonist.needs.beauty.CurLevel = 1f;
                    }
                    inspired++;
                }

                Messages.Message($"Viewers inspired all colonists! Everyone feels amazing!", MessageTypeDefOf.PositiveEvent);
                Log.Message($"[Player Storyteller] Inspired {inspired} colonists.");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error inspiring colonists: {ex.Message}");
            }
        }

        // ============================================
        // RESOURCES & SUPPLIES
        // ============================================

        private void DropPodResource(string resourceType, int amount)
        {
            try
            {
                IntVec3 dropSpot = DropCellFinder.RandomDropSpot(map);
                List<Thing> items = new List<Thing>();

                ThingDef thingDef = null;
                string displayName = resourceType;

                switch (resourceType)
                {
                    case "Food":
                        thingDef = ThingDefOf.MealSurvivalPack;
                        displayName = "survival meals";
                        break;
                    case "Medicine":
                        thingDef = ThingDefOf.MedicineIndustrial;
                        displayName = "medicine";
                        break;
                    case "Steel":
                        thingDef = ThingDefOf.Steel;
                        displayName = "steel";
                        break;
                    case "Components":
                        thingDef = ThingDefOf.ComponentIndustrial;
                        displayName = "components";
                        break;
                    case "Silver":
                        thingDef = ThingDefOf.Silver;
                        displayName = "silver";
                        break;
                    default:
                        Log.Warning($"[Player Storyteller] Unknown resource type: {resourceType}");
                        return;
                }

                Thing item = ThingMaker.MakeThing(thingDef);
                item.stackCount = amount;
                items.Add(item);

                DropPodUtility.DropThingsNear(dropSpot, map, items, forbid: false);

                Messages.Message($"Drop pod delivered {amount} {displayName}!", MessageTypeDefOf.PositiveEvent);
                Log.Message($"[Player Storyteller] Dropped {amount} {displayName}.");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error dropping resource: {ex.Message}");
            }
        }

        private void GiftLegendaryItem()
        {
            try
            {
                // Pick a random weapon or apparel
                var allDefs = new List<ThingDef>();
                allDefs.AddRange(DefDatabase<ThingDef>.AllDefs.Where(d => d.IsWeapon && d.tradeability != Tradeability.None));
                allDefs.AddRange(DefDatabase<ThingDef>.AllDefs.Where(d => d.IsApparel && d.tradeability != Tradeability.None));

                if (allDefs.Count == 0)
                {
                    Log.Warning("[Player Storyteller] No weapons or apparel found for legendary gift.");
                    return;
                }

                ThingDef chosenDef = allDefs.RandomElement();
                Thing item = ThingMaker.MakeThing(chosenDef, GenStuff.RandomStuffFor(chosenDef));

                // Set to legendary quality
                var qualityComp = item.TryGetComp<CompQuality>();
                if (qualityComp != null)
                {
                    qualityComp.SetQuality(QualityCategory.Legendary, ArtGenerationContext.Colony);
                }

                IntVec3 dropSpot = DropCellFinder.RandomDropSpot(map);
                GenPlace.TryPlaceThing(item, dropSpot, map, ThingPlaceMode.Near);

                Messages.Message($"Viewers sent a legendary {item.Label}!", MessageTypeDefOf.PositiveEvent);
                Log.Message($"[Player Storyteller] Gifted legendary item: {item.Label}");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error gifting legendary item: {ex.Message}");
            }
        }

        // ============================================
        // ECONOMY & TRADE
        // ============================================

        private void SendTraderCaravan()
        {
            try
            {
                IncidentDef traderDef = IncidentDefOf.TraderCaravanArrival;
                IncidentParms parms = StorytellerUtility.DefaultParmsNow(IncidentCategoryDefOf.Misc, map);
                parms.forced = true;

                traderDef.Worker.TryExecute(parms);

                Messages.Message("A trader caravan is approaching!", MessageTypeDefOf.PositiveEvent);
                Log.Message("[Player Storyteller] Sent trader caravan.");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error sending trader: {ex.Message}");
            }
        }

        // ============================================
        // ANIMALS
        // ============================================

        private void TameRandomAnimal()
        {
            try
            {
                var wildAnimals = map.mapPawns.AllPawns
                    .Where(p => p.AnimalOrWildMan() && p.Faction == null)
                    .ToList();

                if (wildAnimals.Count == 0)
                {
                    Messages.Message("No wild animals found on the map.", MessageTypeDefOf.NeutralEvent);
                    return;
                }

                Pawn animal = wildAnimals.RandomElement();
                animal.SetFaction(Faction.OfPlayer);

                Messages.Message($"Viewers tamed a wild {animal.LabelShort}!", MessageTypeDefOf.PositiveEvent);
                Log.Message($"[Player Storyteller] Tamed animal: {animal.LabelShort}");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error taming animal: {ex.Message}");
            }
        }

        private void SpawnRandomAnimal()
        {
            try
            {
                // Get all animal kinds that are wild
                var animalKinds = DefDatabase<PawnKindDef>.AllDefs
                    .Where(k => k.RaceProps != null && k.RaceProps.Animal)
                    .ToList();

                if (animalKinds.Count == 0)
                {
                    Log.Warning("[Player Storyteller] No animal kinds found for spawning.");
                    return;
                }

                PawnKindDef chosenAnimal = animalKinds.RandomElement();
                IntVec3 spawnSpot = CellFinder.RandomClosewalkCellNear(map.Center, map, 20);

                Pawn animal = PawnGenerator.GeneratePawn(chosenAnimal, null);
                GenSpawn.Spawn(animal, spawnSpot, map);

                Messages.Message($"A wild {animal.LabelShort} has appeared!", MessageTypeDefOf.NeutralEvent);
                Log.Message($"[Player Storyteller] Spawned animal: {animal.LabelShort}");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error spawning animal: {ex.Message}");
            }
        }

        // ============================================
        // POSITIVE EVENTS
        // ============================================

        private void TriggerPositiveEvent()
        {
            try
            {
                var positiveEvents = new List<IncidentDef>
                {
                    IncidentDefOf.FarmAnimalsWanderIn,
                    IncidentDefOf.TravelerGroup,
                    IncidentDefOf.TraderCaravanArrival
                };

                IncidentDef chosen = positiveEvents.RandomElement();
                IncidentParms parms = StorytellerUtility.DefaultParmsNow(IncidentCategoryDefOf.Misc, map);
                parms.forced = true;

                chosen.Worker.TryExecute(parms);

                Messages.Message($"Event: {chosen.label}", MessageTypeDefOf.PositiveEvent);
                Log.Message($"[Player Storyteller] Triggered positive event: {chosen.label}");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering positive event: {ex.Message}");
            }
        }

        // ============================================
        // CHALLENGING EVENTS
        // ============================================

        private void TriggerRaid()
        {
            try
            {
                IncidentDef raidDef = IncidentDefOf.RaidEnemy;
                IncidentParms parms = StorytellerUtility.DefaultParmsNow(IncidentCategoryDefOf.ThreatBig, map);
                parms.forced = true;

                // Get a random enemy faction
                Faction faction = Find.FactionManager.RandomEnemyFaction();
                if (faction == null)
                {
                    Messages.Message("No enemy factions available for raid.", MessageTypeDefOf.RejectInput);
                    return;
                }
                parms.faction = faction;

                // CRITICAL FIX: Set raid arrival mode AND strategy explicitly
                // This prevents "No raid strategy found" errors
                parms.raidArrivalMode = PawnsArrivalModeDefOf.EdgeWalkIn;

                // Explicitly set raid strategy to ImmediateAttack (always available)
                parms.raidStrategy = RaidStrategyDefOf.ImmediateAttack;

                // Ensure points are reasonable (between 35 and current storyteller max)
                float storyPoints = StorytellerUtility.DefaultThreatPointsNow(map);
                parms.points = Math.Max(35f, Math.Min(storyPoints * 1.2f, storyPoints));

                if (raidDef.Worker.TryExecute(parms))
                {
                    Messages.Message("Viewers triggered a raid!", MessageTypeDefOf.ThreatBig);
                    Log.Message("[Player Storyteller] Triggered raid.");
                }
                else
                {
                    Messages.Message("Failed to trigger raid (faction may not have available strategies).", MessageTypeDefOf.RejectInput);
                    Log.Warning("[Player Storyteller] Raid failed to execute - faction may not support raiding.");
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering raid: {ex.Message}");
            }
        }

        private void TriggerManhunterPack()
        {
            try
            {
                IncidentDef manhunterDef = IncidentDefOf.ManhunterPack;
                IncidentParms parms = StorytellerUtility.DefaultParmsNow(IncidentCategoryDefOf.ThreatBig, map);
                parms.forced = true;

                manhunterDef.Worker.TryExecute(parms);

                Messages.Message("Viewers sent a manhunter pack!", MessageTypeDefOf.ThreatBig);
                Log.Message("[Player Storyteller] Triggered manhunter pack.");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering manhunter pack: {ex.Message}");
            }
        }

        private void TriggerMadAnimal()
        {
            try
            {
                // Try various mad animal incident names
                IncidentDef madAnimalDef = DefDatabase<IncidentDef>.GetNamedSilentFail("AnimalInsanitySingle")
                    ?? DefDatabase<IncidentDef>.GetNamedSilentFail("AnimalInsanityMass");

                if (madAnimalDef == null)
                {
                    Messages.Message("Mad animal incident not available.", MessageTypeDefOf.RejectInput);
                    Log.Warning("[Player Storyteller] Mad animal incident not found in database.");
                    return;
                }

                IncidentParms parms = StorytellerUtility.DefaultParmsNow(IncidentCategoryDefOf.ThreatSmall, map);
                parms.forced = true;

                madAnimalDef.Worker.TryExecute(parms);

                Messages.Message("Viewers made animals go mad!", MessageTypeDefOf.ThreatSmall);
                Log.Message("[Player Storyteller] Triggered mad animal.");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering mad animal: {ex.Message}");
            }
        }

        private void TriggerSolarFlare()
        {
            try
            {
                IncidentDef solarFlareDef = IncidentDefOf.SolarFlare;
                IncidentParms parms = StorytellerUtility.DefaultParmsNow(IncidentCategoryDefOf.Misc, map);
                parms.forced = true;

                solarFlareDef.Worker.TryExecute(parms);

                Messages.Message("Viewers triggered a solar flare!", MessageTypeDefOf.NegativeEvent);
                Log.Message("[Player Storyteller] Triggered solar flare.");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering solar flare: {ex.Message}");
            }
        }

        private void TriggerEclipse()
        {
            try
            {
                IncidentDef eclipseDef = IncidentDefOf.Eclipse;
                IncidentParms parms = StorytellerUtility.DefaultParmsNow(IncidentCategoryDefOf.Misc, map);
                parms.forced = true;

                eclipseDef.Worker.TryExecute(parms);

                Messages.Message("Viewers triggered an eclipse!", MessageTypeDefOf.NegativeEvent);
                Log.Message("[Player Storyteller] Triggered eclipse.");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering eclipse: {ex.Message}");
            }
        }

        private void TriggerToxicFallout()
        {
            try
            {
                IncidentDef toxicDef = IncidentDefOf.ToxicFallout;
                IncidentParms parms = StorytellerUtility.DefaultParmsNow(IncidentCategoryDefOf.Misc, map);
                parms.forced = true;

                toxicDef.Worker.TryExecute(parms);

                Messages.Message("Viewers triggered toxic fallout!", MessageTypeDefOf.NegativeEvent);
                Log.Message("[Player Storyteller] Triggered toxic fallout.");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering toxic fallout: {ex.Message}");
            }
        }

        private void TriggerFlashstorm()
        {
            try
            {
                // Try various flashstorm incident names
                IncidentDef flashstormDef = DefDatabase<IncidentDef>.GetNamedSilentFail("Flashstorm")
                    ?? DefDatabase<IncidentDef>.GetNamedSilentFail("FlashStorm");

                if (flashstormDef == null)
                {
                    Messages.Message("Flashstorm incident not available.", MessageTypeDefOf.RejectInput);
                    Log.Warning("[Player Storyteller] Flashstorm incident not found in database.");
                    return;
                }

                IncidentParms parms = StorytellerUtility.DefaultParmsNow(IncidentCategoryDefOf.Misc, map);
                parms.forced = true;

                flashstormDef.Worker.TryExecute(parms);

                Messages.Message("Viewers triggered a flashstorm!", MessageTypeDefOf.NegativeEvent);
                Log.Message("[Player Storyteller] Triggered flashstorm.");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering flashstorm: {ex.Message}");
            }
        }

        // ============================================
        // CHAOS EVENTS
        // ============================================

        private void TriggerMeteorShower()
        {
            try
            {
                // Try to find meteor incident by various names
                IncidentDef meteorDef = DefDatabase<IncidentDef>.GetNamedSilentFail("MeteoriteImpact")
                    ?? DefDatabase<IncidentDef>.GetNamedSilentFail("Meteorite");

                if (meteorDef == null)
                {
                    Messages.Message("Meteor incident not available.", MessageTypeDefOf.RejectInput);
                    Log.Warning("[Player Storyteller] Meteorite incident not found in database.");
                    return;
                }

                IncidentParms parms = StorytellerUtility.DefaultParmsNow(IncidentCategoryDefOf.Misc, map);
                parms.forced = true;

                // Trigger multiple meteors
                for (int i = 0; i < 5; i++)
                {
                    meteorDef.Worker.TryExecute(parms);
                }

                Messages.Message("Viewers triggered a meteor shower!", MessageTypeDefOf.NeutralEvent);
                Log.Message("[Player Storyteller] Triggered meteor shower.");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering meteor shower: {ex.Message}");
            }
        }

        private void TriggerTornado()
        {
            try
            {
                // Try to find tornado incident - may not exist in all RimWorld versions
                IncidentDef tornadoDef = DefDatabase<IncidentDef>.GetNamedSilentFail("Tornado");

                if (tornadoDef == null)
                {
                    Messages.Message("Tornado incident not available in this version.", MessageTypeDefOf.RejectInput);
                    Log.Warning("[Player Storyteller] Tornado incident not found in database.");
                    return;
                }

                IncidentParms parms = StorytellerUtility.DefaultParmsNow(IncidentCategoryDefOf.Misc, map);
                parms.forced = true;

                tornadoDef.Worker.TryExecute(parms);

                Messages.Message("Viewers summoned a tornado!", MessageTypeDefOf.ThreatBig);
                Log.Message("[Player Storyteller] Triggered tornado.");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering tornado: {ex.Message}");
            }
        }

        private void TriggerLightningStrike()
        {
            try
            {
                IntVec3 targetCell = CellFinderLoose.RandomCellWith(c => c.Standable(map) && !c.Roofed(map), map);
                map.weatherManager.eventHandler.AddEvent(new WeatherEvent_LightningStrike(map, targetCell));

                Messages.Message("Viewers called down lightning!", MessageTypeDefOf.NeutralEvent);
                Log.Message("[Player Storyteller] Triggered lightning strike.");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering lightning: {ex.Message}");
            }
        }

        private void TriggerRandomEvent()
        {
            try
            {
                // Pick a random incident
                var incidents = new List<IncidentDef>
                {
                    IncidentDefOf.TraderCaravanArrival,
                    IncidentDefOf.FarmAnimalsWanderIn,
                    IncidentDefOf.ShipChunkDrop,
                    IncidentDefOf.TravelerGroup,
                    IncidentDefOf.VisitorGroup
                };

                IncidentDef randomIncident = incidents.RandomElement();
                IncidentParms parms = StorytellerUtility.DefaultParmsNow(IncidentCategoryDefOf.Misc, map);
                parms.forced = true;

                randomIncident.Worker.TryExecute(parms);

                Messages.Message($"Viewers triggered: {randomIncident.label}", MessageTypeDefOf.NeutralEvent);
                Log.Message($"[Player Storyteller] Triggered random event: {randomIncident.label}");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering random event: {ex.Message}");
            }
        }

        // ============================================
        // LEGACY/UTILITY METHODS
        // ============================================

        private void SpawnItem(string itemDefName)
        {
            if (string.IsNullOrEmpty(itemDefName)) return;

            Pawn colonist = map.mapPawns.FreeColonists.FirstOrDefault();
            if (colonist == null)
            {
                Log.Warning("[Player Storyteller] No colonists found to spawn item near.");
                return;
            }

            ThingDef thingDef = DefDatabase<ThingDef>.GetNamed(itemDefName, false);
            if (thingDef == null)
            {
                Log.Warning($"[Player Storyteller] Could not find ThingDef for item: {itemDefName}");
                return;
            }

            Thing item = ThingMaker.MakeThing(thingDef);
            item.stackCount = item.def.stackLimit > 1 ? Math.Min(item.def.stackLimit, 25) : 1;

            if (GenPlace.TryPlaceThing(item, colonist.Position, map, ThingPlaceMode.Near))
            {
                Messages.Message($"An item has appeared: {item.Label}", MessageTypeDefOf.PositiveEvent);
            }
            else
            {
                Log.Warning($"[Player Storyteller] Failed to spawn item {itemDefName} near {colonist.Name.ToStringShort}.");
            }
        }

        private void ChangeWeather(string weatherDefName)
        {
            if (string.IsNullOrEmpty(weatherDefName)) return;

            WeatherDef weatherDef = DefDatabase<WeatherDef>.GetNamed(weatherDefName, false);
            if (weatherDef == null)
            {
                Log.Warning($"[Player Storyteller] Could not find WeatherDef for: {weatherDefName}");
                return;
            }

            map.weatherManager.TransitionTo(weatherDef);
            Messages.Message($"The weather has changed to {weatherDef.label}.", MessageTypeDefOf.NeutralEvent);
        }

        // ============================================
        // FACTIONS
        // ============================================

        private void ChangeFactionGoodwill(string data)
        {
            try
            {
                // Parse JSON data: {"faction":"Faction Name","amount":10}
                // Note: Data comes as escaped JSON string, need to unescape first
                if (string.IsNullOrEmpty(data))
                {
                    Log.Warning("[Player Storyteller] ChangeFactionGoodwill called with empty data");
                    return;
                }

                // Remove escaped quotes if present (data might be double-stringified)
                string cleanedData = data.Replace("\\\"", "\"").Trim('"');

                // Use Unity's JsonUtility for safer parsing
                FactionGoodwillData goodwillData;
                try
                {
                    goodwillData = JsonUtility.FromJson<FactionGoodwillData>(cleanedData);
                }
                catch
                {
                    Log.Warning($"[Player Storyteller] Failed to parse faction goodwill JSON. Data: {cleanedData}");
                    return;
                }

                if (goodwillData == null || string.IsNullOrEmpty(goodwillData.faction))
                {
                     Log.Warning($"[Player Storyteller] Parsed goodwill data is invalid. Data: {cleanedData}");
                     return;
                }

                string factionName = goodwillData.faction;
                int amount = goodwillData.amount;

                // Find the faction
                Faction faction = Find.FactionManager.AllFactions.FirstOrDefault(f => f.Name == factionName);

                if (faction == null)
                {
                    Log.Warning($"[Player Storyteller] Faction not found: {factionName}");
                    Messages.Message($"Faction '{factionName}' not found.", MessageTypeDefOf.RejectInput);
                    return;
                }

                // Don't allow modifying player faction
                if (faction.IsPlayer)
                {
                    Messages.Message("Cannot modify your own faction's goodwill!", MessageTypeDefOf.RejectInput);
                    return;
                }

                // Apply goodwill change
                int oldGoodwill = faction.GoodwillWith(Faction.OfPlayer);
                faction.TryAffectGoodwillWith(Faction.OfPlayer, amount, canSendMessage: false, canSendHostilityLetter: false);
                int newGoodwill = faction.GoodwillWith(Faction.OfPlayer);
                int actualChange = newGoodwill - oldGoodwill;

                // Send message to player
                string changeText = actualChange > 0 ? $"+{actualChange}" : $"{actualChange}";
                string relationText = faction.PlayerRelationKind.GetLabel();
                MessageTypeDef messageType = actualChange > 0 ? MessageTypeDefOf.PositiveEvent : MessageTypeDefOf.NegativeEvent;

                Messages.Message(
                    $"Goodwill with {faction.Name}: {changeText} (now {newGoodwill}, {relationText})",
                    messageType
                );

                Log.Message($"[Player Storyteller] Changed goodwill with {factionName} by {actualChange} (requested {amount})");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error changing faction goodwill: {ex.Message}");
            }
        }

        [Serializable]
        public class FactionGoodwillData
        {
            public string faction;
            public int amount;
        }

        private void ShowLetter(string message)
        {
            try
            {
                // SECURITY: Sanitize message input to prevent any potential exploits
                message = SanitizeUserInput(message);

                if (string.IsNullOrEmpty(message))
                {
                    Log.Warning("[Player Storyteller] ShowLetter called with empty message after sanitization.");
                    return;
                }

                // SECURITY: Enforce maximum length (RimWorld UI constraint)
                if (message.Length > MaxMessageLength)
                {
                    message = message.Substring(0, MaxMessageLength) + "...";
                    Log.Warning($"[Player Storyteller] Message truncated to {MaxMessageLength} characters.");
                }

                Log.Message($"[Player Storyteller] Creating letter with message: {message}");

                // Use the ReceiveLetter overload with explicit LookTargets cast to avoid ambiguity
                Find.LetterStack.ReceiveLetter(
                    "Message from Viewer",
                    message,
                    LetterDefOf.NeutralEvent,
                    (LookTargets)null,  // Explicitly cast null to LookTargets to avoid ambiguity
                    null,               // Faction
                    null                // Quest
                );

                Log.Message("[Player Storyteller] Letter sent successfully.");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Exception in ShowLetter: {ex.ToString()}");
            }
        }

        /// <summary>
        /// SECURITY: Sanitizes user input to prevent potential exploits.
        /// RimWorld doesn't execute code from strings, but this prevents:
        /// - Null characters and control characters
        /// - Extremely long inputs (DoS)
        /// - Whitespace-only spam
        /// </summary>
        private string SanitizeUserInput(string input)
        {
            if (string.IsNullOrWhiteSpace(input))
                return string.Empty;

            // Remove null characters and control characters (except newlines and tabs)
            var cleaned = new StringBuilder(input.Length);
            foreach (char c in input)
            {
                // Allow: letters, numbers, punctuation, spaces, newlines, tabs
                // Block: control characters, null bytes, special Unicode
                if (c == '\n' || c == '\r' || c == '\t' || (c >= 32 && c < 127) || (c >= 160 && c <= 255))
                {
                    cleaned.Append(c);
                }
            }

            // Trim excessive whitespace
            string result = cleaned.ToString().Trim();

            // Collapse multiple consecutive newlines (max 2)
            while (result.Contains("\n\n\n"))
            {
                result = result.Replace("\n\n\n", "\n\n");
            }

            return result;
        }

        private void CreatePing(string coordinatesJson)
        {
            try
            {
                // Parse coordinates from JSON format: {"x": 123, "z": 456}
                var parts = coordinatesJson.Replace("{", "").Replace("}", "").Replace("\"", "").Split(',');

                int x = 0, z = 0;
                foreach (var part in parts)
                {
                    var kv = part.Split(':');
                    if (kv.Length == 2)
                    {
                        var key = kv[0].Trim();
                        var value = kv[1].Trim();

                        if (key == "x") int.TryParse(value, out x);
                        if (key == "z") int.TryParse(value, out z);
                    }
                }

                IntVec3 location = new IntVec3(x, 0, z);

                // Validate coordinates are within map bounds
                if (!location.InBounds(map))
                {
                    Log.Warning($"[Player Storyteller] Ping coordinates out of bounds: ({x}, {z})");
                    return;
                }

                // Create a visual ping effect using RimWorld's mote system
                ThingDef moteDef = DefDatabase<ThingDef>.GetNamedSilentFail("Mote_FeedbackGoto");
                if (moteDef != null)
                {
                    MoteMaker.MakeStaticMote(location.ToVector3Shifted(), map, moteDef, 3f);
                }

                // Create floating text as the main visual indicator
                MoteMaker.ThrowText(location.ToVector3Shifted(), map, "* Viewer Ping *", Color.cyan, 3.5f);

                Log.Message($"[Player Storyteller] Created ping at ({x}, {z})");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error creating ping: {ex.Message}");
            }
        }

        private void SendScreenshotUpdate()
        {
            try
            {
                // CRITICAL PERFORMANCE FIX: Use AsyncGPUReadback - doesn't block main thread!
                // Screenshot will be delivered via OnScreenshotReady callback when GPU finishes
                screenshotManager?.CaptureMapScreenshotAsync();
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in SendScreenshotUpdate: {ex.Message}\n{ex.StackTrace}");
            }
        }

        private async void OnScreenshotReady(byte[] screenshotBytes)
        {
            try
            {
                // If screenshot is empty AND streaming is enabled, it's a failure -> skip
                if ((screenshotBytes == null || screenshotBytes.Length == 0) && PlayerStorytellerMod.settings.enableLiveScreen)
                {
                    return;
                }

                // Get cached game data (quick lock)
                string fastData, slowData, staticData, portraitData, inventoryData, storedResourcesData, itemIconData;
                lock (dataLock)
                {
                    fastData = cachedFastData;
                    slowData = cachedSlowData;
                    staticData = cachedStaticData;
                    portraitData = cachedPortraits;
                    inventoryData = cachedInventoryData;
                    storedResourcesData = cachedStoredResources;
                    itemIconData = cachedItemIcons;
                }

                // CRITICAL: Get camera bounds on MAIN thread (Unity API)
                CellRect viewRect = Find.CameraDriver.CurrentViewRect;
                string cameraBounds = $"{{\"minX\":{viewRect.minX},\"maxX\":{viewRect.maxX},\"minZ\":{viewRect.minZ},\"maxZ\":{viewRect.maxZ},\"width\":{viewRect.Width},\"height\":{viewRect.Height}}}";

                // PERFORMANCE FIX: Move heavy processing OFF main thread
                var payload = await Task.Run(() =>
                {
                    // Base64 encoding off main thread
                    string screenshotBase64 = "";
                    if (screenshotBytes != null && screenshotBytes.Length > 0)
                    {
                        screenshotBase64 = Convert.ToBase64String(screenshotBytes);
                    }

                    // Merge JSON strings off main thread (including portraits)
                    string combinedGameState = MergeCachedDataOffThread(fastData, slowData, staticData, portraitData, inventoryData, storedResourcesData, itemIconData, cameraBounds);

                    return new UpdatePayload
                    {
                        screenshot = screenshotBase64,
                        gameState = combinedGameState
                    };
                });

                // Send to server (async, won't block)
                await PlayerStorytellerMod.SendUpdateToServerAsync(payload);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in OnScreenshotReady: {ex.Message}\n{ex.StackTrace}");
            }
        }

        private string MergeCachedDataOffThread(string fast, string slow, string staticStr, string portraits, string inventory, string storedResources, string itemIcons, string cameraBounds)
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

            // Add inventory
            if (!string.IsNullOrEmpty(inventory) && inventory != "{}")
            {
                string trimmed = inventory.Trim();
                if (trimmed.Length > 2)
                {
                    if (hasContent) sb.Append(',');
                    sb.Append(trimmed, 1, trimmed.Length - 2); // Expecting {"inventory":...} so strip braces
                    hasContent = true;
                }
            }

            // Add stored resources
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

            // Add camera bounds for ping coordinate mapping
            if (!string.IsNullOrEmpty(cameraBounds))
            {
                if (hasContent) sb.Append(',');
                sb.Append("\"camera\":");
                sb.Append(cameraBounds);
            }

            sb.Append("}");
            return sb.ToString();
        }


        // Update FAST data: Colonists (frequently changing)
        private async void UpdateFastDataAsync()
        {
            try
            {
                const string rimapiUrl = "http://localhost:8765/api/v1";
                int mapId = map.uniqueID;

                // PERFORMANCE FIX: Simplified - only fetch colonists detailed
                string colonistsJson = await SafeFetchAsync($"{rimapiUrl}/colonists/detailed?map_id={mapId}", "colonists");

                if (!string.IsNullOrEmpty(colonistsJson))
                {
                    string result = "{\"colonists\":" + colonistsJson + "}";
                    lock (dataLock)
                    {
                        cachedFastData = result;
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in UpdateFastDataAsync: {ex.Message}");
            }
        }

        // Update SLOW data: Resources, power, creatures, weather (moderately changing)
        private async void UpdateSlowDataAsync()
        {
            try
            {
                const string rimapiUrl = "http://localhost:8765/api/v1";
                int mapId = map.uniqueID;

                // PERFORMANCE FIX: Fetch all 3 in parallel for speed
                var resourcesTask = SafeFetchAsync($"{rimapiUrl}/resources/summary?map_id={mapId}", "resources");
                var powerTask = SafeFetchAsync($"{rimapiUrl}/map/power/info?map_id={mapId}", "power");
                var creaturesTask = SafeFetchAsync($"{rimapiUrl}/map/creatures/summary?map_id={mapId}", "creatures");

                // Wait for all to complete in parallel
                await Task.WhenAll(resourcesTask, powerTask, creaturesTask);

                // Check if we got at least some data before updating cache
                string resourcesJson = await resourcesTask;
                string powerJson = await powerTask;
                string creaturesJson = await creaturesTask;

                // If all failed, don't update cache
                if (string.IsNullOrEmpty(resourcesJson) && string.IsNullOrEmpty(powerJson) && string.IsNullOrEmpty(creaturesJson))
                {
                    return;
                }

                // PERFORMANCE FIX: Use StringBuilder for JSON construction
                var sb = new StringBuilder(capacity: 512);
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
                }

                sb.Append("}");
                string result = sb.ToString();

                lock (dataLock)
                {
                    cachedSlowData = result;
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in UpdateSlowDataAsync: {ex.Message}");
            }
        }

        // Update STORED RESOURCES: Items in storage zones
        private async void UpdateStoredResourcesAsync()
        {
            try
            {
                const string rimapiUrl = "http://localhost:8765/api/v1";
                int mapId = map.uniqueID;

                string json = await SafeFetchAsync($"{rimapiUrl}/resources/stored?map_id={mapId}", "stored_resources");
                
                if (!string.IsNullOrEmpty(json))
                {
                    lock (dataLock)
                    {
                        cachedStoredResources = json;
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in UpdateStoredResourcesAsync: {ex.Message}");
            }
        }

        // Update INVENTORY data: Items carried by colonists
        private async void UpdateInventoryAsync()
        {
            try
            {
                const string rimapiUrl = "http://localhost:8765/api/v1";

                // Get list of current colonists from cached fast data
                string colonistsData;
                lock (dataLock)
                {
                    colonistsData = cachedFastData;
                }

                if (string.IsNullOrEmpty(colonistsData) || colonistsData == "{}") return;

                // Parse colonist IDs (simple string search to avoid JSON library dependency)
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
                var inventoryTasks = colonistIds.Select(id => SafeFetchAsync($"{rimapiUrl}/colonist/inventory?id={id}", $"inventory_{id}")).ToList();
                var inventories = await Task.WhenAll(inventoryTasks);

                // Build JSON
                var sb = new StringBuilder(capacity: 1024);
                sb.Append("{\"inventory\":{");
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

                sb.Append("}}");
                
                if (hasData)
                {
                    lock (dataLock)
                    {
                        cachedInventoryData = sb.ToString();
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in UpdateInventoryAsync: {ex.Message}");
            }
        }


        // Update STATIC data: Factions, research (rarely changes)
        private async void UpdateStaticDataAsync()
        {
            try
            {
                const string rimapiUrl = "http://localhost:8765/api/v1";

                // PERFORMANCE FIX: Fetch all in parallel
                var researchTask = SafeFetchAsync($"{rimapiUrl}/research/progress", "research");
                var factionsTask = SafeFetchAsync($"{rimapiUrl}/factions", "factions");
                var modsTask = SafeFetchAsync($"{rimapiUrl}/mods/info", "mods");

                // Wait for all to complete in parallel
                await Task.WhenAll(researchTask, factionsTask, modsTask);

                string researchJson = await researchTask;
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
                sb.Append("\"networkQuality\":\"");
                sb.Append(PlayerStorytellerMod.settings.networkQuality);
                sb.Append("\"");

                sb.Append("}");
                string result = sb.ToString();

                lock (dataLock)
                {
                    cachedStaticData = result;
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in UpdateStaticDataAsync: {ex.Message}");
            }
        }

        // Update PORTRAIT data: Colonist portraits (changes when colonists change)
        private async void UpdatePortraitsAsync()
        {
            try
            {
                const string rimapiUrl = "http://localhost:8765/api/v1";

                // Get list of current colonists from cached fast data
                string colonistsData;
                lock (dataLock)
                {
                    colonistsData = cachedFastData;
                }

                if (string.IsNullOrEmpty(colonistsData) || colonistsData == "{}")
                {
                    Log.Warning("[Player Storyteller] No colonist data available for portrait fetching");
                    return;
                }

                // Parse colonist IDs from JSON (simple string search to avoid JSON library dependency)
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

                if (colonistIds.Count == 0)
                {
                    // Don't log - this is normal when no colonists are loaded yet
                    return;
                }

                // Only log the first time we discover colonists
                if (colonistPortraitCache.Count == 0 && colonistIds.Count > 0)
                {
                    Log.Message($"[Player Storyteller] Found {colonistIds.Count} colonists, will fetch portraits");
                }

                // Fetch portraits for colonists we don't have cached
                var portraitTasks = new List<Task<(string id, string portrait)>>();
                int fetchCount = 0;
                foreach (var colonistId in colonistIds)
                {
                    if (!colonistPortraitCache.ContainsKey(colonistId))
                    {
                        fetchCount++;
                        portraitTasks.Add(FetchColonistPortraitAsync(rimapiUrl, colonistId));
                    }
                }

                if (fetchCount > 0)
                {
                    var results = await Task.WhenAll(portraitTasks);

                    int successCount = 0;
                    foreach (var (id, portrait) in results)
                    {
                        if (!string.IsNullOrEmpty(portrait))
                        {
                            colonistPortraitCache[id] = portrait;
                            successCount++;
                        }
                    }

                    if (successCount > 0)
                    {
                        Log.Message($"[Player Storyteller] Successfully fetched {successCount}/{fetchCount} colonist portraits");
                    }
                }

                // Build JSON with all cached portraits
                var sb = new StringBuilder(capacity: colonistPortraitCache.Count * 256);
                sb.Append("{");
                bool first = true;
                foreach (var kvp in colonistPortraitCache)
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

                lock (dataLock)
                {
                    cachedPortraits = sb.ToString();
                }

                Log.Message($"[Player Storyteller] Portrait cache updated: {colonistPortraitCache.Count} portraits");
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in UpdatePortraitsAsync: {ex.Message}");
            }
        }

        private async Task<(string id, string portrait)> FetchColonistPortraitAsync(string rimapiUrl, string pawnId)
        {
            try
            {
                // RIMAPI portrait endpoint uses GET (not POST)
                // URL encode the pawn ID in case it contains special characters
                string encodedPawnId = Uri.EscapeDataString(pawnId);
                string url = $"{rimapiUrl}/pawn/portrait/image?pawn_id={encodedPawnId}&width=64&height=64&direction=south";

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
                            int imageStart = imageIndex + key.Length;
                            int imageEnd = jsonResponse.IndexOf("\"", imageStart);
                            if (imageEnd != -1)
                            {
                                string base64Image = jsonResponse.Substring(imageStart, imageEnd - imageStart);
                                return (pawnId, base64Image);
                            }
                        }
                    }

                    // Portrait response didn't contain expected image field - silently skip
                }
                else if (response.StatusCode != System.Net.HttpStatusCode.NotFound)
                {
                    // Only log non-404 errors (404 just means portrait not available)
                    Log.Message($"[Player Storyteller] Portrait endpoint returned HTTP {response.StatusCode} for colonist {pawnId}");
                }
            }
            catch (TaskCanceledException)
            {
                // Timeout - silently skip
            }
            catch (Exception ex)
            {
                // Only log the first error to avoid spam
                if (colonistPortraitCache.Count == 0)
                {
                    Log.Message($"[Player Storyteller] Portrait fetching unavailable: {ex.Message} (will retry silently)");
                }
            }

            return (pawnId, null);
        }


        private async Task<string> SafeFetchAsync(string url, string sectionName)
        {
            try
            {
                var response = await rimapiClient.GetStringAsync(url);

                // Basic validation - just check if it's valid JSON
                if (string.IsNullOrWhiteSpace(response))
                    return null;

                response = response.Trim();

                // Must start with { or [
                if (!response.StartsWith("{") && !response.StartsWith("["))
                {
                    Log.Warning($"[Player Storyteller] Invalid JSON from {sectionName}: doesn't start with {{ or [");
                    return null;
                }

                return response;
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

        // Update ITEM ICONS: Fetch icons for ALL visible items (inventory + storage)
        private async void UpdateItemIconsAsync()
        {
            try
            {
                const string rimapiUrl = "http://localhost:8765/api/v1";
                int mapId = map.uniqueID;

                // Collect ALL unique defNames from stored resources and inventories
                var defNamesToFetch = new HashSet<string>();

                // Add action panel items (always needed)
                foreach (var defName in actionItemDefs)
                {
                    defNamesToFetch.Add(defName);
                }

                // Parse stored resources from cached data to extract defNames
                string storedResourcesData;
                lock (dataLock)
                {
                    storedResourcesData = cachedStoredResources;
                }

                if (!string.IsNullOrEmpty(storedResourcesData) && storedResourcesData != "{}")
                {
                    // Extract def_name fields from JSON
                    ExtractDefNamesFromJson(storedResourcesData, defNamesToFetch);
                }

                // Parse inventory data from cached data to extract defNames
                string inventoryData;
                lock (dataLock)
                {
                    inventoryData = cachedInventoryData;
                }

                if (!string.IsNullOrEmpty(inventoryData) && inventoryData != "{}")
                {
                    // Extract defName fields from JSON
                    ExtractDefNamesFromJson(inventoryData, defNamesToFetch);
                }

                // Only fetch icons we don't already have
                var defNamesToFetchNow = defNamesToFetch.Where(defName => !itemIconCache.ContainsKey(defName)).ToList();

                if (defNamesToFetchNow.Count > 0)
                {
                    // Fetch in batches of 10 to avoid overwhelming RimAPI
                    const int batchSize = 10;
                    int successCount = 0;

                    for (int i = 0; i < defNamesToFetchNow.Count; i += batchSize)
                    {
                        var batch = defNamesToFetchNow.Skip(i).Take(batchSize).ToList();
                        var iconTasks = batch.Select(defName => FetchItemIconAsync(rimapiUrl, defName)).ToList();
                        var results = await Task.WhenAll(iconTasks);

                        foreach (var (defName, icon) in results)
                        {
                            if (!string.IsNullOrEmpty(icon))
                            {
                                itemIconCache[defName] = icon;
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
                        Log.Message($"[Player Storyteller] Fetched {successCount} new item icons (total cached: {itemIconCache.Count})");
                    }
                }

                // Build JSON with all cached icons
                var sb = new StringBuilder(capacity: itemIconCache.Count * 1024);
                sb.Append("{");
                bool first = true;
                foreach (var kvp in itemIconCache)
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

                lock (dataLock)
                {
                    cachedItemIcons = sb.ToString();
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in UpdateItemIconsAsync: {ex.Message}");
            }
        }

        // Extract defName/def_name fields from JSON string (simple parser to avoid dependencies)
        private void ExtractDefNamesFromJson(string json, HashSet<string> defNames)
        {
            if (string.IsNullOrEmpty(json)) return;

            // Look for "def_name":"<value>" or "defName":"<value>"
            var patterns = new[] { "\"def_name\":\"", "\"defName\":\"" };

            foreach (var pattern in patterns)
            {
                int startIndex = 0;
                while (true)
                {
                    int defIndex = json.IndexOf(pattern, startIndex);
                    if (defIndex == -1) break;

                    int valueStart = defIndex + pattern.Length;
                    int valueEnd = json.IndexOf("\"", valueStart);

                    if (valueEnd == -1) break;

                    string defName = json.Substring(valueStart, valueEnd - valueStart);
                    if (!string.IsNullOrEmpty(defName))
                    {
                        defNames.Add(defName);
                    }

                    startIndex = valueEnd;
                }
            }
        }

        private async Task<(string defName, string icon)> FetchItemIconAsync(string rimapiUrl, string defName)
        {
            try
            {
                string encodedDefName = Uri.EscapeDataString(defName);
                string url = $"{rimapiUrl}/item/image?name={encodedDefName}";

                var response = await rimapiClient.GetAsync(url);

                if (response.IsSuccessStatusCode)
                {
                    var jsonResponse = await response.Content.ReadAsStringAsync();

                    // Extract base64 image from JSON
                    // Looking for "image":"..." or "base64":"..."
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
                // Silently fail
            }

            return (defName, null);
        }

    }

    /// <summary>
    /// PERFORMANCE OPTIMIZED: Helper MapComponent to run coroutines since MapComponents don't have native coroutine support
    /// Key optimizations:
    /// 1. Only checks coroutines every 30 ticks (0.5s) instead of every tick (60fps)
    /// 2. Caches reflection lookup for WaitForSeconds
    /// 3. Time-based checking instead of constant polling
    /// </summary>
    public class CoroutineHandler : MapComponent
    {
        private List<CoroutineInstance> activeCoroutines = new List<CoroutineInstance>();
        private static System.Reflection.FieldInfo waitSecondsField;

        public CoroutineHandler(Map map) : base(map)
        {
            // PERFORMANCE FIX: Cache reflection lookup once at startup
            if (waitSecondsField == null)
            {
                waitSecondsField = typeof(WaitForSeconds).GetField("m_Seconds",
                    System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            }
        }

        public Coroutine StartCoroutine(IEnumerator routine)
        {
            var instance = new CoroutineInstance(routine);
            activeCoroutines.Add(instance);
            return instance;
        }

        public void StopCoroutine(Coroutine coroutine)
        {
            if (coroutine is CoroutineInstance instance)
            {
                instance.stopped = true;
                activeCoroutines.Remove(instance);
            }
        }

        public override void MapComponentTick()
        {
            base.MapComponentTick();

            // CRITICAL PERFORMANCE FIX: Only process coroutines every 30 ticks (0.5s) instead of 60 times per second
            // This reduces overhead by 30x while maintaining responsiveness
            if (Find.TickManager.TicksGame % PlayerStorytellerMapComponent.CoroutineCheckInterval != 0)
                return;

            float currentTime = Time.realtimeSinceStartup;

            // Process all active coroutines
            for (int i = activeCoroutines.Count - 1; i >= 0; i--)
            {
                var coroutine = activeCoroutines[i];

                if (coroutine.stopped)
                {
                    activeCoroutines.RemoveAt(i);
                    continue;
                }

                try
                {
                    // Only process if it's time to wake up
                    if (coroutine.ShouldTick(currentTime))
                    {
                        if (!coroutine.MoveNext(currentTime))
                        {
                            // Coroutine finished
                            activeCoroutines.RemoveAt(i);
                        }
                    }
                }
                catch (Exception ex)
                {
                    Log.Error($"[Player Storyteller] Coroutine error: {ex.Message}\n{ex.StackTrace}");
                    activeCoroutines.RemoveAt(i);
                }
            }
        }

        private class CoroutineInstance : Coroutine
        {
            private IEnumerator routine;
            private float waitUntilTime;
            public bool stopped;

            public CoroutineInstance(IEnumerator routine)
            {
                this.routine = routine;
                this.waitUntilTime = 0f; // Ready to run immediately
            }

            public bool ShouldTick(float currentTime)
            {
                // PERFORMANCE FIX: Simple time check instead of reflection every tick
                return currentTime >= waitUntilTime;
            }

            public bool MoveNext(float currentTime)
            {
                if (stopped) return false;

                // Move to next yield
                if (!routine.MoveNext())
                {
                    return false; // Coroutine finished
                }

                // Process the yield instruction and set next wake time
                var current = routine.Current;
                if (current is WaitForSeconds waitForSeconds)
                {
                    waitUntilTime = currentTime + GetWaitTime(waitForSeconds);
                }
                else if (current is YieldInstruction)
                {
                    // For other yield instructions, check again next tick
                    waitUntilTime = currentTime;
                }
                else
                {
                    // No yield or null, ready immediately
                    waitUntilTime = currentTime;
                }

                return true;
            }

            private static float GetWaitTime(WaitForSeconds waitForSeconds)
            {
                // PERFORMANCE FIX: Use cached reflection field instead of looking up every time
                if (waitSecondsField != null)
                {
                    return (float)waitSecondsField.GetValue(waitForSeconds);
                }

                return 0f;
            }
        }
    }

    public class Coroutine
    {
        // Base class for coroutine handles
    }
}

