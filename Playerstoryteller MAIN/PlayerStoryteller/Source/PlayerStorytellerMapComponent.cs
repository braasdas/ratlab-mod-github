using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Verse;
using RimWorld;
using UnityEngine;

namespace PlayerStoryteller
{
    [Serializable]
    public class ColonistData
    {
        public string name;
        public float health;
        public float mood;
        public int x;
        public int z;
    }

    [Serializable]
    public class GameStateData
    {
        public string mapName;
        public int colonistCount;
        public List<ColonistData> colonists;
        public float wealth;
        public int time;
    }

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
                var colonistsList = new List<ColonistData>();
                foreach (var pawn in map.mapPawns.FreeColonists)
                {
                    colonistsList.Add(new ColonistData
                    {
                        name = pawn.Name?.ToStringShort ?? "Unknown",
                        health = pawn.health.summaryHealth.SummaryHealthPercent,
                        mood = pawn.needs?.mood?.CurLevel ?? 0f,
                        x = pawn.Position.x,
                        z = pawn.Position.z
                    });
                }

                var gameState = new GameStateData
                {
                    mapName = map.info?.parent?.Label ?? "Unknown",
                    colonistCount = map.mapPawns.FreeColonistsCount,
                    colonists = colonistsList,
                    wealth = map.wealthWatcher.WealthTotal,
                    time = Find.TickManager.TicksGame
                };

                return JsonUtility.ToJson(gameState);
            }
            catch (Exception ex)
            {
                Log.Error($"Error serializing game state: {ex.Message}");
                return "{}";
            }
        }
    }
}
