using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;
using Verse;
using Verse.AI;
using RimWorld;
using Newtonsoft.Json;

namespace PlayerStoryteller
{
    /// <summary>
    /// Handles the execution of specific viewer actions.
    /// Contains the game logic for events, spawning, healing, etc.
    /// </summary>
    public class GameActionExecutor
    {
        private readonly Map map;
        private readonly RimApiClient rimApiClient = new RimApiClient();
        private const int MaxMessageLength = 500;

        public GameActionExecutor(Map map)
        {
            this.map = map;
        }

        public void ExecuteAction(PlayerAction action)
        {
            try
            {
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
                    case "psychicSoothe":
                        TriggerIncident("PsychicSoothe");
                        break;
                    case "ambrosiaSprout":
                        TriggerIncident("AmbrosiaSprout");
                        break;
                    case "farmAnimalsWanderIn":
                        TriggerIncident("FarmAnimalsWanderIn");
                        break;
                    case "aurora":
                        TriggerIncident("Aurora");
                        break;

                    // ===== EVENTS - NEUTRAL/RISKY =====
                    case "thrumboPasses":
                        TriggerIncident("ThrumboPasses");
                        break;
                    case "herdMigration":
                        TriggerIncident("HerdMigration");
                        break;
                    case "wildManWandersIn":
                        TriggerIncident("WildManWandersIn");
                        break;
                    case "ransomDemand":
                        TriggerIncident("RansomDemand");
                        break;

                    // ===== EVENTS - CHALLENGES =====
                    case "raid":
                        TriggerRaid();
                        break;
                    case "manhunter":
                        TriggerManhunterPack();
                        break;
                    case "infestation":
                        TriggerIncident("Infestation", IncidentCategoryDefOf.ThreatBig);
                        break;
                    case "mechShip":
                        TriggerMechShip();
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
                    case "volcanicWinter":
                        TriggerIncident("VolcanicWinter");
                        break;
                    case "flashstorm":
                        TriggerFlashstorm();
                        break;
                    case "psychicDrone":
                        TriggerIncident("PsychicDrone");
                        break;
                    case "shortCircuit":
                        TriggerIncident("ShortCircuit");
                        break;
                    case "cropBlight":
                        TriggerIncident("CropBlight");
                        break;
                    case "alphabeavers":
                        TriggerIncident("Alphabeavers");
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
                    
                    // ===== EXPANDED WEATHER =====
                    case "weatherVomit":
                        WeatherEventHelper.TriggerVomitRain(map);
                        break;
                    case "weatherHeatWave":
                        WeatherEventHelper.TriggerHeatWave(map);
                        break;
                    case "weatherColdSnap":
                        WeatherEventHelper.TriggerColdSnap(map);
                        break;
                    case "weatherDryStorm":
                        WeatherEventHelper.TriggerDryThunderstorm(map);
                        break;
                    case "weatherFoggyRain":
                        WeatherEventHelper.TriggerFoggyRain(map);
                        break;
                    case "weatherSnowGentle":
                        WeatherEventHelper.TriggerSnowGentle(map);
                        break;
                    case "weatherSnowHard":
                        WeatherEventHelper.TriggerSnowHard(map);
                        break;

                    // ===== DLC EVENTS =====
                    
                    // ROYALTY
                    case "dlcLaborers": DLCHelper.TriggerLaborerTeam(map); break;
                    case "dlcTribute": DLCHelper.TriggerTributeCollector(map); break;
                    case "dlcAnimaTree": DLCHelper.TriggerAnimaTree(map); break;
                    case "dlcMechCluster": DLCHelper.TriggerMechCluster(map); break;

                    // IDEOLOGY
                    case "dlcRitual": DLCHelper.TriggerDateRitual(map); break;
                    case "dlcGauranlen": DLCHelper.SpawnGauranlenPod(map); break;
                    case "dlcHackerCamp": DLCHelper.TriggerHackerCamp(map); break;
                    case "dlcInsectJelly": DLCHelper.TriggerInsectJelly(map); break;
                    case "dlcSkylanterns": DLCHelper.TriggerSkylanterns(map); break;

                    // BIOTECH
                    case "dlcDiabolus": DLCHelper.SummonDiabolus(map); break;
                    case "dlcWarqueen": DLCHelper.SummonWarqueen(map); break;
                    case "dlcApocriton": DLCHelper.SummonApocriton(map); break;
                    case "dlcWastepack": DLCHelper.DropWastepack(map); break;
                    case "dlcSanguophage": DLCHelper.SummonSanguophage(map); break;
                    case "dlcGenepack": DLCHelper.DropGenepack(map); break;
                    case "dlcPoluxTree": DLCHelper.TriggerPoluxTree(map); break;
                    case "dlcAcidicSmog": DLCHelper.TriggerAcidicSmog(map); break;
                    case "dlcWastepackInfestation": DLCHelper.TriggerWastepackInfestation(map); break;

                    // ANOMALY
                    case "dlcDeathPall": DLCHelper.TriggerDeathPall(map); break;
                    case "dlcBloodRain": DLCHelper.TriggerBloodRain(map); break;
                    case "dlcDarkness": DLCHelper.TriggerUnnaturalDarkness(map); break;
                    case "dlcShamblers": DLCHelper.SummonShamblers(map); break;
                    case "dlcFleshbeasts": DLCHelper.SummonFleshbeasts(map); break;
                    case "dlcPitGate": DLCHelper.TriggerPitGate(map); break;
                    case "dlcChimera": DLCHelper.TriggerChimera(map); break;
                    case "dlcNociosphere": DLCHelper.TriggerNociosphere(map); break;
                    case "dlcGoldenCube": DLCHelper.TriggerGoldenCube(map); break;
                    case "dlcMetalhorror": DLCHelper.TriggerMetalhorror(map); break;

                    // ODYSSEY
                    case "dlcGravship": DLCHelper.TriggerGravshipCrash(map); break;
                    case "dlcDrones": DLCHelper.SpawnExplosiveDrones(map); break;
                    case "dlcOrbitalTrader": DLCHelper.TriggerOrbitalTrader(map); break;
                    case "dlcOrbitalDebris": DLCHelper.TriggerOrbitalDebris(map); break;
                    case "dlcMechanoidSignal": DLCHelper.TriggerMechanoidSignal(map); break;

                    // ===== DYNAMIC CONTENT =====
                    case "change_weather_dynamic":
                        ChangeWeather(action.data);
                        break;
                    case "trigger_incident_dynamic":
                        TriggerIncidentDynamic(action.data);
                        break;
                    case "spawn_pawn_dynamic":
                        SpawnPawnDynamic(action.data);
                        break;

                    // ===== FACTIONS =====
                    case "changeFactionGoodwill":
                        ChangeFactionGoodwill(action.data);
                        break;

                    // ===== VIEWER INTEGRATION =====
                    case "buyPawn":
                        BuyPawn(action.data);
                        break;
                    case "adopt_colonist":
                        AdoptColonist(action.data);
                        break;
                    case "colonist_command":
                        ExecuteColonistCommand(action.data);
                        break;

                    // ===== NEW INTERACTIONS =====
                    case "setFire":
                        SetFireAtLocation(action.data);
                        break;
                    case "destroyObject":
                        DestroyObject(action.data);
                        break;
                    case "startSocialFight":
                        StartSocialFight(action.data);
                        break;

                    default:
                        Log.Warning($"[Player Storyteller] Unknown player action: {action.action}");
                        break;
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error processing action '{action.action}': {ex}");
            }
        }

