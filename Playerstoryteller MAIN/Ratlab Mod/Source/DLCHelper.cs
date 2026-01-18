using System;
using System.Linq;
using System.Collections.Generic;
using Verse;
using RimWorld;
using UnityEngine;
using RimWorld.QuestGen;

namespace PlayerStoryteller
{
    [StaticConstructorOnStartup]
    public static class DLCHelper
    {
        public static bool RoyaltyActive { get; private set; }
        public static bool IdeologyActive { get; private set; }
        public static bool BiotechActive { get; private set; }
        public static bool AnomalyActive { get; private set; }
        public static bool OdysseyActive { get; private set; }

        static DLCHelper()
        {
            RoyaltyActive = ModsConfig.RoyaltyActive;
            IdeologyActive = ModsConfig.IdeologyActive;
            BiotechActive = ModsConfig.BiotechActive;
            AnomalyActive = ModsConfig.AnomalyActive;
            OdysseyActive = ModLister.AllInstalledMods.Any(m => m.Active && (m.Name.Contains("Odyssey") || m.PackageId.ToLower().Contains("odyssey")));
            
            Log.Message($"[Player Storyteller] DLC Status - Royalty: {RoyaltyActive}, Ideology: {IdeologyActive}, Biotech: {BiotechActive}, Anomaly: {AnomalyActive}, Odyssey: {OdysseyActive}");
        }

        // ================= HELPERS =================
        private static void TriggerIncident(Map map, string defName, string successMsg = null)
        {
            IncidentDef def = DefDatabase<IncidentDef>.GetNamedSilentFail(defName);
            if (def != null)
            {
                IncidentParms parms = StorytellerUtility.DefaultParmsNow(def.category, map);
                parms.forced = true;
                if (def.Worker.TryExecute(parms))
                {
                    if (successMsg != null) Messages.Message(successMsg, MessageTypeDefOf.NeutralEvent);
                }
                else
                {
                    Messages.Message($"Failed to execute incident {defName} (Worker rejected).", MessageTypeDefOf.RejectInput);
                }
            }
            else
            {
                Messages.Message($"IncidentDef '{defName}' not found.", MessageTypeDefOf.RejectInput);
            }
        }

        private static void TriggerCondition(Map map, string defName, string successMsg, MessageTypeDef msgType)
        {
            GameConditionDef def = DefDatabase<GameConditionDef>.GetNamedSilentFail(defName);
            if (def != null)
            {
                map.gameConditionManager.RegisterCondition(GameConditionMaker.MakeCondition(def, 60000)); // 1 day
                Messages.Message(successMsg, msgType);
            }
            else
            {
                Messages.Message($"GameConditionDef '{defName}' not found.", MessageTypeDefOf.RejectInput);
            }
        }

        private static void TriggerQuest(Map map, string questDefName, string successMsg)
        {
            QuestScriptDef questDef = DefDatabase<QuestScriptDef>.GetNamedSilentFail(questDefName);
            if (questDef != null)
            {
                Slate slate = new Slate();
                slate.Set("points", StorytellerUtility.DefaultThreatPointsNow(map));
                slate.Set("map", map);
                
                Quest quest = QuestUtility.GenerateQuestAndMakeAvailable(questDef, slate);
                if (quest != null)
                {
                    QuestUtility.SendLetterQuestAvailable(quest);
                    Messages.Message(successMsg, MessageTypeDefOf.PositiveEvent);
                }
                else
                {
                    Messages.Message($"Failed to generate quest {questDefName}.", MessageTypeDefOf.RejectInput);
                }
            }
            else
            {
                Messages.Message($"QuestScriptDef '{questDefName}' not found.", MessageTypeDefOf.RejectInput);
            }
        }

        private static void SpawnThing(Map map, string thingDefName, string successMsg)
        {
            ThingDef def = DefDatabase<ThingDef>.GetNamedSilentFail(thingDefName);
            if (def != null)
            {
                IntVec3 loc = DropCellFinder.RandomDropSpot(map);
                GenSpawn.Spawn(def, loc, map);
                Find.LetterStack.ReceiveLetter(def.LabelCap, successMsg, LetterDefOf.PositiveEvent, new TargetInfo(loc, map));
            }
            else
            {
                Messages.Message($"ThingDef '{thingDefName}' not found.", MessageTypeDefOf.RejectInput);
            }
        }

