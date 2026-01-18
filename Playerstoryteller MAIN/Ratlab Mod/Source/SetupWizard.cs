using System;
using UnityEngine;
using Verse;
using RimWorld;

namespace PlayerStoryteller
{
    public class Dialog_SetupWizard : Window
    {
        private int currentPage = 0;
        private const int TotalPages = 4;

        // Wizard selections
        private string selectedQuality = "medium";
        private string selectedPreset = "balanced";

        // UI Colors
        private static readonly Color AccentColor = new Color(0.4f, 0.8f, 0.4f); // Green accent
        private static readonly Color SelectedColor = new Color(0.2f, 0.4f, 0.2f, 0.5f);
        private static readonly Color HoverColor = new Color(0.3f, 0.3f, 0.3f, 0.3f);
        private static readonly Color CardBackground = new Color(0.15f, 0.15f, 0.15f, 0.8f);

        public override Vector2 InitialSize => new Vector2(620f, 520f);

        public Dialog_SetupWizard()
        {
            forcePause = true;
            doCloseX = false;
            doCloseButton = false;
            closeOnClickedOutside = false;
            absorbInputAroundWindow = true;

            // Initialize with current settings if they exist
            if (PlayerStorytellerMod.settings != null)
            {
                selectedQuality = PlayerStorytellerMod.settings.streamingQuality ?? "medium";
            }
        }

        public override void DoWindowContents(Rect inRect)
        {
            // Header with progress indicator
            DrawHeader(inRect);

            // Main content area
            Rect contentRect = new Rect(0f, 70f, inRect.width, inRect.height - 140f);

            switch (currentPage)
            {
                case 0:
                    DrawWelcomePage(contentRect);
                    break;
                case 1:
                    DrawQualityPage(contentRect);
                    break;
                case 2:
                    DrawFeaturesPage(contentRect);
                    break;
                case 3:
                    DrawFinishPage(contentRect);
                    break;
            }

            // Navigation buttons
            DrawNavigation(inRect);
        }

        private void DrawHeader(Rect inRect)
        {
            // Title
            Text.Font = GameFont.Medium;
            string[] pageTitles = { "Welcome to RatLab", "Stream Quality", "Viewer Interactions", "You're All Set!" };
            Widgets.Label(new Rect(0f, 0f, inRect.width, 35f), pageTitles[currentPage]);
            Text.Font = GameFont.Small;

            // Progress dots
            float dotSize = 12f;
            float dotSpacing = 24f;
            float dotsWidth = (TotalPages * dotSpacing) - (dotSpacing - dotSize);
            float dotsX = (inRect.width - dotsWidth) / 2f;

            for (int i = 0; i < TotalPages; i++)
            {
                Rect dotRect = new Rect(dotsX + (i * dotSpacing), 45f, dotSize, dotSize);

                if (i == currentPage)
                {
                    Widgets.DrawBoxSolid(dotRect, AccentColor);
                }
                else if (i < currentPage)
                {
                    Widgets.DrawBoxSolid(dotRect, new Color(0.5f, 0.5f, 0.5f));
                }
                else
                {
                    Widgets.DrawBoxSolid(dotRect, new Color(0.25f, 0.25f, 0.25f));
                }
            }
        }

