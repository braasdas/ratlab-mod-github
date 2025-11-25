using System;
using System.Collections.Generic;
using System.Linq;
using Verse;
using RimWorld;
using UnityEngine;
using System.Net.Http;
using System.Threading.Tasks;
using System.Text;

namespace PlayerStoryteller
{
    [StaticConstructorOnStartup]
    public static class PlayerStorytellerBootstrap
    {
        static PlayerStorytellerBootstrap()
        {
            Log.Message("[Player Storyteller] Bootstrap initialized");

            // Register the GameComponent when a game is loaded or started
            LongEventHandler.ExecuteWhenFinished(delegate
            {
                if (Current.Game != null)
                {
                    EnsureGameComponentExists();
                }
            });
        }

        public static void EnsureGameComponentExists()
        {
            try
            {
                if (Current.Game == null) return;

                var existingComponent = Current.Game.GetComponent<PlayerStorytellerGameComponent>();
                if (existingComponent == null)
                {
                    var component = new PlayerStorytellerGameComponent(Current.Game);
                    Current.Game.components.Add(component);
                    Log.Message("[Player Storyteller] GameComponent registered");
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error ensuring GameComponent: {ex.Message}");
            }
        }
    }

    public class PlayerStorytellerMod : Mod
    {
        public static PlayerStorytellerSettings settings;
        private static HttpClient httpClient;

        public PlayerStorytellerMod(ModContentPack content) : base(content)
        {
            settings = GetSettings<PlayerStorytellerSettings>();
            httpClient = new HttpClient();

            Log.Message("[Player Storyteller] Mod initialized");
        }

        public override string SettingsCategory()
        {
            return "Player Storyteller";
        }

        private bool isRunningSpeedTest = false;

        public override void DoSettingsWindowContents(Rect inRect)
        {
            // Ensure GameComponent is registered when settings are opened
            PlayerStorytellerBootstrap.EnsureGameComponentExists();

            Listing_Standard listingStandard = new Listing_Standard();
            listingStandard.Begin(inRect);

            listingStandard.Label("Server URL:");
            settings.serverUrl = listingStandard.TextEntry(settings.serverUrl);

            listingStandard.Gap(12f);

            // Speed test section
            if (!string.IsNullOrEmpty(settings.lastSpeedTestTime))
            {
                Text.Font = GameFont.Tiny;
                listingStandard.Label($"Last speed test: {settings.lastSpeedTestTime} - {settings.lastSpeedTestBandwidth:F0} KB/s (~{settings.lastSpeedTestBandwidth * 8 / 1024:F1} Mbps)");
                Text.Font = GameFont.Small;
            }

            if (listingStandard.ButtonText(isRunningSpeedTest ? "Testing network speed..." : "Run Network Speed Test"))
            {
                if (!isRunningSpeedTest)
                {
                    RunSpeedTestAsync();
                }
            }

            listingStandard.Gap(12f);

            // Update interval slider with current FPS display
            float fps = 1f / settings.updateInterval;
            listingStandard.Label($"Update Interval: {settings.updateInterval:F2}s (~{fps:F1} FPS)");
            settings.updateInterval = listingStandard.Slider(settings.updateInterval, 0.1f, 5f);

            listingStandard.Gap(12f);

            // Resolution scale slider
            listingStandard.Label($"Screenshot Resolution Scale: {settings.resolutionScale:F2}x ({(int)(Screen.width * settings.resolutionScale)}x{(int)(Screen.height * settings.resolutionScale)})");
            settings.resolutionScale = listingStandard.Slider(settings.resolutionScale, 0.25f, 1.0f);

            listingStandard.Gap(12f);

            // JPEG quality slider
            listingStandard.Label($"Screenshot Quality: {settings.screenshotQuality}%");
            settings.screenshotQuality = (int)listingStandard.Slider(settings.screenshotQuality, 10f, 100f);

            listingStandard.Gap(12f);

            // Info text
            Text.Font = GameFont.Tiny;
            listingStandard.Label("Lower resolution and quality = higher FPS and lower bandwidth");
            Text.Font = GameFont.Small;

            listingStandard.End();
            base.DoSettingsWindowContents(inRect);

            // Run automatic speed test on first open
            if (!settings.hasRunInitialSpeedTest && !isRunningSpeedTest)
            {
                settings.hasRunInitialSpeedTest = true;
                RunSpeedTestAsync();
            }
        }

