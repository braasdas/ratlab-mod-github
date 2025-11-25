using System;
using System.Collections.Generic;
using System.Linq;
using Verse;
using RimWorld;
using UnityEngine;

namespace PlayerStoryteller
{
    public class PlayerStorytellerMapComponent : MapComponent
    {
        private int tickCounter = 0;
        private int ticksPerUpdate;

        public PlayerStorytellerMapComponent(Map map) : base(map)
        {
            UpdateTicksPerUpdate();
        }

        private void UpdateTicksPerUpdate()
        {
            ticksPerUpdate = PlayerStorytellerMod.settings.updateInterval * 60; // 60 ticks per second in RimWorld
        }

        public override void MapComponentTick()
        {
            base.MapComponentTick();

            tickCounter++;

            if (tickCounter >= ticksPerUpdate)
            {
                tickCounter = 0;
                UpdateTicksPerUpdate(); // Update in case settings changed

                // Capture and send screenshot
                SendUpdate();
            }
        }

        private async void SendUpdate()
        {
            try
            {
                // Capture screenshot
                byte[] screenshot = ScreenshotManager.CaptureMapScreenshot();
                if (screenshot != null)
                {
                    await PlayerStorytellerMod.SendScreenshotToServer(screenshot);
                }

                // Send game state
                string gameState = GetGameStateJson();
                await PlayerStorytellerMod.SendGameStateToServer(gameState);
            }
            catch (Exception ex)
            {
                Log.Error($"Error in SendUpdate: {ex.Message}");
            }
        }

        private string GetGameStateJson()
        {
            try
            {
                var colonists = map.mapPawns.FreeColonists.Select(p => new
                {
                    name = p.Name?.ToStringShort,
                    health = p.health.summaryHealth.SummaryHealthPercent,
                    mood = p.needs?.mood?.CurLevel ?? 0f,
                    position = new { x = p.Position.x, z = p.Position.z }
                }).ToList();

                var gameState = new
                {
                    mapName = map.info?.parent?.Label ?? "Unknown",
                    colonistCount = map.mapPawns.FreeColonistsCount,
                    colonists = colonists,
                    wealth = map.wealthWatcher.WealthTotal,
                    time = Find.TickManager.TicksGame
                };

                return Newtonsoft.Json.JsonConvert.SerializeObject(gameState);
            }
            catch (Exception ex)
            {
                Log.Error($"Error serializing game state: {ex.Message}");
                return "{}";
            }
        }
    }
}