        private void DrawWelcomePage(Rect rect)
        {
            float y = rect.y + 10f;

            // Logo/Icon area (placeholder text for now)
            Text.Font = GameFont.Medium;
            GUI.color = AccentColor;
            Widgets.Label(new Rect(rect.x, y, rect.width, 30f), "[ RAT LAB ]");
            GUI.color = Color.white;
            Text.Font = GameFont.Small;
            y += 40f;

            // Description
            string desc = "RatLab turns your RimWorld colony into a live interactive experience. " +
                         "Viewers can watch your game through a web dashboard and vote on events that affect your colony.";

            Widgets.Label(new Rect(rect.x, y, rect.width, 60f), desc);
            y += 70f;

            // Privacy section
            Widgets.DrawBoxSolid(new Rect(rect.x, y, rect.width, 140f), CardBackground);

            Text.Font = GameFont.Medium;
            Widgets.Label(new Rect(rect.x + 15f, y + 10f, rect.width - 30f, 25f), "Data & Privacy");
            Text.Font = GameFont.Small;

            string privacyText = "To function, RatLab transmits the following to our servers:\n\n" +
                                "  - Live video stream of your game window\n" +
                                "  - Colonist information (names, health, skills)\n" +
                                "  - Colony statistics (wealth, resources)\n" +
                                "  - Viewer actions and chat messages\n\n" +
                                "All data is encrypted in transit. No long-term storage.";

            Widgets.Label(new Rect(rect.x + 15f, y + 35f, rect.width - 30f, 100f), privacyText);
            y += 155f;

            // Features highlight
            Text.Font = GameFont.Tiny;
            GUI.color = new Color(0.7f, 0.7f, 0.7f);
            Widgets.Label(new Rect(rect.x, y, rect.width, 40f),
                "Features: Live streaming, viewer voting, colonist adoption, 36+ interactive events");
            GUI.color = Color.white;
            Text.Font = GameFont.Small;
        }

        private void DrawQualityPage(Rect rect)
        {
            float y = rect.y + 10f;

            Widgets.Label(new Rect(rect.x, y, rect.width, 40f),
                "Choose your stream quality based on your internet upload speed.\n" +
                "Higher quality looks better but requires more bandwidth.");
            y += 55f;

            // Quality options as cards
            DrawQualityCard(new Rect(rect.x, y, rect.width, 80f), "low", "Low Quality",
                "1000 kbps", "Best for slow connections (< 2 Mbps upload)", "Stable on most connections");
            y += 90f;

            DrawQualityCard(new Rect(rect.x, y, rect.width, 80f), "medium", "Medium Quality",
                "2500 kbps", "Recommended for most users (2-5 Mbps upload)", "Good balance of quality and stability");
            y += 90f;

            DrawQualityCard(new Rect(rect.x, y, rect.width, 80f), "high", "High Quality",
                "4500 kbps", "For fast connections (5+ Mbps upload)", "Crisp visuals, may buffer on slow networks");
            y += 95f;

            // Tip
            Text.Font = GameFont.Tiny;
            GUI.color = new Color(0.6f, 0.6f, 0.6f);
            Widgets.Label(new Rect(rect.x, y, rect.width, 30f),
                "Tip: Start with Medium. You can change this anytime in Mod Settings.");
            GUI.color = Color.white;
            Text.Font = GameFont.Small;
        }

        private void DrawQualityCard(Rect rect, string qualityKey, string title, string bitrate, string description, string note)
        {
            bool isSelected = selectedQuality == qualityKey;
            bool isHovered = Mouse.IsOver(rect);

            // Background
            if (isSelected)
            {
                Widgets.DrawBoxSolid(rect, SelectedColor);
                Widgets.DrawBox(rect, 2);
            }
            else if (isHovered)
            {
                Widgets.DrawBoxSolid(rect, HoverColor);
            }
            else
            {
                Widgets.DrawBoxSolid(rect, CardBackground);
            }

            // Content
            float padding = 15f;

            // Title and bitrate
            Text.Font = GameFont.Medium;
            if (isSelected) GUI.color = AccentColor;
            Widgets.Label(new Rect(rect.x + padding, rect.y + 8f, 200f, 25f), title);
            GUI.color = Color.white;

            Text.Font = GameFont.Small;
            GUI.color = new Color(0.7f, 0.7f, 0.7f);
            Widgets.Label(new Rect(rect.x + rect.width - 100f, rect.y + 12f, 85f, 20f), bitrate);
            GUI.color = Color.white;

            // Description
            Widgets.Label(new Rect(rect.x + padding, rect.y + 35f, rect.width - 30f, 20f), description);

            // Note
            Text.Font = GameFont.Tiny;
            GUI.color = new Color(0.5f, 0.5f, 0.5f);
            Widgets.Label(new Rect(rect.x + padding, rect.y + 55f, rect.width - 30f, 20f), note);
            GUI.color = Color.white;
            Text.Font = GameFont.Small;

            // Selection indicator
            if (isSelected)
            {
                GUI.color = AccentColor;
                Widgets.Label(new Rect(rect.x + rect.width - 30f, rect.y + 30f, 20f, 20f), ">");
                GUI.color = Color.white;
            }

            // Click handler
            if (Widgets.ButtonInvisible(rect))
            {
                selectedQuality = qualityKey;
            }
        }