        private void AdoptColonist(string json)
        {
            try
            {
                if (string.IsNullOrEmpty(json)) return;
                var data = JsonConvert.DeserializeObject<AdoptColonistData>(json);
                if (data == null || string.IsNullOrEmpty(data.username) || string.IsNullOrEmpty(data.pawnId))
                {
                    Log.Warning("[Player Storyteller] AdoptColonist: Invalid data.");
                    return;
                }

                string username = SanitizeUserInput(data.username);
                Pawn pawn = map.mapPawns.AllPawns.FirstOrDefault(p => p.thingIDNumber.ToString() == data.pawnId);

                if (pawn == null)
                {
                    Messages.Message($"Could not find pawn for adoption (ID: {data.pawnId})", MessageTypeDefOf.RejectInput);
                    return;
                }

                ViewerManager viewerManager = map.GetComponent<ViewerManager>();
                if (viewerManager == null) return;

                if (viewerManager.ViewerHasActivePawn(username))
                {
                    Messages.Message($"Viewer {username} already has a pawn!", MessageTypeDefOf.RejectInput);
                    return;
                }

                // Register
                viewerManager.RegisterPawn(username, pawn);

                // Notify player of adoption (nickname preserved from existing pawn)
                string label = "Colonist Adopted";
                string text = $"Viewer {username} has adopted {pawn.Name.ToStringShort} via the Neural Link.";
                Find.LetterStack.ReceiveLetter(label, text, LetterDefOf.PositiveEvent, pawn);
                Messages.Message($"{pawn.Name.ToStringShort} is now controlled by {username}!", MessageTypeDefOf.PositiveEvent);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error adopting colonist: {ex}");
            }
        }