        // Simulates Bossgroup arrival via Drop Pods
        private static void CallBossgroup(Map map, string bossName, string bossKindName, Dictionary<string, int> escorts)
        {
            PawnKindDef bossKind = DefDatabase<PawnKindDef>.GetNamedSilentFail(bossKindName);
            if (bossKind == null)
            {
                Messages.Message($"PawnKindDef '{bossKindName}' not found.", MessageTypeDefOf.RejectInput);
                return;
            }

            List<Thing> thingsToDrop = new List<Thing>();

            Pawn boss = PawnGenerator.GeneratePawn(bossKind, Faction.OfMechanoids);
            thingsToDrop.Add(boss);

            foreach (var kvp in escorts)
            {
                PawnKindDef escortKind = DefDatabase<PawnKindDef>.GetNamedSilentFail(kvp.Key);
                if (escortKind != null)
                {
                    for (int i = 0; i < kvp.Value; i++)
                    {
                        thingsToDrop.Add(PawnGenerator.GeneratePawn(escortKind, Faction.OfMechanoids));
                    }
                }
            }

            IntVec3 dropSpot = DropCellFinder.FindRaidDropCenterDistant(map);
            DropPodUtility.DropThingsNear(dropSpot, map, thingsToDrop);

            Find.LetterStack.ReceiveLetter($"{bossName} Arriving", 
                $"A {bossName} and its escorts are dropping into the area! Prepare for battle.", 
                LetterDefOf.ThreatBig, boss);
        }

        // ================= ROYALTY =================
        public static void TriggerLaborerTeam(Map map)
        {
            if (!RoyaltyActive) return;
            TriggerQuest(map, "LaborerTeam", "Laborer Team quest available."); 
        }

        public static void TriggerTributeCollector(Map map)
        {
            if (!RoyaltyActive) return;
            TriggerIncident(map, "CaravanArrivalTributeCollector");
        }

        public static void TriggerAnimaTree(Map map)
        {
            if (!RoyaltyActive) return;
            SpawnThing(map, "Plant_TreeAnima", "Anima Tree sprouted.");
        }

        public static void TriggerMechCluster(Map map)
        {
            if (!RoyaltyActive) return;
            TriggerIncident(map, "MechCluster");
        }

        // ================= IDEOLOGY =================
        public static void TriggerDateRitual(Map map)
        {
            if (!IdeologyActive) return;
            Messages.Message("Viewers requested a ritual celebration!", MessageTypeDefOf.NeutralEvent);
        }

        public static void SpawnGauranlenPod(Map map)
        {
            if (!IdeologyActive) return;
            TriggerIncident(map, "GauranlenPodSpawn");
        }

        public static void TriggerHackerCamp(Map map)
        {
            if (!IdeologyActive) return;
            TriggerQuest(map, "OpportunitySite_Hacking", "Hacker Camp quest available.");
        }

        public static void TriggerInsectJelly(Map map)
        {
            if (!IdeologyActive) return;
            TriggerIncident(map, "Infestation_Jelly");
        }

        public static void TriggerSkylanterns(Map map)
        {
            if (!IdeologyActive) return;
            TriggerIncident(map, "WanderersSkylantern");
        }

        // ================= BIOTECH =================
        public static void SummonDiabolus(Map map)
        {
            if (!BiotechActive) return;
            CallBossgroup(map, "Diabolus", "Mech_Diabolus", new Dictionary<string, int> { { "Mech_Militor", 3 } });
        }

        public static void SummonWarqueen(Map map)
        {
            if (!BiotechActive) return;
            CallBossgroup(map, "Warqueen", "Mech_Warqueen", new Dictionary<string, int> { { "Mech_Pikeman", 2 }, { "Mech_Scyther", 2 } });
        }