        private async void RunSpeedTestAsync()
        {
            isRunningSpeedTest = true;

            try
            {
                var result = await NetworkSpeedTest.RunSpeedTest(settings.serverUrl);

                if (result != null)
                {
                    NetworkSpeedTest.ApplyOptimalSettings(result, settings);
                    settings.Write();
                    Messages.Message("Network speed test complete! Settings optimized for your connection.", MessageTypeDefOf.PositiveEvent);
                }
                else
                {
                    Messages.Message("Network speed test failed. Using default settings.", MessageTypeDefOf.NegativeEvent);
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Speed test exception: {ex.Message}");
                Messages.Message("Network speed test failed. Using default settings.", MessageTypeDefOf.NegativeEvent);
            }
            finally
            {
                isRunningSpeedTest = false;
            }
        }

        public static async Task SendScreenshotToServer(byte[] screenshotData)
        {
            try
            {
                if (string.IsNullOrEmpty(settings.serverUrl))
                {
                    Log.Warning("[Player Storyteller] Server URL not configured");
                    return;
                }

                var content = new ByteArrayContent(screenshotData);
                content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/jpeg");

                var request = new HttpRequestMessage(HttpMethod.Post, $"{settings.serverUrl}/api/screenshot");
                request.Content = content;
                request.Headers.Add("session-id", GetSessionId());

                var response = await httpClient.SendAsync(request);

                if (response.IsSuccessStatusCode)
                {
                    Log.Message($"[Player Storyteller] Screenshot sent successfully");
                }
                else
                {
                    Log.Warning($"[Player Storyteller] Failed to send screenshot: {response.StatusCode}");
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error sending screenshot: {ex.Message}");
            }
        }

        public static async Task SendGameStateToServer(string gameStateJson)
        {
            try
            {
                if (string.IsNullOrEmpty(settings.serverUrl))
                {
                    Log.Warning("[Player Storyteller] Server URL not configured");
                    return;
                }

                var content = new StringContent(gameStateJson, Encoding.UTF8, "application/json");

                var request = new HttpRequestMessage(HttpMethod.Post, $"{settings.serverUrl}/api/gamestate");
                request.Content = content;
                request.Headers.Add("session-id", GetSessionId());

                var response = await httpClient.SendAsync(request);

                if (response.IsSuccessStatusCode)
                {
                    Log.Message($"[Player Storyteller] Game state sent successfully");
                }
                else
                {
                    Log.Warning($"[Player Storyteller] Failed to send game state: {response.StatusCode}");
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error sending game state: {ex.Message}");
            }
        }

        private static string GetSessionId()
        {
            // Use the world seed as a unique session identifier
            if (Current.Game != null && Current.Game.World != null)
            {
                return Current.Game.World.info.seedString;
            }
            return "default-session";
        }
    }

    public class PlayerStorytellerSettings : ModSettings
    {
        public string serverUrl = "http://localhost:3000";
        public float updateInterval = 0.5f;
        public float resolutionScale = 0.75f;
        public int screenshotQuality = 85;
        public double lastSpeedTestBandwidth = 0.0;
        public string lastSpeedTestTime = "";
        public bool hasRunInitialSpeedTest = false;

        public override void ExposeData()
        {
            Scribe_Values.Look(ref serverUrl, "serverUrl", "http://localhost:3000");
            Scribe_Values.Look(ref updateInterval, "updateInterval", 0.5f);
            Scribe_Values.Look(ref resolutionScale, "resolutionScale", 0.75f);
            Scribe_Values.Look(ref screenshotQuality, "screenshotQuality", 85);
            Scribe_Values.Look(ref lastSpeedTestBandwidth, "lastSpeedTestBandwidth", 0.0);
            Scribe_Values.Look(ref lastSpeedTestTime, "lastSpeedTestTime", "");
            Scribe_Values.Look(ref hasRunInitialSpeedTest, "hasRunInitialSpeedTest", false);
            base.ExposeData();
        }
    }
}