        private void DrawFeaturesPage(Rect rect)
        {
            float y = rect.y + 5f;

            Widgets.Label(new Rect(rect.x, y, rect.width, 35f),
                "Choose a preset to quickly configure which actions viewers can trigger.");
            y += 40f;

            // Preset options - compact cards
            DrawPresetCard(new Rect(rect.x, y, rect.width, 62f), "helpful", "Helpful Only",
                "Healing, inspiration, resource drops, good weather",
                "Viewers can only help - no disasters");
            y += 68f;

            DrawPresetCard(new Rect(rect.x, y, rect.width, 62f), "balanced", "Balanced (Recommended)",
                "Helpful actions + minor threats like weather and wildlife",
                "Fun interactions without colony-ending events");
            y += 68f;

            DrawPresetCard(new Rect(rect.x, y, rect.width, 62f), "chaos", "Chaos Mode",
                "EVERYTHING - raids, infestations, meteors, toxic fallout",
                "Maximum chaos. Your colonists will suffer.");
            y += 68f;

            DrawPresetCard(new Rect(rect.x, y, rect.width, 62f), "custom", "Custom",
                "Start with all actions disabled",
                "Configure each action manually in Mod Settings");
        }

        private void DrawPresetCard(Rect rect, string presetKey, string title, string features, string description)
        {
            bool isSelected = selectedPreset == presetKey;
            bool isHovered = Mouse.IsOver(rect);

            // Background
            if (isSelected)
            {
                Widgets.DrawBoxSolid(rect, SelectedColor);
                Widgets.DrawBox(rect, 2);
            }
            else if (isHovered)
            {
                Widgets.DrawBoxSolid(rect, HoverColor);
            }
            else
            {
                Widgets.DrawBoxSolid(rect, CardBackground);
            }

            float padding = 12f;

            // Title
            Text.Font = GameFont.Small;
            if (isSelected) GUI.color = AccentColor;
            Widgets.Label(new Rect(rect.x + padding, rect.y + 6f, rect.width - 40f, 22f), title);
            GUI.color = Color.white;

            // Features
            Text.Font = GameFont.Tiny;
            GUI.color = new Color(0.85f, 0.85f, 0.85f);
            Widgets.Label(new Rect(rect.x + padding, rect.y + 26f, rect.width - 30f, 18f), features);
            GUI.color = Color.white;

            // Description
            GUI.color = new Color(0.5f, 0.5f, 0.5f);
            Widgets.Label(new Rect(rect.x + padding, rect.y + 43f, rect.width - 30f, 18f), description);
            GUI.color = Color.white;
            Text.Font = GameFont.Small;

            // Selection indicator
            if (isSelected)
            {
                GUI.color = AccentColor;
                Widgets.Label(new Rect(rect.x + rect.width - 25f, rect.y + 22f, 20f, 20f), ">");
                GUI.color = Color.white;
            }

            if (Widgets.ButtonInvisible(rect))
            {
                selectedPreset = presetKey;
            }
        }

