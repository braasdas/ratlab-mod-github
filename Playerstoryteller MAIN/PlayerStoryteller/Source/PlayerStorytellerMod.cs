using System;
using System.Collections.Generic;
using Verse;
using UnityEngine;
using System.Net.Http;
using System.Threading.Tasks;
using System.Text;

namespace PlayerStoryteller
{
    public class PlayerStorytellerMod : Mod
    {
        public static PlayerStorytellerSettings settings;
        private static HttpClient httpClient;

        public PlayerStorytellerMod(ModContentPack content) : base(content)
        {
            settings = GetSettings<PlayerStorytellerSettings>();
            httpClient = new HttpClient();

            Log.Message("Player Storyteller Mod initialized");
        }

        public override string SettingsCategory()
        {
            return "Player Storyteller";
        }

        public override void DoSettingsWindowContents(Rect inRect)
        {
            Listing_Standard listingStandard = new Listing_Standard();
            listingStandard.Begin(inRect);

            listingStandard.Label("Server URL:");
            settings.serverUrl = listingStandard.TextEntry(settings.serverUrl);

            listingStandard.Label("Update Interval (seconds):");
            settings.updateInterval = (int)listingStandard.Slider(settings.updateInterval, 1f, 10f);

            listingStandard.End();
            base.DoSettingsWindowContents(inRect);
        }

        public static async Task SendScreenshotToServer(byte[] screenshotData)
        {
            try
            {
                var content = new ByteArrayContent(screenshotData);
                content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/png");

                var response = await httpClient.PostAsync($"{settings.serverUrl}/api/screenshot", content);

                if (!response.IsSuccessStatusCode)
                {
                    Log.Warning($"Failed to send screenshot: {response.StatusCode}");
                }
            }
            catch (Exception ex)
            {
                Log.Error($"Error sending screenshot: {ex.Message}");
            }
        }

        public static async Task SendGameStateToServer(string gameStateJson)
        {
            try
            {
                var content = new StringContent(gameStateJson, Encoding.UTF8, "application/json");
                var response = await httpClient.PostAsync($"{settings.serverUrl}/api/gamestate", content);

                if (!response.IsSuccessStatusCode)
                {
                    Log.Warning($"Failed to send game state: {response.StatusCode}");
                }
            }
            catch (Exception ex)
            {
                Log.Error($"Error sending game state: {ex.Message}");
            }
        }
    }

    public class PlayerStorytellerSettings : ModSettings
    {
        public string serverUrl = "http://localhost:3000";
        public int updateInterval = 1;

        public override void ExposeData()
        {
            Scribe_Values.Look(ref serverUrl, "serverUrl", "http://localhost:3000");
            Scribe_Values.Look(ref updateInterval, "updateInterval", 1);
            base.ExposeData();
        }
    }
}
