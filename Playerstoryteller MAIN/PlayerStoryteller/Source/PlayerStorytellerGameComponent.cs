using System;
using System.Linq;
using Verse;
using RimWorld;

namespace PlayerStoryteller
{
    public class PlayerStorytellerGameComponent : GameComponent
    {
        public PlayerStorytellerGameComponent(Game game) : base()
        {
            Log.Message("[Player Storyteller] GameComponent created");
        }

        public override void StartedNewGame()
        {
            base.StartedNewGame();
            Log.Message("[Player Storyteller] New game started - injecting MapComponents");
            InjectMapComponents();
        }

        public override void LoadedGame()
        {
            base.LoadedGame();
            Log.Message("[Player Storyteller] Game loaded - injecting MapComponents");
            InjectMapComponents();
        }

        public override void GameComponentTick()
        {
            base.GameComponentTick();

            // Check periodically for new maps
            if (Find.TickManager.TicksGame % 250 == 0) // Check every ~4 seconds
            {
                InjectMapComponents();
            }
        }

        private void InjectMapComponents()
        {
            try
            {
                if (Current.Game == null || Current.Game.Maps == null)
                {
                    return;
                }

                foreach (Map map in Current.Game.Maps)
                {
                    if (map != null && map.GetComponent<PlayerStorytellerMapComponent>() == null)
                    {
                        PlayerStorytellerMapComponent component = new PlayerStorytellerMapComponent(map);
                        map.components.Add(component);
                        Log.Message($"[Player Storyteller] Injected MapComponent into {map.info?.parent?.Label ?? "Unknown"}");
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error injecting MapComponents: {ex.Message}");
            }
        }
    }
}
