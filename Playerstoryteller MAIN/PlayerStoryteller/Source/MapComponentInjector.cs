using System;
using System.Linq;
using Verse;

namespace PlayerStoryteller
{
    [StaticConstructorOnStartup]
    public static class MapComponentInjector
    {
        static MapComponentInjector()
        {
            Log.Message("[Player Storyteller] Injecting MapComponent into all maps");

            // Inject into all existing maps
            foreach (Map map in Find.Maps)
            {
                InjectIntoMap(map);
            }
        }

        public static void InjectIntoMap(Map map)
        {
            if (map == null) return;

            // Check if already has our component
            if (map.GetComponent<PlayerStorytellerMapComponent>() != null)
            {
                return;
            }

            // Add our component
            PlayerStorytellerMapComponent component = new PlayerStorytellerMapComponent(map);
            map.components.Add(component);

            Log.Message($"[Player Storyteller] Added MapComponent to map: {map.info?.parent?.Label ?? "Unknown"}");
        }
    }
}
