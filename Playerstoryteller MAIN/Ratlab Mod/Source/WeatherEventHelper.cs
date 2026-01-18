using System;
using System.Collections.Generic;
using System.Linq;
using Verse;
using Verse.AI;
using RimWorld;
using UnityEngine;

namespace PlayerStoryteller
{
    public static class WeatherEventHelper
    {
        // Duration for game conditions (1 day = 60000 ticks)
        private const int DefaultDuration = 45000; // ~18 hours

        public static void TriggerHeatWave(Map map)
        {
            GameCondition cond = GameConditionMaker.MakeCondition(GameConditionDefOf.HeatWave, DefaultDuration);
            map.gameConditionManager.RegisterCondition(cond);
            Messages.Message("Viewers triggered a Heat Wave!", MessageTypeDefOf.NegativeEvent);
        }

        public static void TriggerColdSnap(Map map)
        {
            GameCondition cond = GameConditionMaker.MakeCondition(GameConditionDefOf.ColdSnap, DefaultDuration);
            map.gameConditionManager.RegisterCondition(cond);
            Messages.Message("Viewers triggered a Cold Snap!", MessageTypeDefOf.NegativeEvent);
        }

        public static void TriggerDryThunderstorm(Map map)
        {
            WeatherDef def = WeatherDef.Named("DryThunderstorm");
            if (def != null)
            {
                map.weatherManager.TransitionTo(def);
                Messages.Message("Weather changed to Dry Thunderstorm.", MessageTypeDefOf.NeutralEvent);
            }
        }

        public static void TriggerFoggyRain(Map map)
        {
            WeatherDef def = WeatherDef.Named("FoggyRain");
            if (def != null)
            {
                map.weatherManager.TransitionTo(def);
                Messages.Message("Weather changed to Foggy Rain.", MessageTypeDefOf.NeutralEvent);
            }
        }

        public static void TriggerSnowGentle(Map map)
        {
            WeatherDef def = WeatherDef.Named("SnowGentle");
            if (def != null)
            {
                map.weatherManager.TransitionTo(def);
                Messages.Message("Weather changed to Gentle Snow.", MessageTypeDefOf.NeutralEvent);
            }
        }

        public static void TriggerSnowHard(Map map)
        {
            WeatherDef def = WeatherDef.Named("SnowHard");
            if (def != null)
            {
                map.weatherManager.TransitionTo(def);
                Messages.Message("Weather changed to Hard Snow.", MessageTypeDefOf.NeutralEvent);
            }
        }

        // --- VOMIT RAIN SIMULATION ---
        // Since we can't easily add a new GameConditionDef without XML, 
        // we'll use a hidden GameCondition that acts as a runner, 
        // or just a MapComponent runner if we want to be simpler.
        // For now, let's try to simulate it by forcing the weather to Rain 
        // and adding a temporary "VomitTicker" component.
        
        public static void TriggerVomitRain(Map map)
        {
            map.weatherManager.TransitionTo(WeatherDef.Named("Rain"));

            var vomitComp = map.GetComponent<VomitRainMapComponent>();
            if (vomitComp == null)
            {
                vomitComp = new VomitRainMapComponent(map);
                map.components.Add(vomitComp);
            }
            
            vomitComp.StartEvent(DefaultDuration);
            Messages.Message("🤢 THE HEAVENS ARE SICK! VOMIT RAIN HAS BEGUN! 🤢", MessageTypeDefOf.NegativeEvent);
        }
    }

    // Helper Component for Vomit Rain logic
    public class VomitRainMapComponent : MapComponent
    {
        private int ticksRemaining = 0;
        private const int VomitCheckInterval = 250; // Check every ~4 seconds

        public VomitRainMapComponent(Map map) : base(map) { }

        public void StartEvent(int duration)
        {
            ticksRemaining = duration;
        }

        public override void MapComponentTick()
        {
            base.MapComponentTick();

            if (ticksRemaining > 0)
            {
                ticksRemaining--;

                if (ticksRemaining % VomitCheckInterval == 0)
                {
                    DoVomitTick();
                }

                if (ticksRemaining == 0)
                {
                    Messages.Message("The vomit rain has subsided.", MessageTypeDefOf.PositiveEvent);
                }
            }
        }

        private void DoVomitTick()
        {
            // Only affect pawns who are OUTSIDE (unroofed)
            var victims = map.mapPawns.AllPawnsSpawned
                .Where(p => !p.Position.Roofed(map) && p.RaceProps.IsFlesh)
                .ToList();

            foreach (var pawn in victims)
            {
                // 10% chance per check to vomit
                if (Rand.Value < 0.1f)
                {
                    pawn.jobs.StartJob(JobMaker.MakeJob(JobDefOf.Vomit), JobCondition.InterruptForced, null, true);
                }
            }
        }

        public override void ExposeData()
        {
            base.ExposeData();
            Scribe_Values.Look(ref ticksRemaining, "vomitRainTicks", 0);
        }
    }
}