        private void ExecuteColonistCommand(string json)
        {
            try
            {
                if (map == null)
                {
                    Log.Error("[Player Storyteller] ExecuteColonistCommand: Map is null!");
                    return;
                }

                // Robust JSON parsing with Newtonsoft
                if (string.IsNullOrEmpty(json)) return;
                var data = JsonConvert.DeserializeObject<ColonistCommandData>(json);
                if (data == null) return;
                if (string.IsNullOrEmpty(data.pawnId)) return;

                Pawn pawn = map.mapPawns.AllPawns.FirstOrDefault(p => 
                    p.thingIDNumber.ToString() == data.pawnId || 
                    (p.Name != null && p.Name.ToStringFull == data.pawnId)
                ); 

                if (pawn == null) 
                {
                    // Silent fail or debug log if pawn not found (common if pawn died/left)
                    return;
                }

                switch (data.type)
                {
                    case "draft":
                        if (pawn.Drafted) break;
                        pawn.drafter.Drafted = true;
                        Messages.Message($"{pawn.Name.ToStringShort} drafted by viewer.", MessageTypeDefOf.PositiveEvent);
                        break;
                    case "undraft":
                        if (!pawn.Drafted) break;
                        pawn.drafter.Drafted = false;
                        break;
                    case "order":
                        IntVec3 target = new IntVec3(data.x, 0, data.z);
                        if (target.InBounds(map))
                        {
                            // Basic move order logic (Simplified to fix build errors)
                            // To restore context logic, ensure FloatMenuMakerMap is accessible or replicate logic
                            
                            bool isDrafted = pawn.drafter != null && pawn.drafter.Drafted;

                            if (isDrafted)
                            {
                                if (pawn.jobs != null)
                                {
                                    Job job = JobMaker.MakeJob(JobDefOf.Goto, target);
                                    pawn.jobs.TryTakeOrderedJob(job, JobTag.Misc);
                                }
                                
                                // Feedback (optional visual mote, may not exist in all RimWorld versions)
                                ThingDef moteDef = DefDatabase<ThingDef>.GetNamedSilentFail("Mote_FeedbackGoto");
                                if (moteDef != null)
                                {
                                    MoteMaker.MakeStaticMote(target, map, moteDef, 1f);
                                }
                            }
                            else
                            {
                                // Undrafted pawns cannot receive move orders (respect game rules)
                                Messages.Message($"{pawn.Name.ToStringShort} is not drafted.", MessageTypeDefOf.RejectInput, false);
                            }
                        }
                        break;
                    case "set_work_priorities":
                        if (data.priorities != null && pawn.workSettings != null)
                        {
                            foreach (var kvp in data.priorities)
                            {
                                // Attempt to find the WorkTypeDef by name (e.g., "Firefighter", "Doctor")
                                WorkTypeDef workDef = DefDatabase<WorkTypeDef>.GetNamedSilentFail(kvp.Key);
                                if (workDef != null)
                                {
                                    // 0 = Disabled, 1 = Highest, 4 = Lowest
                                    // Ensure value is clamped to valid range if necessary, though SetPriority usually handles it or just accepts int.
                                    pawn.workSettings.SetPriority(workDef, kvp.Value);
                                }
                            }
                            Messages.Message($"{pawn.Name.ToStringShort}'s work priorities updated.", MessageTypeDefOf.NeutralEvent);
                        }
                        break;
                    case "set_schedule":
                        if (!string.IsNullOrEmpty(data.assignment))
                        {
                             _ = rimApiClient.SetColonistSchedule(data.pawnId, data.hour, data.assignment);
                             // Messages.Message($"{pawn.Name.ToStringShort}'s schedule updated.", MessageTypeDefOf.NeutralEvent); // Spammy if bulk update
                        }
                        break;
                    case "select":
                        _ = rimApiClient.SelectColonist(pawn.thingIDNumber.ToString());
                        break;
                    case "toggle_draft":
                        if (pawn.drafter != null)
                        {
                            pawn.drafter.Drafted = !pawn.drafter.Drafted;
                        }
                        break;
                    case "rename":
                        if (!string.IsNullOrEmpty(data.newName))
                        {
                            string cleanName = SanitizeUserInput(data.newName);
                            if (cleanName.Length > 0)
                            {
                                NameTriple currentName = pawn.Name as NameTriple;
                                pawn.Name = new NameTriple(currentName?.First ?? "Viewer", cleanName, currentName?.Last ?? "Player");
                                Messages.Message($"{currentName?.ToStringShort ?? "Colonist"} renamed to {cleanName}.", MessageTypeDefOf.NeutralEvent);
                            }
                        }
                        break;
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error executing colonist command: {ex}");
            }
        }

        // ============================================ 
        // VIEWER INTEGRATION
        // ============================================ 

        private void BuyPawn(string data)
        {
            try
            {
                string username = data;
                string nickname = data;

                // Attempt JSON parse
                if (data.Trim().StartsWith("{"))
                {
                    try 
                    {
                        var buyData = JsonConvert.DeserializeObject<BuyPawnData>(data);
                        if (buyData != null && !string.IsNullOrEmpty(buyData.username))
                        {
                            username = buyData.username;
                            nickname = !string.IsNullOrEmpty(buyData.nickname) ? buyData.nickname : buyData.username;
                        }
                    }
                    catch
                    {
                        // Fallback to manual parsing
                        if (data.Contains("\"username\""))
                        {
                             int start = data.IndexOf("\"username\"") + 10;
                             int valStart = data.IndexOf("\"", start) + 1;
                             int valEnd = data.IndexOf("\"", valStart);
                             if (valStart > 0 && valEnd > valStart)
                             {
                                 username = data.Substring(valStart, valEnd - valStart);
                                 nickname = username;
                             }
                        }
                    }
                }
                
                username = SanitizeUserInput(username);
                nickname = SanitizeUserInput(nickname);
                
                if (string.IsNullOrEmpty(username)) return;

                ViewerManager viewerManager = map.GetComponent<ViewerManager>();
                if (viewerManager == null)
                {
                    Log.Error("[Player Storyteller] ViewerManager MapComponent not found!");
                    return;
                }

                if (viewerManager.ViewerHasActivePawn(username))
                {
                    Messages.Message($"Viewer {username} is already in the colony!", MessageTypeDefOf.RejectInput);
                    return;
                }

                // Generate Pawn
                PawnKindDef pawnKind = PawnKindDefOf.Colonist;
                Faction faction = Faction.OfPlayer;
                
                // Use simplified constructor to avoid version mismatch on arguments
                // Args: Kind, Faction, Context, Tile, ForceGenerateNew
                PawnGenerationRequest request = new PawnGenerationRequest(
                    pawnKind, 
                    faction, 
                    PawnGenerationContext.NonPlayer, 
                    -1, 
                    true
                );
                
                Pawn newPawn = PawnGenerator.GeneratePawn(request);

                // Rename Pawn
                NameTriple oldName = newPawn.Name as NameTriple;
                newPawn.Name = new NameTriple(oldName?.First ?? "Viewer", nickname, oldName?.Last ?? "Player");

                // Spawn
                IntVec3 spawnLoc;
                if (CellFinder.TryFindRandomEdgeCellWith((IntVec3 c) => map.reachability.CanReachColony(c) && !c.Fogged(map), map, CellFinder.EdgeRoadChance_Neutral, out spawnLoc))
                {
                    GenSpawn.Spawn(newPawn, spawnLoc, map, WipeMode.Vanish);
                    
                    // Register
                    viewerManager.RegisterPawn(username, newPawn);

                    // Notify
                    string label = "Viewer Joined";
                    string text = $"Viewer {username} has bought a ticket to the Rim! They have joined the colony as '{nickname}'.";
                    Find.LetterStack.ReceiveLetter(label, text, LetterDefOf.PositiveEvent, newPawn);
                    Messages.Message($"Viewer {username} has joined!", MessageTypeDefOf.PositiveEvent);
                }
                else
                {
                    Log.Warning($"[Player Storyteller] Could not find safe spawn location for viewer {username}");
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in BuyPawn: {ex}");
            }
        }

        // ============================================ 
        // COLONISTS & PEOPLE
        // ============================================ 

        private void StartQuest()
        {
            try
            {
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
                Log.Error($"[Player Storyteller] Error starting quest: {ex}");
            }
        }

        private void SendRefugee()
        {
            try
            {
                IncidentDef refugeeDef = DefDatabase<IncidentDef>.GetNamedSilentFail("RefugeeChased")
                    ?? DefDatabase<IncidentDef>.GetNamedSilentFail("RefugeePodCrash");

                if (refugeeDef == null)
                {
                    Messages.Message("Refugee incident not available.", MessageTypeDefOf.RejectInput);
                    return;
                }

                IncidentParms parms = StorytellerUtility.DefaultParmsNow(IncidentCategoryDefOf.Misc, map);
                parms.forced = true;

                refugeeDef.Worker.TryExecute(parms);
                Messages.Message("A refugee is seeking shelter!", MessageTypeDefOf.PositiveEvent);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error sending refugee: {ex}");
            }
        }

        private void SendWanderer()
        {
            try
            {
                IncidentDef wandererDef = IncidentDefOf.WandererJoin;
                IncidentParms parms = StorytellerUtility.DefaultParmsNow(IncidentCategoryDefOf.Misc, map);
                parms.forced = true;

                wandererDef.Worker.TryExecute(parms);
                Messages.Message("A wanderer has joined your colony!", MessageTypeDefOf.PositiveEvent);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error sending wanderer: {ex}");
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
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error healing colonist: {ex}");
            }
        }

        private void InspireRandomColonist()
        {
            try
            {
                var colonists = map.mapPawns.FreeColonists.ToList();
                if (colonists.Count == 0) return;

                Pawn colonist = colonists.RandomElement();
                var allInspirations = DefDatabase<InspirationDef>.AllDefsListForReading;
                
                if (allInspirations.Count > 0)
                {
                    var inspiration = allInspirations.RandomElement();
                    colonist.mindState.inspirationHandler.TryStartInspiration(inspiration);
                    Messages.Message($"{colonist.Name.ToStringShort} has been inspired: {inspiration.label}!", MessageTypeDefOf.PositiveEvent);
                }
                else
                {
                    if (colonist.needs?.joy != null) colonist.needs.joy.CurLevel = 1f;
                    if (colonist.needs?.comfort != null) colonist.needs.comfort.CurLevel = 1f;
                    if (colonist.needs?.beauty != null) colonist.needs.beauty.CurLevel = 1f;
                    Messages.Message($"{colonist.Name.ToStringShort} feels inspired!", MessageTypeDefOf.PositiveEvent);
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error inspiring colonist: {ex}");
            }
        }

        private void HealAllColonists()
        {
            try
            {
                int healed = 0;
                foreach (Pawn colonist in map.mapPawns.FreeColonists)
                {
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
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error healing colonists: {ex}");
            }
        }

        private void InspireAllColonists()
        {
            try
            {
                int inspired = 0;
                foreach (Pawn colonist in map.mapPawns.FreeColonists)
                {
                    var allInspirations = DefDatabase<InspirationDef>.AllDefsListForReading;
                    if (allInspirations.Count > 0)
                    {
                        var inspiration = allInspirations.RandomElement();
                        colonist.mindState.inspirationHandler.TryStartInspiration(inspiration);
                    }
                    else
                    {
                        if (colonist.needs?.joy != null) colonist.needs.joy.CurLevel = 1f;
                        if (colonist.needs?.comfort != null) colonist.needs.comfort.CurLevel = 1f;
                        if (colonist.needs?.beauty != null) colonist.needs.beauty.CurLevel = 1f;
                    }
                    inspired++;
                }
                Messages.Message($"Viewers inspired all colonists!", MessageTypeDefOf.PositiveEvent);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error inspiring colonists: {ex}");
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
                    case "Food": thingDef = ThingDefOf.MealSurvivalPack; displayName = "survival meals"; break;
                    case "Medicine": thingDef = ThingDefOf.MedicineIndustrial; displayName = "medicine"; break;
                    case "Steel": thingDef = ThingDefOf.Steel; displayName = "steel"; break;
                    case "Components": thingDef = ThingDefOf.ComponentIndustrial; displayName = "components"; break;
                    case "Silver": thingDef = ThingDefOf.Silver; displayName = "silver"; break;
                    default: return;
                }

                Thing item = ThingMaker.MakeThing(thingDef);
                item.stackCount = amount;
                items.Add(item);
                DropPodUtility.DropThingsNear(dropSpot, map, items, forbid: false);
                Messages.Message($"Drop pod delivered {amount} {displayName}!", MessageTypeDefOf.PositiveEvent);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error dropping resource: {ex}");
            }
        }

        private void GiftLegendaryItem()
        {
            try
            {
                var allDefs = new List<ThingDef>();
                allDefs.AddRange(DefDatabase<ThingDef>.AllDefs.Where(d => d.IsWeapon && d.tradeability != Tradeability.None));
                allDefs.AddRange(DefDatabase<ThingDef>.AllDefs.Where(d => d.IsApparel && d.tradeability != Tradeability.None));

                if (allDefs.Count == 0) return;

                ThingDef chosenDef = allDefs.RandomElement();
                Thing item = ThingMaker.MakeThing(chosenDef, GenStuff.RandomStuffFor(chosenDef));
                var qualityComp = item.TryGetComp<CompQuality>();
                if (qualityComp != null)
                {
                    qualityComp.SetQuality(QualityCategory.Legendary, ArtGenerationContext.Colony);
                }

                IntVec3 dropSpot = DropCellFinder.RandomDropSpot(map);
                GenPlace.TryPlaceThing(item, dropSpot, map, ThingPlaceMode.Near);
                Messages.Message($"Viewers sent a legendary {item.Label}!", MessageTypeDefOf.PositiveEvent);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error gifting legendary item: {ex}");
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
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error sending trader: {ex}");
            }
        }

        // ============================================ 
        // ANIMALS
        // ============================================ 

        private void TameRandomAnimal()
        {
            try
            {
                var wildAnimals = map.mapPawns.AllPawns.Where(p => p.AnimalOrWildMan() && p.Faction == null).ToList();
                if (wildAnimals.Count == 0)
                {
                    Messages.Message("No wild animals found on the map.", MessageTypeDefOf.NeutralEvent);
                    return;
                }

                Pawn animal = wildAnimals.RandomElement();
                animal.SetFaction(Faction.OfPlayer);
                Messages.Message($"Viewers tamed a wild {animal.LabelShort}!", MessageTypeDefOf.PositiveEvent);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error taming animal: {ex}");
            }
        }

        private void SpawnRandomAnimal()
        {
            try
            {
                var animalKinds = DefDatabase<PawnKindDef>.AllDefs.Where(k => k.RaceProps != null && k.RaceProps.Animal).ToList();
                if (animalKinds.Count == 0) return;

                PawnKindDef chosenAnimal = animalKinds.RandomElement();
                IntVec3 spawnSpot = CellFinder.RandomClosewalkCellNear(map.Center, map, 20);
                Pawn animal = PawnGenerator.GeneratePawn(chosenAnimal, null);
                GenSpawn.Spawn(animal, spawnSpot, map);
                Messages.Message($"A wild {animal.LabelShort} has appeared!", MessageTypeDefOf.NeutralEvent);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error spawning animal: {ex}");
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
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering positive event: {ex}");
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

                Faction faction = Find.FactionManager.RandomEnemyFaction();
                if (faction == null)
                {
                    Messages.Message("No enemy factions available for raid.", MessageTypeDefOf.RejectInput);
                    return;
                }
                parms.faction = faction;
                parms.raidArrivalMode = PawnsArrivalModeDefOf.EdgeWalkIn;
                parms.raidStrategy = RaidStrategyDefOf.ImmediateAttack;
                
                float storyPoints = StorytellerUtility.DefaultThreatPointsNow(map);
                parms.points = Math.Max(35f, Math.Min(storyPoints * 1.2f, storyPoints));

                if (raidDef.Worker.TryExecute(parms))
                {
                    Messages.Message("Viewers triggered a raid!", MessageTypeDefOf.ThreatBig);
                }
                else
                {
                    Messages.Message("Failed to trigger raid.", MessageTypeDefOf.RejectInput);
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering raid: {ex}");
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
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering manhunter pack: {ex}");
            }
        }

        private void TriggerMadAnimal()
        {
            try
            {
                IncidentDef madAnimalDef = DefDatabase<IncidentDef>.GetNamedSilentFail("AnimalInsanitySingle")
                    ?? DefDatabase<IncidentDef>.GetNamedSilentFail("AnimalInsanityMass");

                if (madAnimalDef == null) return;

                IncidentParms parms = StorytellerUtility.DefaultParmsNow(IncidentCategoryDefOf.ThreatSmall, map);
                parms.forced = true;
                madAnimalDef.Worker.TryExecute(parms);
                Messages.Message("Viewers made animals go mad!", MessageTypeDefOf.ThreatSmall);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering mad animal: {ex}");
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
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering solar flare: {ex}");
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
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering eclipse: {ex}");
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
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering toxic fallout: {ex}");
            }
        }

        private void TriggerFlashstorm()
        {
            try
            {
                IncidentDef flashstormDef = DefDatabase<IncidentDef>.GetNamedSilentFail("Flashstorm")
                    ?? DefDatabase<IncidentDef>.GetNamedSilentFail("FlashStorm");

                if (flashstormDef == null) return;

                IncidentParms parms = StorytellerUtility.DefaultParmsNow(IncidentCategoryDefOf.Misc, map);
                parms.forced = true;
                flashstormDef.Worker.TryExecute(parms);
                Messages.Message("Viewers triggered a flashstorm!", MessageTypeDefOf.NegativeEvent);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering flashstorm: {ex}");
            }
        }

        // ============================================ 
        // CHAOS EVENTS
        // ============================================ 

        private void TriggerMeteorShower()
        {
            try
            {
                IncidentDef meteorDef = DefDatabase<IncidentDef>.GetNamedSilentFail("MeteoriteImpact")
                    ?? DefDatabase<IncidentDef>.GetNamedSilentFail("Meteorite");

                if (meteorDef == null) return;

                IncidentParms parms = StorytellerUtility.DefaultParmsNow(IncidentCategoryDefOf.Misc, map);
                parms.forced = true;
                for (int i = 0; i < 5; i++)
                {
                    meteorDef.Worker.TryExecute(parms);
                }
                Messages.Message("Viewers triggered a meteor shower!", MessageTypeDefOf.NeutralEvent);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering meteor shower: {ex}");
            }
        }

        private void TriggerTornado()
        {
            try
            {
                IncidentDef tornadoDef = DefDatabase<IncidentDef>.GetNamedSilentFail("Tornado");
                if (tornadoDef == null)
                {
                    Messages.Message("Tornado incident not available.", MessageTypeDefOf.RejectInput);
                    return;
                }

                IncidentParms parms = StorytellerUtility.DefaultParmsNow(IncidentCategoryDefOf.Misc, map);
                parms.forced = true;
                tornadoDef.Worker.TryExecute(parms);
                Messages.Message("Viewers summoned a tornado!", MessageTypeDefOf.ThreatBig);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering tornado: {ex}");
            }
        }

        private void TriggerLightningStrike()
        {
            try
            {
                IntVec3 targetCell = CellFinderLoose.RandomCellWith(c => c.Standable(map) && !c.Roofed(map), map);
                map.weatherManager.eventHandler.AddEvent(new WeatherEvent_LightningStrike(map, targetCell));
                Messages.Message("Viewers called down lightning!", MessageTypeDefOf.NeutralEvent);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering lightning: {ex}");
            }
        }

        private void TriggerRandomEvent()
        {
            try
            {
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
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering random event: {ex}");
            }
        }

        // ============================================ 
        // UTILITY
        // ============================================ 

        // ============================================ 
        // DYNAMIC CONTENT HELPERS
        // ============================================ 

        private void TriggerIncidentDynamic(string defName)
        {
            try
            {
                if (string.IsNullOrEmpty(defName)) return;
                
                IncidentDef def = DefDatabase<IncidentDef>.GetNamedSilentFail(defName);
                if (def == null)
                {
                    Log.Warning($"[Player Storyteller] Dynamic Incident not found: {defName}");
                    return;
                }

                IncidentParms parms = StorytellerUtility.DefaultParmsNow(def.category, map);
                parms.forced = true;
                
                if (def.pointsScaleable)
                {
                    float storyPoints = StorytellerUtility.DefaultThreatPointsNow(map);
                    parms.points = Math.Max(35f, storyPoints);
                }

                if (def.Worker.TryExecute(parms))
                {
                    Messages.Message($"Viewers triggered dynamic event: {def.label}", MessageTypeDefOf.NeutralEvent);
                }
                else
                {
                    Messages.Message($"Failed to trigger {def.label} (conditions not met).", MessageTypeDefOf.RejectInput);
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering dynamic incident {defName}: {ex}");
            }
        }

        private void SpawnPawnDynamic(string defName)
        {
            try
            {
                if (string.IsNullOrEmpty(defName)) return;

                PawnKindDef kind = DefDatabase<PawnKindDef>.GetNamedSilentFail(defName);
                if (kind == null)
                {
                    Log.Warning($"[Player Storyteller] Dynamic PawnKind not found: {defName}");
                    return;
                }

                IntVec3 spawnSpot = CellFinder.RandomClosewalkCellNear(map.Center, map, 20);
                Pawn pawn = PawnGenerator.GeneratePawn(kind, null);
                GenSpawn.Spawn(pawn, spawnSpot, map);
                Messages.Message($"Viewers spawned a {pawn.LabelShort}!", MessageTypeDefOf.NeutralEvent);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error spawning dynamic pawn {defName}: {ex}");
            }
        }

        private void ChangeWeather(string weatherDefName)
        {
            if (string.IsNullOrEmpty(weatherDefName)) return;
            WeatherDef weatherDef = DefDatabase<WeatherDef>.GetNamed(weatherDefName, false);
            if (weatherDef == null) return;

            map.weatherManager.TransitionTo(weatherDef);
            Messages.Message($"The weather has changed to {weatherDef.label}.", MessageTypeDefOf.NeutralEvent);
        }

        private void ChangeFactionGoodwill(string data)
        {
            try
            {
                if (string.IsNullOrEmpty(data)) return;
                // Unescape quotes: \" becomes "
                string cleanedData = data.Replace("\\\"", "\"").Trim('"');
                FactionGoodwillData goodwillData;
                try { goodwillData = JsonUtility.FromJson<FactionGoodwillData>(cleanedData); }
                catch { return; }

                if (goodwillData == null || string.IsNullOrEmpty(goodwillData.faction)) return;

                Faction faction = Find.FactionManager.AllFactions.FirstOrDefault(f => f.Name == goodwillData.faction);
                if (faction == null || faction.IsPlayer) return;

                faction.TryAffectGoodwillWith(Faction.OfPlayer, goodwillData.amount, canSendMessage: false, canSendHostilityLetter: false);
                Messages.Message($"Goodwill with {faction.Name} changed.", MessageTypeDefOf.PositiveEvent);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error changing goodwill: {ex}");
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
                message = SanitizeUserInput(message);
                if (string.IsNullOrEmpty(message)) return;

                if (message.Length > MaxMessageLength)
                    message = message.Substring(0, MaxMessageLength) + "...";

                Find.LetterStack.ReceiveLetter("Message from Viewer", message, LetterDefOf.NeutralEvent, (LookTargets)null, null, null);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Exception in ShowLetter: {ex.ToString()}");
            }
        }

        private string SanitizeUserInput(string input)
        {
            if (string.IsNullOrWhiteSpace(input)) return string.Empty;
            var cleaned = new StringBuilder(input.Length);
            foreach (char c in input)
            {
                if (c == '\n' || c == '\r' || c == '\t' || (c >= 32 && c < 127) || (c >= 160 && c <= 255))
                {
                    cleaned.Append(c);
                }
            }
            return cleaned.ToString().Trim();
        }

        private void CreatePing(string coordinatesJson)
        {
            try
            {
                if (map == null) return; // Defensive check for map

                var parts = coordinatesJson.Replace("{", "").Replace("}", "").Replace("\"", "").Split(',');
                int x = 0, z = 0;
                foreach (var part in parts)
                {
                    var kv = part.Split(':');
                    if (kv.Length == 2)
                    {
                        if (kv[0].Trim() == "x") int.TryParse(kv[1].Trim(), out x);
                        if (kv[0].Trim() == "z") int.TryParse(kv[1].Trim(), out z);
                    }
                }

                IntVec3 location = new IntVec3(x, 0, z);
                if (!location.InBounds(map)) return;

                ThingDef moteDef = DefDatabase<ThingDef>.GetNamedSilentFail("Mote_FeedbackGoto");
                
                // MoteMaker requires valid map and def
                if (moteDef != null)
                {
                    MoteMaker.MakeStaticMote(location.ToVector3Shifted(), map, moteDef, 3f);
                }
                
                // ThrowText also safe to call
                MoteMaker.ThrowText(location.ToVector3Shifted(), map, "* Viewer Ping *", Color.cyan, 3.5f);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error creating ping: {ex}");
            }
        }

        // ============================================ 
        // GENERIC INCIDENT HELPERS
        // ============================================ 

        private void TriggerIncident(string defName, IncidentCategoryDef category = null)
        {
            try
            {
                IncidentDef def = DefDatabase<IncidentDef>.GetNamedSilentFail(defName);
                if (def == null)
                {
                    Log.Warning($"[Player Storyteller] Incident definition not found: {defName}");
                    return;
                }

                IncidentParms parms = StorytellerUtility.DefaultParmsNow(category ?? IncidentCategoryDefOf.Misc, map);
                parms.forced = true;

                if (def.Worker.TryExecute(parms))
                {
                    Messages.Message($"Viewers triggered: {def.label}", MessageTypeDefOf.NeutralEvent);
                }
                else
                {
                    Messages.Message($"Failed to trigger {def.label} (conditions not met).", MessageTypeDefOf.RejectInput);
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering {defName}: {ex}");
            }
        }

        private void TriggerMechShip()
        {
            try
            {
                string defName = Rand.Value > 0.5f ? "DefoliatorShipPartCrash" : "PsychicEmanatorShipPartCrash";
                TriggerIncident(defName, IncidentCategoryDefOf.ThreatBig);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering mech ship: {ex}");
            }
        }
        private void SetFireAtLocation(string json)
        {
            try
            {
                if (string.IsNullOrEmpty(json)) return;
                var data = JsonConvert.DeserializeObject<LocationData>(json);
                if (data == null) return;

                IntVec3 targetCell = new IntVec3(data.x, 0, data.z);
                if (!targetCell.InBounds(map)) return;

                // Pawn-driven action
                if (!string.IsNullOrEmpty(data.pawnId))
                {
                    Pawn pawn = map.mapPawns.AllPawns.FirstOrDefault(p => p.thingIDNumber.ToString() == data.pawnId);
                    if (pawn != null && pawn.Spawned && !pawn.Downed && !pawn.Dead)
                    {
                        // Find something to burn at the location
                        Thing targetThing = null;
                        foreach (var t in targetCell.GetThingList(map))
                        {
                            if (t.FlammableNow)
                            {
                                targetThing = t;
                                break;
                            }
                        }
                        
                        // If nothing flammable (like stone floor), maybe there's a plant?
                        if (targetThing == null) targetThing = targetCell.GetPlant(map);

                        if (targetThing != null)
                        {
                            // Create the job
                            Job job = JobMaker.MakeJob(JobDefOf.Ignite, targetThing);
                            
                            // Force draft if needed to ensure compliance
                            if (!pawn.Drafted)
                            {
                                pawn.drafter.Drafted = true;
                            }

                            // 1. Assign Ignite Job
                            pawn.jobs.TryTakeOrderedJob(job, JobTag.DraftedOrder);

                            // 2. Queue "Run Away" Job
                            // This prevents the pawn from immediately extinguishing the fire they just set
                            // (which non-pyromaniacs will do if undrafted/idle in Home Area)
                            IntVec3 fleeSpot;
                            if (CellFinder.TryFindRandomCellNear(pawn.Position, map, 4, (c) => c.Standable(map) && c.DistanceTo(targetCell) > 2, out fleeSpot))
                            {
                                Job fleeJob = JobMaker.MakeJob(JobDefOf.Goto, fleeSpot);
                                pawn.jobs.jobQueue.EnqueueLast(fleeJob, JobTag.DraftedOrder);
                            }

                            Messages.Message($"{pawn.Name.ToStringShort} is setting a fire!", MessageTypeDefOf.NegativeEvent);
                            return;
                        }
                        else
                        {
                            Messages.Message($"{pawn.Name.ToStringShort} found nothing flammable there.", MessageTypeDefOf.RejectInput, false);
                            return;
                        }
                    }
                }

                // Fallback: God Mode (if no pawn ID or pawn unavailable)
                FireUtility.TryStartFireIn(targetCell, map, 0.5f, null);
                Messages.Message("Viewers started a fire!", MessageTypeDefOf.NegativeEvent);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error setting fire: {ex}");
            }
        }

        private void DestroyObject(string json)
        {
            try
            {
                if (string.IsNullOrEmpty(json)) return;
                var data = JsonConvert.DeserializeObject<TargetData>(json);
                if (data == null) return;

                Thing target = null;
                
                // Try by ID first
                if (!string.IsNullOrEmpty(data.thingId))
                {
                    int id = int.Parse(data.thingId);
                    target = map.listerThings.AllThings.FirstOrDefault(t => t.thingIDNumber == id);
                }
                
                // Fallback to location
                if (target == null && data.x != 0 && data.z != 0)
                {
                    IntVec3 cell = new IntVec3(data.x, 0, data.z);
                    if (cell.InBounds(map))
                    {
                        target = cell.GetFirstBuilding(map) as Thing ?? cell.GetFirstItem(map);
                    }
                }

                if (target != null && !target.Destroyed)
                {
                    // Pawn-driven action
                    if (!string.IsNullOrEmpty(data.pawnId))
                    {
                        Pawn pawn = map.mapPawns.AllPawns.FirstOrDefault(p => p.thingIDNumber.ToString() == data.pawnId);
                        if (pawn != null && pawn.Spawned && !pawn.Downed && !pawn.Dead)
                        {
                            // Ensure pawn can reach
                            if (!pawn.CanReach(target, PathEndMode.Touch, Danger.Deadly))
                            {
                                Messages.Message($"{pawn.Name.ToStringShort} cannot reach the target!", MessageTypeDefOf.RejectInput, false);
                                return;
                            }

                            // Create the job (AttackMelee)
                            Job job = JobMaker.MakeJob(JobDefOf.AttackMelee, target);
                            
                            // Force draft
                            if (!pawn.Drafted)
                            {
                                pawn.drafter.Drafted = true;
                            }

                            pawn.jobs.TryTakeOrderedJob(job, JobTag.DraftedOrder);
                            Messages.Message($"{pawn.Name.ToStringShort} is attacking the object!", MessageTypeDefOf.NegativeEvent);
                            return;
                        }
                    }

                    // Fallback: God Mode
                    target.Destroy(DestroyMode.Vanish);
                    MoteMaker.ThrowText(target.DrawPos, map, "Destroyed!", Color.red);
                    Messages.Message("Viewers destroyed an object!", MessageTypeDefOf.NegativeEvent);
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error destroying object: {ex}");
            }
        }

        private void StartSocialFight(string json)
        {
            try
            {
                if (string.IsNullOrEmpty(json)) return;
                var data = JsonConvert.DeserializeObject<SocialFightData>(json);
                if (data == null) return;

                Pawn initiator = map.mapPawns.FreeColonists.FirstOrDefault(p => p.thingIDNumber.ToString() == data.initiatorId);
                Pawn target = map.mapPawns.FreeColonists.FirstOrDefault(p => p.thingIDNumber.ToString() == data.targetId);

                if (initiator != null && target != null && initiator != target)
                {
                    if (initiator.interactions.CheckSocialFightStart(InteractionDefOf.Insult, target))
                    {
                        initiator.interactions.StartSocialFight(target);
                        Messages.Message($"Viewers incited a fight between {initiator.LabelShort} and {target.LabelShort}!", MessageTypeDefOf.NegativeEvent);
                    }
                    else
                    {
                        // Force it if natural check fails (mental break style)
                        initiator.mindState.mentalStateHandler.TryStartMentalState(MentalStateDefOf.SocialFighting, null, true, false, false, target);
                        Messages.Message($"Viewers forced a fight between {initiator.LabelShort} and {target.LabelShort}!", MessageTypeDefOf.NegativeEvent);
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error starting social fight: {ex}");
            }
        }
    }

    [Serializable]
    public class LocationData
    {
        public int x;
        public int z;
        public string pawnId; // Added for pawn-driven actions
    }

    [Serializable]
    public class TargetData
    {
        public string thingId;
        public int x;
        public int z;
        public string pawnId; // Added for pawn-driven actions
    }

    [Serializable]
    public class SocialFightData
    {
        public string initiatorId;
        public string targetId;
    }

    [Serializable]
    public class BuyPawnData
    {
        public string username;
        public string nickname;
    }

    [Serializable]
    public class ColonistCommandData
    {
        public string pawnId;
        public string type;
        public string target; // Optional
        public string newName; // Optional, for rename
        public Dictionary<string, int> priorities; // Optional
        public int hour; // Optional, for schedule
        public string assignment; // Optional, for schedule
        public int x; // Optional, for order
        public int z; // Optional, for order
    }

    [Serializable]
    public class AdoptColonistData
    {
        public string username;
        public string pawnId;
        public int cost;
    }
}