        public static void SummonApocriton(Map map)
        {
            if (!BiotechActive) return;
            CallBossgroup(map, "Apocriton", "Mech_Apocriton", new Dictionary<string, int> { { "Mech_Militor", 5 }, { "Mech_Scyther", 2 } });
        }

        public static void DropWastepack(Map map)
        {
            if (!BiotechActive) return;
            IntVec3 dropSpot = DropCellFinder.RandomDropSpot(map);
            Thing waste = ThingMaker.MakeThing(DefDatabase<ThingDef>.GetNamedSilentFail("Wastepack") ?? DefDatabase<ThingDef>.GetNamedSilentFail("ToxicWastepack"));
            
            if (waste != null)
            {
                waste.stackCount = 5;
                DropPodUtility.DropThingsNear(dropSpot, map, new System.Collections.Generic.List<Thing> { waste });
                Messages.Message("Toxic wastepacks dropped from orbit.", MessageTypeDefOf.NegativeEvent);
            }
        }

        public static void SummonSanguophage(Map map)
        {
            if (!BiotechActive) return;
            
            // Sanguophage Quest requires explicit Asker and Count in Slate
            QuestScriptDef questDef = DefDatabase<QuestScriptDef>.GetNamedSilentFail("SanguophageMeetingHost");
            if (questDef != null)
            {
                Slate slate = new Slate();
                slate.Set("points", StorytellerUtility.DefaultThreatPointsNow(map));
                slate.Set("map", map);
                slate.Set("sanguophageCount", 4);

                // Generate a Sanguophage leader as the 'asker'
                PawnKindDef sanguophageKind = DefDatabase<PawnKindDef>.GetNamedSilentFail("Sanguophage");
                if (sanguophageKind != null)
                {
                    Pawn asker = PawnGenerator.GeneratePawn(sanguophageKind, Faction.OfAncients);
                    if (asker != null)
                    {
                        slate.Set("asker", asker);
                    }
                }

                Quest quest = QuestUtility.GenerateQuestAndMakeAvailable(questDef, slate);
                if (quest != null)
                {
                    QuestUtility.SendLetterQuestAvailable(quest);
                    Messages.Message("Sanguophage Meeting quest generated.", MessageTypeDefOf.PositiveEvent);
                }
                else
                {
                    Messages.Message("Failed to generate Sanguophage quest.", MessageTypeDefOf.RejectInput);
                }
            }
        }

        public static void DropGenepack(Map map)
        {
            if (!BiotechActive) return;
            SpawnThing(map, "Genepack", "Genepack dropped.");
        }

        public static void TriggerPoluxTree(Map map)
        {
            if (!BiotechActive) return;
            SpawnThing(map, "Plant_TreePolux", "Polux Tree sprouted.");
        }

        public static void TriggerAcidicSmog(Map map)
        {
            if (!BiotechActive) return;
            TriggerCondition(map, "NoxiousHaze", "Acidic smog has settled.", MessageTypeDefOf.NegativeEvent);
        }

        public static void TriggerWastepackInfestation(Map map)
        {
            if (!BiotechActive) return;
            TriggerIncident(map, "WastepackInfestation");
        }

        // ================= ANOMALY =================
        public static void TriggerDeathPall(Map map)
        {
            if (!AnomalyActive) return;
            TriggerCondition(map, "DeathPall", "A Death Pall has descended.", MessageTypeDefOf.ThreatBig);
        }

        public static void TriggerBloodRain(Map map)
        {
            if (!AnomalyActive) return;
            TriggerCondition(map, "BloodRain", "Blood Rain has begun.", MessageTypeDefOf.NegativeEvent);
        }

        public static void TriggerUnnaturalDarkness(Map map)
        {
            if (!AnomalyActive) return;
            if (DefDatabase<IncidentDef>.GetNamedSilentFail("UnnaturalDarkness") != null)
                TriggerIncident(map, "UnnaturalDarkness", "Unnatural Darkness encroaches.");
            else
                TriggerCondition(map, "UnnaturalDarkness", "Unnatural Darkness encroaches.", MessageTypeDefOf.ThreatBig);
        }

