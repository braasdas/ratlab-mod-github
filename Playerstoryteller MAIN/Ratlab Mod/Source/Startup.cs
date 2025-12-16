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

            if (!PlayerStorytellerMod.settings.hasAcceptedPrivacyNotice)
            {
                // Trigger the privacy dialog
                Find.WindowStack.Add(new Dialog_Onboarding());
            }
        }
    }

    public class Dialog_Onboarding : Window
    {
        public override Vector2 InitialSize => new Vector2(500f, 400f);

        public Dialog_Onboarding()
        {
            this.forcePause = true;
            this.doCloseX = false;
            this.doCloseButton = false;
            this.closeOnClickedOutside = false;
            this.absorbInputAroundWindow = true;
        }

        public override void DoWindowContents(Rect inRect)
        {
            Text.Font = GameFont.Medium;
            Widgets.Label(new Rect(0, 0, inRect.width, 40), "Welcome to RatLab");
            Text.Font = GameFont.Small;

            string text =
                "This mod allows viewers to interact with your RimWorld colony via a web dashboard.\n\n" +
                "DATA PRIVACY:\n" +
                "To function, this mod streams game data (colonist stats, map layout) and screenshots to the RatLab server.\n\n" +
                "You must accept the privacy policy to enable these features.";

            Widgets.Label(new Rect(0, 50, inRect.width, 160), text);

            float y = 220f;

            if (Widgets.ButtonText(new Rect(0, y, inRect.width, 40), "ACCEPT & CONFIGURE"))
            {
                PlayerStorytellerMod.settings.hasAcceptedPrivacyNotice = true;
                PlayerStorytellerMod.settings.Write();
                
                // Open Settings immediately
                Close();
                Find.WindowStack.Add(new Dialog_ModSettings(PlayerStorytellerMod.Instance));
            }

            y += 50f;

            if (Widgets.ButtonText(new Rect(0, y, inRect.width, 40), "DECLINE (Disable Mod)"))
            {
                // Just close, mod remains inactive (settings defaults to false)
                Close();
                Messages.Message("RatLab disabled. Go to Mod Settings to enable later.", MessageTypeDefOf.CautionInput);
            }
        }
    }
}