        private void DrawFinishPage(Rect rect)
        {
            float y = rect.y + 20f;

            // Success message
            GUI.color = AccentColor;
            Text.Font = GameFont.Medium;
            Widgets.Label(new Rect(rect.x, y, rect.width, 30f), "Setup Complete!");
            GUI.color = Color.white;
            Text.Font = GameFont.Small;
            y += 40f;

            // Summary
            Widgets.Label(new Rect(rect.x, y, rect.width, 25f), "Your configuration:");
            y += 30f;

            Widgets.DrawBoxSolid(new Rect(rect.x, y, rect.width, 70f), CardBackground);

            string qualityLabel = selectedQuality == "low" ? "Low (1000 kbps)" :
                                  selectedQuality == "high" ? "High (4500 kbps)" : "Medium (2500 kbps)";
            string presetLabel = selectedPreset == "helpful" ? "Helpful Only" :
                                 selectedPreset == "chaos" ? "Chaos Mode" :
                                 selectedPreset == "custom" ? "Custom" : "Balanced";

            Widgets.Label(new Rect(rect.x + 15f, y + 12f, rect.width - 30f, 20f), $"Stream Quality: {qualityLabel}");
            Widgets.Label(new Rect(rect.x + 15f, y + 35f, rect.width - 30f, 20f), $"Interaction Preset: {presetLabel}");
            y += 85f;

            // Dashboard link section
            Widgets.Label(new Rect(rect.x, y, rect.width, 25f), "Share this link with your viewers:");
            y += 30f;

            string serverUrl = PlayerStorytellerMod.GetServerUrl();
            string sessionId = PlayerStorytellerMod.GetSessionId();
            string dashboardUrl = $"{serverUrl}/dashboard.html?session={Uri.EscapeDataString(sessionId)}";

            // URL display box
            Widgets.DrawBoxSolid(new Rect(rect.x, y, rect.width, 35f), new Color(0.1f, 0.1f, 0.1f));

            Text.Font = GameFont.Tiny;
            // Truncate URL if too long for display
            string displayUrl = dashboardUrl.Length > 70 ? dashboardUrl.Substring(0, 67) + "..." : dashboardUrl;
            Widgets.Label(new Rect(rect.x + 10f, y + 8f, rect.width - 20f, 25f), displayUrl);
            Text.Font = GameFont.Small;
            y += 45f;

            // Copy button
            if (Widgets.ButtonText(new Rect(rect.x, y, 200f, 35f), "Copy Dashboard Link"))
            {
                GUIUtility.systemCopyBuffer = dashboardUrl;
                Messages.Message("Dashboard link copied to clipboard!", MessageTypeDefOf.PositiveEvent);
            }

            // Copy stream key button
            if (Widgets.ButtonText(new Rect(rect.x + 210f, y, 200f, 35f), "Copy Admin Key"))
            {
                GUIUtility.systemCopyBuffer = PlayerStorytellerMod.settings.secretKey;
                Messages.Message("Admin key copied to clipboard!", MessageTypeDefOf.PositiveEvent);
            }
            y += 50f;

            // Final tips
            Text.Font = GameFont.Tiny;
            GUI.color = new Color(0.6f, 0.6f, 0.6f);
            Widgets.Label(new Rect(rect.x, y, rect.width, 50f),
                "The Admin Key is required to log into the dashboard. Keep it secret!\n" +
                "You can access these settings anytime via Options > Mod Settings > Rat Lab");
            GUI.color = Color.white;
            Text.Font = GameFont.Small;
        }

