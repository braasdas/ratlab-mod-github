using System;
using Verse;

namespace PlayerStoryteller
{
    public class PlayerStorytellerGameComponent : GameComponent
    {
        public PlayerStorytellerGameComponent(Game game)
        {
        }

        public override void GameComponentTick()
        {
            base.GameComponentTick();

            // Check all maps and inject component if needed
            if (Find.TickManager.TicksGame % 250 == 0) // Check every ~4 seconds
            {
                foreach (Map map in Find.Maps)
                {
                    if (map.GetComponent<PlayerStorytellerMapComponent>() == null)
                    {
                        PlayerStorytellerMapComponent component = new PlayerStorytellerMapComponent(map);
                        map.components.Add(component);
                        Log.Message($"[Player Storyteller] Injected MapComponent into {map.info?.parent?.Label ?? "Unknown"}");
                    }
                }
            }
        }
    }
}
