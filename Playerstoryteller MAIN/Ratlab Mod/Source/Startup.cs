using System;
using Verse;
using RimWorld;
using UnityEngine;

namespace PlayerStoryteller
{
    [StaticConstructorOnStartup]
    public static class RatLabStartup
    {
        static RatLabStartup()
        {
            // Defer to next frame to ensure UI is ready
            LongEventHandler.QueueLongEvent(CheckFirstRun, "RatLab Initializing", false, null);
        }

        private static void CheckFirstRun()
        {
            if (PlayerStorytellerMod.settings == null) return;

            // Show setup wizard if user hasn't completed it
            if (!PlayerStorytellerMod.settings.hasCompletedSetupWizard)
            {
                Find.WindowStack.Add(new Dialog_SetupWizard());
            }
        }
    }
}