        public static void SummonShamblers(Map map)
        {
            if (!AnomalyActive) return;
            TriggerIncident(map, "ShamblerSwarm");
        }

        public static void SummonFleshbeasts(Map map)
        {
            if (!AnomalyActive) return;
            TriggerIncident(map, "FleshbeastAttack");
        }

        public static void TriggerPitGate(Map map)
        {
            if (!AnomalyActive) return;
            TriggerIncident(map, "PitGate");
        }

        public static void TriggerChimera(Map map)
        {
            if (!AnomalyActive) return;
            TriggerIncident(map, "ChimeraAssault");
        }

        public static void TriggerNociosphere(Map map)
        {
            if (!AnomalyActive) return;
            if (DefDatabase<IncidentDef>.GetNamedSilentFail("Nociosphere") != null)
                TriggerIncident(map, "Nociosphere");
            else
                SpawnThing(map, "Nociosphere", "Nociosphere arrived.");
        }

        public static void TriggerGoldenCube(Map map)
        {
            if (!AnomalyActive) return;
            if (DefDatabase<IncidentDef>.GetNamedSilentFail("GoldenCubeArrival") != null)
                TriggerIncident(map, "GoldenCubeArrival");
            else
                Messages.Message("Golden Cube arrival simulated (Def not found)", MessageTypeDefOf.NeutralEvent);
        }

        public static void TriggerMetalhorror(Map map)
        {
            if (!AnomalyActive) return;
            TriggerIncident(map, "MetalhorrorImplantation");
            Messages.Message("A Metalhorror has been implanted (Hidden Event triggered).", MessageTypeDefOf.NeutralEvent);
        }

        // ================= ODYSSEY =================
        public static void TriggerGravshipCrash(Map map)
        {
            if (!OdysseyActive) return;
            // "GravEngine" is the correct QuestScriptDef name for the gravship crash
            TriggerQuest(map, "GravEngine", "Gravship Crash quest available.");
        }
        
        public static void SpawnExplosiveDrones(Map map)
        {
            if (!OdysseyActive) return;
            // Manually spawn Hunter Drones via drop pods
            string kindName = "Drone_Hunter";
            PawnKindDef kind = DefDatabase<PawnKindDef>.GetNamedSilentFail(kindName);
            
            if (kind != null)
            {
                IntVec3 dropSpot = DropCellFinder.FindRaidDropCenterDistant(map);
                List<Thing> drones = new List<Thing>();
                for (int i = 0; i < 3; i++)
                {
                    drones.Add(PawnGenerator.GeneratePawn(kind, Faction.OfAncientsHostile ?? Faction.OfMechanoids));
                }
                
                DropPodUtility.DropThingsNear(dropSpot, map, drones);
                Find.LetterStack.ReceiveLetter("Hunter Drones", "Hostile Hunter Drones have arrived from orbit!", LetterDefOf.ThreatBig, drones[0]);
            }
            else
            {
                Messages.Message("PawnKind 'Drone_Hunter' not found.", MessageTypeDefOf.RejectInput);
            }
        }
        
        public static void TriggerOrbitalTrader(Map map)
        {
            if (!OdysseyActive) return;
            Messages.Message("Odyssey Orbital Trader arrival (Simulation).", MessageTypeDefOf.PositiveEvent);
        }

        public static void TriggerOrbitalDebris(Map map)
        {
            if (!OdysseyActive) return;
            TriggerIncident(map, "OrbitalDebris");
        }

        public static void TriggerMechanoidSignal(Map map)
        {
            if (!OdysseyActive) return;
            TriggerIncident(map, "GiveQuest_MechanoidSignal");
        }

        public static string GetActiveDLCsJson()
        {
            return "{" +
                $"\"royalty\":{RoyaltyActive.ToString().ToLower()}," +
                $"\"ideology\":{IdeologyActive.ToString().ToLower()}," +
                $"\"biotech\":{BiotechActive.ToString().ToLower()}," +
                $"\"anomaly\":{AnomalyActive.ToString().ToLower()}," +
                $"\"odyssey\":{OdysseyActive.ToString().ToLower()}" +
                "}";
        }
    }
}