        private void DrawNavigation(Rect inRect)
        {
            float buttonWidth = 120f;
            float buttonHeight = 35f;
            float y = inRect.height - buttonHeight - 10f;

            // Back button (not on first page)
            if (currentPage > 0)
            {
                if (Widgets.ButtonText(new Rect(0f, y, buttonWidth, buttonHeight), "< Back"))
                {
                    currentPage--;
                }
            }

            // Decline button (only on first page)
            if (currentPage == 0)
            {
                if (Widgets.ButtonText(new Rect(0f, y, buttonWidth, buttonHeight), "Decline"))
                {
                    Close();
                    Messages.Message("RatLab disabled. Enable in Mod Settings when ready.", MessageTypeDefOf.CautionInput);
                }
            }

            // Next/Finish button
            string nextText = currentPage == TotalPages - 1 ? "Start Playing!" : "Next >";
            if (Widgets.ButtonText(new Rect(inRect.width - buttonWidth, y, buttonWidth, buttonHeight), nextText))
            {
                if (currentPage == TotalPages - 1)
                {
                    // Final page - apply settings and close
                    ApplySettings();
                    Close();
                }
                else
                {
                    currentPage++;
                }
            }

            // Skip setup link (on pages 1-2)
            if (currentPage > 0 && currentPage < TotalPages - 1)
            {
                Text.Font = GameFont.Tiny;
                GUI.color = new Color(0.5f, 0.5f, 0.5f);
                Rect skipRect = new Rect((inRect.width - 100f) / 2f, y + 10f, 100f, 20f);
                Widgets.Label(skipRect, "Skip setup");
                if (Widgets.ButtonInvisible(skipRect))
                {
                    // Apply defaults and skip to finish
                    currentPage = TotalPages - 1;
                }
                GUI.color = Color.white;
                Text.Font = GameFont.Small;
            }
        }

        private void ApplySettings()
        {
            var settings = PlayerStorytellerMod.settings;
            if (settings == null) return;

            // Apply quality
            settings.streamingQuality = selectedQuality;

            // Apply preset
            switch (selectedPreset)
            {
                case "helpful":
                    ApplyHelpfulPreset(settings);
                    break;
                case "balanced":
                    ApplyBalancedPreset(settings);
                    break;
                case "chaos":
                    settings.EnableAllActions();
                    break;
                case "custom":
                    settings.DisableAllActions();
                    break;
            }

            // Mark setup as complete
            settings.hasAcceptedPrivacyNotice = true;
            settings.hasCompletedSetupWizard = true;
            settings.Write();

            Messages.Message("RatLab is ready! Load a save to start streaming.", MessageTypeDefOf.PositiveEvent);
        }

        private void ApplyHelpfulPreset(PlayerStorytellerSettings settings)
        {
            settings.DisableAllActions();

            // Enable only helpful actions
            settings.enableHealColonist = true;
            settings.enableHealAll = true;
            settings.enableInspireColonist = true;
            settings.enableInspireAll = true;
            settings.enableSendWanderer = true;
            settings.enableSendRefugee = true;

            // Resources
            settings.enableDropFood = true;
            settings.enableDropMedicine = true;
            settings.enableDropSteel = true;
            settings.enableDropComponents = true;
            settings.enableDropSilver = true;
            settings.enableLegendary = true;
            settings.enableSendTrader = true;

            // Good events
            settings.enableTameAnimal = true;
            settings.enableGoodEvent = true;
            settings.enablePsychicSoothe = true;
            settings.enableAmbrosiaSprout = true;
            settings.enableFarmAnimalsWanderIn = true;
            settings.enableAurora = true;

            // Clear weather only
            settings.enableWeatherClear = true;

            // Communication
            settings.enableSendLetter = true;
            settings.enablePing = true;
        }

        private void ApplyBalancedPreset(PlayerStorytellerSettings settings)
        {
            // Start with helpful
            ApplyHelpfulPreset(settings);

            // Add some mild chaos
            settings.enableSpawnAnimal = true;
            settings.enableThrumboPasses = true;
            settings.enableHerdMigration = true;
            settings.enableWildManWandersIn = true;

            // Weather variety
            settings.enableWeatherRain = true;
            settings.enableWeatherFog = true;
            settings.enableWeatherSnow = true;
            settings.enableWeatherThunderstorm = true;

            // Minor threats
            settings.enableMadAnimal = true;
            settings.enableFlashstorm = true;
            settings.enableLightning = true;
            settings.enableAlphabeavers = true;
        }
    }
}
