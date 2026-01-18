using System;
using System.Collections.Generic;
using System.IO.Compression;
using System.Linq;
using Verse;
using RimWorld;
using UnityEngine;
using System.Net.Http;
using System.Threading.Tasks;
using System.Text;
using System.Security.Cryptography;
using Newtonsoft.Json;

namespace PlayerStoryteller
{
    public class PlayerStorytellerMod : Mod
    {
        public static PlayerStorytellerMod Instance { get; private set; }
        public static PlayerStorytellerSettings settings;
        private static HttpClient httpClient;
        private const int MaxRetries = 5;
        private const int RetryDelayMs = 2000;

        // Connection failure tracking
        private static int consecutiveFailures = 0;
        private static bool connectionPaused = false;
        private static readonly object connectionLock = new object();

        public PlayerStorytellerMod(ModContentPack content) : base(content)
        {
            Instance = this;
            settings = GetSettings<PlayerStorytellerSettings>();
            httpClient = new HttpClient();

            Log.Message("[Player Storyteller] Mod initialized");
        }

        public override string SettingsCategory()
        {
            return "Rat Lab";
        }

        private Vector2 scrollPosition = Vector2.zero;
        private static readonly float SettingsHeight = 2500f;

        public override void DoSettingsWindowContents(Rect inRect)
        {
            // Create scrollable view
            Rect viewRect = new Rect(0f, 0f, inRect.width - 20f, SettingsHeight);
            Widgets.BeginScrollView(inRect, ref scrollPosition, viewRect);

            Listing_Standard listingStandard = new Listing_Standard();
            listingStandard.Begin(viewRect);

            // === DASHBOARD & CONNECTION ===
            Text.Font = GameFont.Medium;
            listingStandard.Label("Web Dashboard & Connection");
            Text.Font = GameFont.Small;

            string serverUrl = GetServerUrl();
            string sessionId = GetSessionId();
            
            // Dashboard Link Button
            if (listingStandard.ButtonText("Copy Dashboard Link"))
            {
                string dashboardUrl = $"{serverUrl}/dashboard.html?session={Uri.EscapeDataString(sessionId)}";
                GUIUtility.systemCopyBuffer = dashboardUrl;
                Messages.Message("Dashboard link copied!", MessageTypeDefOf.PositiveEvent);
            }
            Text.Font = GameFont.Tiny;
            listingStandard.Label("Paste this link in your browser to manage settings.");
            Text.Font = GameFont.Small;

            listingStandard.Gap(6f);

            // Admin Password (Stream Key)
            if (string.IsNullOrEmpty(settings.secretKey))
            {
                settings.secretKey = GeneratePrivateStreamId(); 
                settings.Write();
            }

            listingStandard.Label("Admin Password (Stream Key):");
            string keyDisplay = new string('•', 24); // Always masked
            
            Rect keyRect = listingStandard.GetRect(30f);
            Rect keyTextRect = new Rect(keyRect.x, keyRect.y, keyRect.width - 120f, keyRect.height);
            Rect keyBtnRect = new Rect(keyRect.width - 110f, keyRect.y, 110f, keyRect.height);

            Widgets.Label(keyTextRect, keyDisplay);
            if (Widgets.ButtonText(keyBtnRect, "Copy Key"))
            {
                GUIUtility.systemCopyBuffer = settings.secretKey;
                Messages.Message("Stream key copied to clipboard.", MessageTypeDefOf.PositiveEvent);
            }
            Text.Font = GameFont.Tiny;
            listingStandard.Label("REQUIRED to log in to the dashboard.");
            Text.Font = GameFont.Small;

            listingStandard.Gap(12f);

            // Interaction Password
            listingStandard.Label("Interaction Password (Optional):");
            string passwordDisplay = string.IsNullOrEmpty(settings.interactionPassword) ? "None Set" : new string('•', 8);
            
            Rect passRect = listingStandard.GetRect(30f);
            Rect passTextRect = new Rect(passRect.x, passRect.y, passRect.width - 110f, passRect.height);
            Rect passBtnRect = new Rect(passRect.width - 110f, passRect.y, 110f, passRect.height);

            if (Widgets.ButtonText(passTextRect, passwordDisplay))
            {
                Find.WindowStack.Add(new Dialog_Input("Set Interaction Password", "Enter new password:", (newPass) => 
                {
                    settings.interactionPassword = newPass;
                    settings.Write();
                }));
            }
            if (Widgets.ButtonText(passBtnRect, "Clear"))
            {
                settings.interactionPassword = "";
                settings.Write();
                Messages.Message("Interaction password cleared.", MessageTypeDefOf.PositiveEvent);
            }
            Text.Font = GameFont.Tiny;
            listingStandard.Label("If set, viewers must enter this to perform actions.");
            Text.Font = GameFont.Small;

            listingStandard.Gap(12f);

            // Queue Control
            if (listingStandard.ButtonText("Trigger Queue Now"))
            {
                _ = TriggerQueueNow();
            }
            Text.Font = GameFont.Tiny;
            listingStandard.Label("Immediately executes the top-voted action and resets the timer.");
            Text.Font = GameFont.Small;

            listingStandard.Gap(12f);

            // Server URL Config
            listingStandard.Label("Server URL:");
            settings.serverUrl = listingStandard.TextEntry(settings.serverUrl);
            if (listingStandard.ButtonText("Reset to Default"))
            {
                settings.serverUrl = "https://ratlab.online";
            }
            
            listingStandard.Gap(6f);
            listingStandard.CheckboxLabeled("Dev Mode (Use localhost:3000)", ref settings.devMode);
            listingStandard.CheckboxLabeled("Enable Map Render (may cause visual glitches)", ref settings.enableMapRender);

            listingStandard.Gap(12f);

            // Re-run Setup Wizard button
            if (listingStandard.ButtonText("Re-run Setup Wizard"))
            {
                Find.WindowStack.Add(new Dialog_SetupWizard());
            }
            Text.Font = GameFont.Tiny;
            listingStandard.Label("Opens the first-time setup wizard to quickly reconfigure settings.");
            Text.Font = GameFont.Small;

            listingStandard.Gap(24f);

            // === TELEMETRY ===
            Text.Font = GameFont.Medium;
            listingStandard.Label("Telemetry Intervals");
            Text.Font = GameFont.Small;

            // Streaming Quality (auto-restarts sidecar when changed)
            listingStandard.Label("Streaming Quality:");
            string previousQuality = settings.streamingQuality;
            if (listingStandard.RadioButton("Low (1000kbps)", settings.streamingQuality == "low")) settings.streamingQuality = "low";
            if (listingStandard.RadioButton("Medium (2500kbps)", settings.streamingQuality == "medium")) settings.streamingQuality = "medium";
            if (listingStandard.RadioButton("High (4500kbps)", settings.streamingQuality == "high")) settings.streamingQuality = "high";
            
            // Auto-restart sidecar if quality changed
            if (previousQuality != settings.streamingQuality)
            {
                Log.Message($"[Player Storyteller] Streaming quality changed from {previousQuality} to {settings.streamingQuality}. Restarting sidecar...");
                settings.Write();
                // Trigger sidecar restart via MapComponent
                PlayerStorytellerMapComponent.Instance?.RestartSidecar();
            }

            listingStandard.Gap(6f);

            listingStandard.Label($"Colonist Status: {settings.fastDataInterval:F1}s");
            settings.fastDataInterval = listingStandard.Slider(settings.fastDataInterval, 0.5f, 10f);

            listingStandard.Label($"Colony Stats: {settings.slowDataInterval:F1}s");
            settings.slowDataInterval = listingStandard.Slider(settings.slowDataInterval, 1f, 30f);

            listingStandard.Label($"World Data: {settings.staticDataInterval:F0}s");
            settings.staticDataInterval = listingStandard.Slider(settings.staticDataInterval, 10f, 120f);

            listingStandard.End();
            Widgets.EndScrollView();

            base.DoSettingsWindowContents(inRect);
        }

        // Whitelist of allowed server domains for security
        private static readonly HashSet<string> AllowedDomains = new HashSet<string>
        {
            "ratlab.online",
            "www.ratlab.online",
            "localhost" // For dev mode
        };

        public static string GetServerUrl()
        {
            // Dev mode: use localhost
            if (settings.devMode)
            {
                return "http://localhost:3000";
            }

            if (string.IsNullOrEmpty(settings.serverUrl))
            {
                return "https://ratlab.online";
            }

            string url = settings.serverUrl.TrimEnd('/');

            // Validate URL
            if (!IsValidServerUrl(url))
            {
                Log.Warning($"[Player Storyteller] Invalid or untrusted server URL: {url}. Using default.");
                settings.serverUrl = "https://ratlab.online";
                settings.Write();
                return "https://ratlab.online";
            }

            return url;
        }

        /// <summary>
        /// Validates that a server URL is safe to use.
        /// Checks for proper format and whitelisted domain.
        /// </summary>
        private static bool IsValidServerUrl(string url)
        {
            if (string.IsNullOrEmpty(url))
                return false;

            try
            {
                // Parse URL
                if (!Uri.TryCreate(url, UriKind.Absolute, out Uri uri))
                    return false;

                // Must be HTTP or HTTPS
                if (uri.Scheme != "http" && uri.Scheme != "https")
                {
                    Log.Warning($"[Player Storyteller] Invalid URL scheme: {uri.Scheme}. Only http and https are allowed.");
                    return false;
                }

                // In production, enforce HTTPS (except for localhost)
                if (!settings.devMode && uri.Scheme != "https" && uri.Host != "localhost")
                {
                    Log.Warning($"[Player Storyteller] Non-HTTPS URL not allowed in production mode: {url}");
                    return false;
                }

                // Check domain whitelist
                string host = uri.Host.ToLowerInvariant();
                if (!AllowedDomains.Contains(host))
                {
                    Log.Warning($"[Player Storyteller] Domain not in whitelist: {host}. Allowed domains: {string.Join(", ", AllowedDomains)}");
                    return false;
                }

                return true;
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error validating URL: {ex}");
                return false;
            }
        }

        private void ShowPrivacyNoticeDialog()
        {
            Find.WindowStack.Add(new Dialog_MessageBox(
                "PRIVACY NOTICE\n\n" +
                "This mod transmits data to an external server:\n\n" +
                "• Live video stream of your game window\n" +
                "• Colonist info (names, health, positions)\n" +
                "• Colony stats (wealth, resources)\n" +
                "• Viewer actions and messages\n\n" +
                "Privacy: Choose Public or Private mode in settings\n" +
                "Security: HTTPS encryption, rate limiting, no long-term storage\n\n" +
                "Full details in About.xml\n\n" +
                "Accept to continue?",
                "Accept",
                delegate {
                    settings.hasAcceptedPrivacyNotice = true;
                    settings.Write();
                    Messages.Message("Privacy notice accepted.", MessageTypeDefOf.PositiveEvent);
                },
                "Decline",
                delegate {
                    Messages.Message("Declined. Disable the mod if you don't wish to transmit data.", MessageTypeDefOf.RejectInput);
                },
                null,
                false,
                null,
                null
            ));
        }

        private static WebSocketClient wsClient;
        private static string lastServerUrl;
        private static string lastSessionId;

        public static void SendStreamingUpdateAsync(byte[] screenshot, int length, string gameState)
        {
            string serverUrl = GetServerUrl();
            string currentSessionId = GetSessionId();

            // If URL changed (e.g. devMode toggled), reset client
            if (lastServerUrl != serverUrl && wsClient != null)
            {
                Log.Message($"[Player Storyteller] Server URL changed from {lastServerUrl} to {serverUrl}. Reconnecting...");
                wsClient = null; 
            }
            
            // If Session ID changed (e.g. switched Public/Private), reset client
            if (lastSessionId != currentSessionId && wsClient != null)
            {
                Log.Message($"[Player Storyteller] Session ID changed from {lastSessionId} to {currentSessionId}. Reconnecting...");
                wsClient = null;
            }

            lastServerUrl = serverUrl;
            lastSessionId = currentSessionId;

            // Always ensure client exists
            if (wsClient == null)
            {
                 // Ensure we have a valid session ID for public streams too
                 if (currentSessionId == "default-session" && settings.isPublicStream)
                 {
                     currentSessionId = GetSessionId();
                     lastSessionId = currentSessionId;
                 }

                 wsClient = new WebSocketClient(serverUrl, currentSessionId, settings.secretKey, settings.isPublicStream, settings.interactionPassword);
            }
            
            // Check connection state
            if (!wsClient.IsConnected)
            {
                 _ = wsClient.Connect();
            }

            if (!string.IsNullOrEmpty(gameState))
            {
                _ = wsClient.SendGameState(gameState);
            }
        }

        public static void SendMapUpdateAsync(byte[] image)
        {
            if (image == null || image.Length == 0) 
            {
                Log.Warning("[Player Storyteller] SendMapUpdateAsync called with empty image.");
                return;
            }

            Log.Message($"[Player Storyteller] Sending Map Update. Size: {image.Length} bytes.");

            string serverUrl = GetServerUrl();
            string currentSessionId = GetSessionId();

            if (wsClient == null || lastSessionId != currentSessionId)
            {
                lastServerUrl = serverUrl;
                lastSessionId = currentSessionId;
                if (currentSessionId == "default-session" && settings.isPublicStream) currentSessionId = GetSessionId();
                
                wsClient = new WebSocketClient(serverUrl, currentSessionId, settings.secretKey, settings.isPublicStream, settings.interactionPassword);
            }

            if (!wsClient.IsConnected) _ = wsClient.Connect();

            _ = wsClient.SendMapImage(image, image.Length);
        }

        public static async Task<bool> SendTerrainDataAsync(string terrainPayload)
        {
            if (string.IsNullOrEmpty(terrainPayload)) return false;

            try
            {
                string serverUrl = GetServerUrl();
                string sessionId = GetSessionId();
                var request = new HttpRequestMessage(HttpMethod.Post, $"{serverUrl}/api/v1/map/terrain/{Uri.EscapeDataString(sessionId)}");
                request.Headers.Add("x-stream-key", settings.secretKey);
                request.Content = new StringContent(terrainPayload, Encoding.UTF8, "application/json");

                var response = await httpClient.SendAsync(request);
                if (!response.IsSuccessStatusCode)
                {
                    Log.Warning($"[Player Storyteller] Failed to push terrain data: {response.StatusCode}");
                    return false;
                }

                Log.Message("[Player Storyteller] Terrain data upload acknowledged by server.");
                return true;
            }
            catch (Exception ex)
            {
                Log.Warning($"[Player Storyteller] Error sending terrain data: {ex.Message}");
                return false;
            }
        }

        public static async Task<bool> SendMapThingsAsync(string thingsPayload)
        {
            if (string.IsNullOrEmpty(thingsPayload)) return false;

            try
            {
                string serverUrl = GetServerUrl();
                string sessionId = GetSessionId();
                var request = new HttpRequestMessage(HttpMethod.Post, $"{serverUrl}/api/v1/map/things/{Uri.EscapeDataString(sessionId)}");
                request.Headers.Add("x-stream-key", settings.secretKey);
                request.Content = new StringContent(thingsPayload, Encoding.UTF8, "application/json");

                var response = await httpClient.SendAsync(request);
                if (!response.IsSuccessStatusCode)
                {
                    Log.Warning($"[Player Storyteller] Failed to push map things data: {response.StatusCode}");
                    return false;
                }

                return true;
            }
            catch (Exception ex)
            {
                Log.Warning($"[Player Storyteller] Error sending map things data: {ex.Message}");
                return false;
            }
        }

        public static async Task<HashSet<string>> FetchTextureManifestAsync()
        {
            try
            {
                string serverUrl = GetServerUrl();
                var response = await httpClient.GetAsync($"{serverUrl}/textures/manifest");
                
                if (response.IsSuccessStatusCode)
                {
                    string json = await response.Content.ReadAsStringAsync();
                    var list = JsonConvert.DeserializeObject<List<string>>(json);
                    return new HashSet<string>(list ?? new List<string>());
                }
            }
            catch (Exception ex)
            {
                Log.Warning($"[Player Storyteller] Failed to fetch texture manifest: {ex.Message}");
            }
            return new HashSet<string>();
        }

        public static async Task<bool> SendTexturesBatchAsync(string jsonPayload)
        {
            try
            {
                string serverUrl = GetServerUrl();
                var request = new HttpRequestMessage(HttpMethod.Post, $"{serverUrl}/textures");
                request.Headers.Add("x-stream-key", settings.secretKey);
                request.Content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");

                Log.Message($"[Player Storyteller] Sending textures to {serverUrl}/textures (payload size: {jsonPayload.Length} bytes)");
                var response = await httpClient.SendAsync(request);

                if (!response.IsSuccessStatusCode)
                {
                    string errorBody = await response.Content.ReadAsStringAsync();
                    Log.Warning($"[Player Storyteller] Texture upload failed: HTTP {(int)response.StatusCode} {response.ReasonPhrase} - {errorBody}");
                }
                return response.IsSuccessStatusCode;
            }
            catch (Exception ex)
            {
                Log.Warning($"[Player Storyteller] Failed to upload textures: {ex.Message}");
                return false;
            }
        }

        private static async Task<bool> SendWithRetriesAsync(HttpRequestMessage request, string logIdentifier)
        {
            for (int i = 0; i < MaxRetries; i++)
            {
                try
                {
                    // Clone the request for retries
                    var requestClone = new HttpRequestMessage(request.Method, request.RequestUri);
                    
                    // Copy headers
                    foreach (var header in request.Headers)
                    {
                        requestClone.Headers.TryAddWithoutValidation(header.Key, header.Value);
                    }
                    requestClone.Headers.Add("session-id", GetSessionId());


                    if (request.Content != null)
                    {
                        var stream = new System.IO.MemoryStream();
                        await request.Content.CopyToAsync(stream);
                        stream.Position = 0;
                        requestClone.Content = new StreamContent(stream);

                        if (request.Content.Headers.ContentType != null)
                        {
                            requestClone.Content.Headers.ContentType = request.Content.Headers.ContentType;
                        }
                    }

                    var response = await httpClient.SendAsync(requestClone);

                    if (response.IsSuccessStatusCode)
                    {
                        return true;
                    }
                }
                catch (Exception)
                {
                    // Silent retry
                }

                if (i < MaxRetries - 1)
                {
                    await Task.Delay(RetryDelayMs);
                }
            }

            Log.Error($"[Player Storyteller] Failed to send {logIdentifier} after {MaxRetries} attempts.");
            return false;
        }

        public static bool IsConnectionPaused()
        {
            lock (connectionLock)
            {
                return connectionPaused;
            }
        }

        public static void ResetConnection()
        {
            lock (connectionLock)
            {
                consecutiveFailures = 0;
                connectionPaused = false;
            }
        }

        private static void ShowConnectionFailureDialog()
        {
            Find.WindowStack.Add(new Dialog_MessageBox(
                "PLAYER STORYTELLER - CONNECTION FAILED\n\n" +
                "The mod has failed to connect to the server.\n\n" +
                "Check your internet connection and ensure the server is reachable.",
                "OK",
                delegate { },
                null,
                null,
                null,
                false,
                null,
                null
            ));
        }

        public static async Task SendUpdateToServerAsync(UpdatePayload payload)
        {
            // Check if connection is paused
            lock (connectionLock)
            {
                if (connectionPaused)
                {
                    return; // Silently skip if paused
                }
            }

            try
            {
                string serverUrl = GetServerUrl();
                string jsonPayload = JsonUtility.ToJson(payload);
                byte[] jsonBytes = Encoding.UTF8.GetBytes(jsonPayload);

                // Compress payload
                byte[] compressedBytes;
                using (var outStream = new System.IO.MemoryStream())
                {
                    using (var archive = new GZipStream(outStream, CompressionMode.Compress))
                    {
                        archive.Write(jsonBytes, 0, jsonBytes.Length);
                    }
                    compressedBytes = outStream.ToArray();
                }

                var content = new ByteArrayContent(compressedBytes);
                content.Headers.Add("Content-Type", "application/json");
                content.Headers.Add("Content-Encoding", "gzip"); // Signal to server

                var request = new HttpRequestMessage(HttpMethod.Post, $"{serverUrl}/api/update")
                {
                    Content = content
                };

                // Ensure secret key exists
                if (string.IsNullOrEmpty(settings.secretKey))
                {
                    settings.secretKey = GeneratePrivateStreamId();
                    settings.Write();
                }

                // Add headers
                request.Headers.Add("is-public", settings.isPublicStream.ToString().ToLower());
                request.Headers.Add("x-stream-key", settings.secretKey);
                if (!string.IsNullOrEmpty(settings.interactionPassword))
                {
                    request.Headers.Add("x-interaction-password", settings.interactionPassword);
                }

                bool success = await SendWithRetriesAsync(request, "update");

                lock (connectionLock)
                {
                    if (success)
                    {
                        consecutiveFailures = 0;
                    }
                    else
                    {
                        consecutiveFailures++;
                        if (consecutiveFailures >= 3 && !connectionPaused)
                        {
                            connectionPaused = true;
                            ShowConnectionFailureDialog();
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in SendUpdateToServerAsync: {ex}");

                lock (connectionLock)
                {
                    consecutiveFailures++;
                    if (consecutiveFailures >= 3 && !connectionPaused)
                    {
                        connectionPaused = true;
                        ShowConnectionFailureDialog();
                    }
                }
            }
        }

        private static string GeneratePrivateStreamId()
        {
            const string chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
            char[] stringChars = new char[24];
            byte[] randomBytes = new byte[24];

            using (RNGCryptoServiceProvider rng = new RNGCryptoServiceProvider())
            {
                rng.GetBytes(randomBytes);
            }

            for (int i = 0; i < stringChars.Length; i++)
            {
                stringChars[i] = chars[randomBytes[i] % chars.Length];
            }

            return new string(stringChars);
        }

        public static string GetSessionId()
        {
            if (!settings.isPublicStream)
            {
                if (string.IsNullOrEmpty(settings.privateStreamId))
                {
                    settings.privateStreamId = GeneratePrivateStreamId();
                    settings.Write();
                }
                return settings.privateStreamId;
            }

            if (Current.Game != null && Current.Game.World != null)
            {
                return Current.Game.World.info.seedString;
            }
            return "default-session";
        }

        public static async Task TriggerQueueNow()
        {
            try
            {
                string sessionId = GetSessionId();
                if (string.IsNullOrEmpty(sessionId)) return;

                string serverUrl = GetServerUrl();
                string url = $"{serverUrl}/api/queue/{Uri.EscapeDataString(sessionId)}/force-trigger";

                var request = new HttpRequestMessage(HttpMethod.Post, url);
                request.Headers.Add("x-stream-key", settings.secretKey);

                var response = await httpClient.SendAsync(request);

                if (response.IsSuccessStatusCode)
                {
                    Messages.Message("Queue triggered successfully.", MessageTypeDefOf.PositiveEvent);
                }
                else
                {
                    Messages.Message("Failed to trigger queue.", MessageTypeDefOf.RejectInput);
                    Log.Error($"[Player Storyteller] Failed to trigger queue. Status: {response.StatusCode}");
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error triggering queue: {ex}");
                Messages.Message("Error triggering queue.", MessageTypeDefOf.RejectInput);
            }
        }

        public static async Task<List<PlayerAction>> GetPlayerActionsAsync()
        {
            try
            {
                string sessionId = GetSessionId();
                string encodedSessionId = Uri.EscapeDataString(sessionId);
                string serverUrl = GetServerUrl();
                string url = $"{serverUrl}/api/actions/{encodedSessionId}";

                var response = await httpClient.GetAsync(url);

                if (response.IsSuccessStatusCode)
                {
                    string json = await response.Content.ReadAsStringAsync();

                    try
                    {
                        var actionsResponse = JsonConvert.DeserializeObject<ActionsResponse>(json);
                        if (actionsResponse != null && actionsResponse.success && actionsResponse.actions != null)
                        {
                            return actionsResponse.actions;
                        }
                    }
                    catch (JsonException ex)
                    {
                        Log.Warning($"[Player Storyteller] Failed to parse actions JSON: {ex.Message}");
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Warning($"[Player Storyteller] Failed to fetch actions: {ex.Message}");
            }

            return new List<PlayerAction>();
        }

        public static async Task PollRemoteSettingsAsync()
        {
            try
            {
                // Only poll if we have a valid session ID
                string sessionId = GetSessionId();
                if (string.IsNullOrEmpty(sessionId) || sessionId == "default-session") return;

                string serverUrl = GetServerUrl();
                string url = $"{serverUrl}/api/settings/{Uri.EscapeDataString(sessionId)}";

                var response = await httpClient.GetAsync(url);
                if (response.IsSuccessStatusCode)
                {
                    string json = await response.Content.ReadAsStringAsync();
                    var remoteData = JsonConvert.DeserializeObject<SettingsResponse>(json);

                    if (remoteData != null)
                    {
                        ApplyRemoteSettings(remoteData);
                    }
                }
            }
            catch (Exception)
            {
                // Silent fail for settings polling to avoid log spam
            }
        }

        private static void ApplyRemoteSettings(SettingsResponse response)
        {
            if (response == null) return;
            
            // Apply Meta (Privacy)
            if (response.meta != null)
            {
                if (settings.isPublicStream != response.meta.isPublic)
                {
                    Log.Message($"[Player Storyteller] Remote setting change: Public Stream = {response.meta.isPublic}");
                    settings.isPublicStream = response.meta.isPublic;
                    
                    // If switching to private, ensure we have a private ID generated immediately
                    if (!settings.isPublicStream && string.IsNullOrEmpty(settings.privateStreamId))
                    {
                        settings.privateStreamId = GeneratePrivateStreamId();
                    }
                    settings.Write();
                }
            }

            var remote = response.settings;
            if (remote == null) return;

            // Apply General Settings
            if (remote.fastDataInterval > 0) settings.fastDataInterval = remote.fastDataInterval;
            if (remote.slowDataInterval > 0) settings.slowDataInterval = remote.slowDataInterval;
            if (remote.staticDataInterval > 0) settings.staticDataInterval = remote.staticDataInterval;
            
            // IMPORTANT: Check if remote `isPublicStream` status changed (i.e. from Dashboard)
            // If Dashboard toggled it off (enableLiveScreen is irrelevant here, check `remote.enableLiveScreen` vs `isPublicStream` mismatch?)
            // Actually, `RemoteSettings` struct does NOT have `isPublic`.
            // The `SettingsResponse` class comments say "economy and meta are ignored by the mod currently".
            // THIS IS THE MISSING PIECE! 
            
            // The server sends: { meta: { isPublic: boolean } } inside the JSON but `SettingsResponse` class ignores it?
            // Wait, let's check `SettingsResponse` class in `PlayerStorytellerMod.cs`.
            
            /*
            [Serializable]
            public class SettingsResponse
            {
                public RemoteSettings settings;
                // economy and meta are ignored by the mod currently
            }
            */
            
            // I need to add `public RemoteMeta meta;` to `SettingsResponse` and handle it! 
            
            settings.enableLiveScreen = remote.enableLiveScreen;
            if (remote.maxActionsPerMinute > 0) settings.maxActionsPerMinute = remote.maxActionsPerMinute;

            // Apply Action Toggles
            if (remote.actions != null)
            {
                var a = remote.actions;
                settings.enableHealColonist = a.heal_colonist;
                settings.enableHealAll = a.heal_all;
                settings.enableInspireColonist = a.inspire_colonist;
                settings.enableInspireAll = a.inspire_all;
                settings.enableSendWanderer = a.send_wanderer;
                settings.enableSendRefugee = a.send_refugee;

                settings.enableDropFood = a.drop_food;
                settings.enableDropMedicine = a.drop_medicine;
                settings.enableDropSteel = a.drop_steel;
                settings.enableDropComponents = a.drop_components;
                settings.enableDropSilver = a.drop_silver;
                settings.enableLegendary = a.send_legendary;
                settings.enableSendTrader = a.send_trader;

                settings.enableTameAnimal = a.tame_animal;
                settings.enableSpawnAnimal = a.spawn_animal;
                settings.enableGoodEvent = a.good_event;
                settings.enablePsychicSoothe = a.psychic_soothe;
                settings.enableAmbrosiaSprout = a.ambrosia_sprout;
                settings.enableFarmAnimalsWanderIn = a.farm_animals_wander_in;
                settings.enableThrumboPasses = a.thrumbo_passes;
                settings.enableAurora = a.aurora;
                settings.enableHerdMigration = a.herd_migration;
                settings.enableWildManWandersIn = a.wild_man_wanders_in;

                settings.enableWeatherClear = a.weather_clear;
                settings.enableWeatherRain = a.weather_rain;
                settings.enableWeatherFog = a.weather_fog;
                settings.enableWeatherSnow = a.weather_snow;
                settings.enableWeatherThunderstorm = a.weather_thunderstorm;
                settings.enableVolcanicWinter = a.volcanic_winter;

                settings.enableRaid = a.raid;
                settings.enableManhunter = a.manhunter;
                settings.enableMadAnimal = a.mad_animal;
                settings.enableSolarFlare = a.solar_flare;
                settings.enableEclipse = a.eclipse;
                settings.enableToxicFallout = a.toxic_fallout;
                settings.enableFlashstorm = a.flashstorm;
                settings.enableMeteor = a.meteor;
                settings.enableTornado = a.tornado;
                settings.enableLightning = a.lightning;
                settings.enableRandomEvent = a.random_event;
                settings.enableRansomDemand = a.ransom_demand;
                settings.enableInfestation = a.infestation;
                settings.enableMechShip = a.mech_ship;
                settings.enablePsychicDrone = a.psychic_drone;
                settings.enableShortCircuit = a.short_circuit;
                settings.enableCropBlight = a.crop_blight;
                settings.enableAlphabeavers = a.alphabeavers;

                settings.enableSendLetter = a.send_letter;
                settings.enablePing = a.ping;
            }
            
            // Note: We don't write to disk here to avoid spamming I/O.
            // Settings are applied in-memory and persist on the server side.
        }
    }

    [Serializable]
    public class SettingsResponse
    {
        public RemoteSettings settings;
        public RemoteMeta meta;
    }

    [Serializable]
    public class RemoteMeta
    {
        public bool isPublic;
        public bool hasPassword;
    }

    [Serializable]
    public class RemoteSettings
    {
        public float fastDataInterval;
        public float slowDataInterval;
        public float staticDataInterval;
        public bool enableLiveScreen;
        public int maxActionsPerMinute;
        public RemoteActionToggles actions;
    }

    [Serializable]
    public class RemoteActionToggles
    {
        public bool heal_colonist;
        public bool heal_all;
        public bool inspire_colonist;
        public bool inspire_all;
        public bool send_wanderer;
        public bool send_refugee;
        
        public bool drop_food;
        public bool drop_medicine;
        public bool drop_steel;
        public bool drop_components;
        public bool drop_silver;
        public bool send_legendary;
        public bool send_trader;
        
        public bool tame_animal;
        public bool spawn_animal;
        public bool good_event;
        
        public bool weather_clear;
        public bool weather_rain;
        public bool weather_fog;
        public bool weather_snow;
        public bool weather_thunderstorm;
        
        public bool raid;
        public bool manhunter;
        public bool mad_animal;
        public bool solar_flare;
        public bool eclipse;
        public bool toxic_fallout;
        public bool flashstorm;
        public bool meteor;
        public bool tornado;
        public bool lightning;
        public bool random_event;
        
        public bool send_letter;
        public bool ping;

        // New Actions
        public bool psychic_soothe;
        public bool ambrosia_sprout;
        public bool farm_animals_wander_in;
        public bool thrumbo_passes;
        public bool aurora;
        public bool herd_migration;
        public bool wild_man_wanders_in;
        public bool ransom_demand;
        public bool infestation;
        public bool mech_ship;
        public bool psychic_drone;
        public bool volcanic_winter;
        public bool short_circuit;
        public bool crop_blight;
        public bool alphabeavers;
    }

    [Serializable]
    public class PlayerAction
    {
        public string action;
        public string data;
        public string timestamp;
    }

    [Serializable]
    public class ActionsResponse
    {
        public bool success;
        public List<PlayerAction> actions;
    }

    [Serializable]
    public class UpdatePayload
    {
        public string screenshot; // kept for compatibility but unused for images
        public string gameState; 
    }

    public class PlayerStorytellerSettings : ModSettings
    {
        // Tiered polling intervals for different data types
        public float fastDataInterval = 0.2f; // Increased to 0.2s (5Hz) for smooth tracking
        public float slowDataInterval = 8.0f;
        public float staticDataInterval = 45.0f;

        public bool enableLiveScreen = true;
        public bool enableMapRender = false;

        // Stream privacy settings
        public bool isPublicStream = true;
        public string privateStreamId = "";
        public string secretKey = "";
        public string interactionPassword = "";
        public bool showSecretKey = false;

        // Internal encrypted storage (not exposed to user)
        private string encryptedSecretKey = "";
        private string encryptedInteractionPassword = "";         
        
        // Server Configuration
        public string serverUrl = "https://ratlab.online";

        // Streaming Quality
        public string streamingQuality = "low";

        // Development mode
        public bool devMode = false;               

        // Privacy consent
        public bool hasAcceptedPrivacyNotice = false;
        public bool hasCompletedSetupWizard = false;  

        // Action Controls
        public int maxActionsPerMinute = 30;       

        // Helpful Actions
        public bool enableHealColonist = true;
        public bool enableHealAll = true;
        public bool enableInspireColonist = true;
        public bool enableInspireAll = true;
        public bool enableSendWanderer = true;
        public bool enableSendRefugee = true;

        // Resources
        public bool enableDropFood = true;
        public bool enableDropMedicine = true;
        public bool enableDropSteel = true;
        public bool enableDropComponents = true;
        public bool enableDropSilver = true;
        public bool enableLegendary = true;
        public bool enableSendTrader = true;

        // Animals & Nature
        public bool enableTameAnimal = true;
        public bool enableSpawnAnimal = true;
        public bool enableGoodEvent = true;
        public bool enablePsychicSoothe = true;
        public bool enableAmbrosiaSprout = true;
        public bool enableFarmAnimalsWanderIn = true;
        public bool enableThrumboPasses = true;
        public bool enableAurora = true;
        public bool enableHerdMigration = true;
        public bool enableWildManWandersIn = true;

        // Weather
        public bool enableWeatherClear = true;
        public bool enableWeatherRain = true;
        public bool enableWeatherFog = true;
        public bool enableWeatherSnow = true;
        public bool enableWeatherThunderstorm = true;
        public bool enableVolcanicWinter = true;

        // Dangerous Events
        public bool enableRaid = true;
        public bool enableManhunter = true;
        public bool enableMadAnimal = true;
        public bool enableSolarFlare = true;
        public bool enableEclipse = true;
        public bool enableToxicFallout = true;
        public bool enableFlashstorm = true;
        public bool enableMeteor = true;
        public bool enableTornado = true;
        public bool enableLightning = true;
        public bool enableRandomEvent = true;
        public bool enableRansomDemand = true;
        public bool enableInfestation = true;
        public bool enableMechShip = true;
        public bool enablePsychicDrone = true;
        public bool enableShortCircuit = true;
        public bool enableCropBlight = true;
        public bool enableAlphabeavers = true;

        // Communication
        public bool enableSendLetter = true;
        public bool enablePing = true;

        public void EnableAllActions()
        {
            enableHealColonist = enableHealAll = enableInspireColonist = enableInspireAll = true;
            enableSendWanderer = enableSendRefugee = true;
            enableDropFood = enableDropMedicine = enableDropSteel = enableDropComponents = enableDropSilver = true;
            enableLegendary = enableSendTrader = true;
            enableTameAnimal = enableSpawnAnimal = enableGoodEvent = true;
            enableWeatherClear = enableWeatherRain = enableWeatherFog = enableWeatherSnow = enableWeatherThunderstorm = true;
            enableRaid = enableManhunter = enableMadAnimal = true;
            enableSolarFlare = enableEclipse = enableToxicFallout = enableFlashstorm = true;
            enableMeteor = enableTornado = enableLightning = enableRandomEvent = true;
            enableSendLetter = enablePing = true;

            enablePsychicSoothe = enableAmbrosiaSprout = enableFarmAnimalsWanderIn = enableThrumboPasses = true;
            enableAurora = enableHerdMigration = enableWildManWandersIn = true;
            enableRansomDemand = enableInfestation = enableMechShip = enablePsychicDrone = true;
            enableVolcanicWinter = enableShortCircuit = enableCropBlight = enableAlphabeavers = true;
        }

        public void DisableAllActions()
        {
            enableHealColonist = enableHealAll = enableInspireColonist = enableInspireAll = false;
            enableSendWanderer = enableSendRefugee = false;
            enableDropFood = enableDropMedicine = enableDropSteel = enableDropComponents = enableDropSilver = false;
            enableLegendary = enableSendTrader = false;
            enableTameAnimal = enableSpawnAnimal = enableGoodEvent = false;
            enableWeatherClear = enableWeatherRain = enableWeatherFog = enableWeatherSnow = enableWeatherThunderstorm = false;
            enableRaid = enableManhunter = enableMadAnimal = false;
            enableSolarFlare = enableEclipse = enableToxicFallout = enableFlashstorm = false;
            enableMeteor = enableTornado = enableLightning = enableRandomEvent = false;
            enableSendLetter = enablePing = false;

            enablePsychicSoothe = enableAmbrosiaSprout = enableFarmAnimalsWanderIn = enableThrumboPasses = false;
            enableAurora = enableHerdMigration = enableWildManWandersIn = false;
            enableRansomDemand = enableInfestation = enableMechShip = enablePsychicDrone = false;
            enableVolcanicWinter = enableShortCircuit = enableCropBlight = enableAlphabeavers = false;
        }

        /// <summary>
        /// Encrypts a string using Windows DPAPI (Data Protection API).
        /// Returns base64-encoded encrypted data.
        /// </summary>
        private static string EncryptString(string plainText)
        {
            if (string.IsNullOrEmpty(plainText))
                return "";

            try
            {
                byte[] plainBytes = Encoding.UTF8.GetBytes(plainText);
                byte[] encryptedBytes = ProtectedData.Protect(plainBytes, null, DataProtectionScope.CurrentUser);
                return Convert.ToBase64String(encryptedBytes);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Failed to encrypt data: {ex}");
                return plainText; // Fallback to plaintext if encryption fails
            }
        }

        /// <summary>
        /// Decrypts a base64-encoded DPAPI-encrypted string.
        /// Returns plaintext string.
        /// </summary>
        private static string DecryptString(string encryptedText)
        {
            if (string.IsNullOrEmpty(encryptedText))
                return "";

            try
            {
                byte[] encryptedBytes = Convert.FromBase64String(encryptedText);
                byte[] plainBytes = ProtectedData.Unprotect(encryptedBytes, null, DataProtectionScope.CurrentUser);
                return Encoding.UTF8.GetString(plainBytes);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Failed to decrypt data: {ex}");
                return ""; // Return empty on decryption failure
            }
        }

        public override void ExposeData()
        {
            Scribe_Values.Look(ref fastDataInterval, "fastDataInterval", 0.2f);
            Scribe_Values.Look(ref slowDataInterval, "slowDataInterval", 8.0f);
            Scribe_Values.Look(ref staticDataInterval, "staticDataInterval", 45.0f);

            Scribe_Values.Look(ref enableLiveScreen, "enableLiveScreen", true);
            Scribe_Values.Look(ref enableMapRender, "enableMapRender", false);
            Scribe_Values.Look(ref isPublicStream, "isPublicStream", true);
            Scribe_Values.Look(ref privateStreamId, "privateStreamId", "");
            Scribe_Values.Look(ref devMode, "devMode", false);
            Scribe_Values.Look(ref serverUrl, "serverUrl", "https://ratlab.online");
            Scribe_Values.Look(ref hasAcceptedPrivacyNotice, "hasAcceptedPrivacyNotice", false);
            Scribe_Values.Look(ref hasCompletedSetupWizard, "hasCompletedSetupWizard", false);
            Scribe_Values.Look(ref streamingQuality, "streamingQuality", "low");

            // Handle encryption/decryption of sensitive data
            if (Scribe.mode == LoadSaveMode.Saving)
            {
                // Encrypt secrets before saving
                encryptedSecretKey = EncryptString(secretKey);
                encryptedInteractionPassword = EncryptString(interactionPassword);

                Scribe_Values.Look(ref encryptedSecretKey, "encryptedSecretKey", "");
                Scribe_Values.Look(ref encryptedInteractionPassword, "encryptedInteractionPassword", "");
            }
            else if (Scribe.mode == LoadSaveMode.LoadingVars)
            {
                // Try loading encrypted values first
                Scribe_Values.Look(ref encryptedSecretKey, "encryptedSecretKey", "");
                Scribe_Values.Look(ref encryptedInteractionPassword, "encryptedInteractionPassword", "");

                // Migration: Check for old plaintext values
                string plaintextSecretKey = "";
                string plaintextInteractionPassword = "";
                Scribe_Values.Look(ref plaintextSecretKey, "secretKey", "");
                Scribe_Values.Look(ref plaintextInteractionPassword, "interactionPassword", "");

                // Decrypt or use migrated plaintext
                if (!string.IsNullOrEmpty(encryptedSecretKey))
                {
                    secretKey = DecryptString(encryptedSecretKey);
                }
                else if (!string.IsNullOrEmpty(plaintextSecretKey))
                {
                    // Migrate from plaintext
                    secretKey = plaintextSecretKey;
                    Log.Message("[Player Storyteller] Migrating secret key to encrypted storage.");
                }

                if (!string.IsNullOrEmpty(encryptedInteractionPassword))
                {
                    interactionPassword = DecryptString(encryptedInteractionPassword);
                }
                else if (!string.IsNullOrEmpty(plaintextInteractionPassword))
                {
                    // Migrate from plaintext
                    interactionPassword = plaintextInteractionPassword;
                    Log.Message("[Player Storyteller] Migrating interaction password to encrypted storage.");
                }
            }

            // Action Controls
            Scribe_Values.Look(ref maxActionsPerMinute, "maxActionsPerMinute", 30);

            // Helpful Actions
            Scribe_Values.Look(ref enableHealColonist, "enableHealColonist", true);
            Scribe_Values.Look(ref enableHealAll, "enableHealAll", true);
            Scribe_Values.Look(ref enableInspireColonist, "enableInspireColonist", true);
            Scribe_Values.Look(ref enableInspireAll, "enableInspireAll", true);
            Scribe_Values.Look(ref enableSendWanderer, "enableSendWanderer", true);
            Scribe_Values.Look(ref enableSendRefugee, "enableSendRefugee", true);

            // Resources
            Scribe_Values.Look(ref enableDropFood, "enableDropFood", true);
            Scribe_Values.Look(ref enableDropMedicine, "enableDropMedicine", true);
            Scribe_Values.Look(ref enableDropSteel, "enableDropSteel", true);
            Scribe_Values.Look(ref enableDropComponents, "enableDropComponents", true);
            Scribe_Values.Look(ref enableDropSilver, "enableDropSilver", true);
            Scribe_Values.Look(ref enableLegendary, "enableLegendary", true);
            Scribe_Values.Look(ref enableSendTrader, "enableSendTrader", true);

            // Animals & Nature
            Scribe_Values.Look(ref enableTameAnimal, "enableTameAnimal", true);
            Scribe_Values.Look(ref enableSpawnAnimal, "enableSpawnAnimal", true);
            Scribe_Values.Look(ref enableGoodEvent, "enableGoodEvent", true);
            Scribe_Values.Look(ref enablePsychicSoothe, "enablePsychicSoothe", true);
            Scribe_Values.Look(ref enableAmbrosiaSprout, "enableAmbrosiaSprout", true);
            Scribe_Values.Look(ref enableFarmAnimalsWanderIn, "enableFarmAnimalsWanderIn", true);
            Scribe_Values.Look(ref enableThrumboPasses, "enableThrumboPasses", true);
            Scribe_Values.Look(ref enableAurora, "enableAurora", true);
            Scribe_Values.Look(ref enableHerdMigration, "enableHerdMigration", true);
            Scribe_Values.Look(ref enableWildManWandersIn, "enableWildManWandersIn", true);

            // Weather
            Scribe_Values.Look(ref enableWeatherClear, "enableWeatherClear", true);
            Scribe_Values.Look(ref enableWeatherRain, "enableWeatherRain", true);
            Scribe_Values.Look(ref enableWeatherFog, "enableWeatherFog", true);
            Scribe_Values.Look(ref enableWeatherSnow, "enableWeatherSnow", true);
            Scribe_Values.Look(ref enableWeatherThunderstorm, "enableWeatherThunderstorm", true);
            Scribe_Values.Look(ref enableVolcanicWinter, "enableVolcanicWinter", true);

            // Dangerous Events
            Scribe_Values.Look(ref enableRaid, "enableRaid", true);
            Scribe_Values.Look(ref enableManhunter, "enableManhunter", true);
            Scribe_Values.Look(ref enableMadAnimal, "enableMadAnimal", true);
            Scribe_Values.Look(ref enableSolarFlare, "enableSolarFlare", true);
            Scribe_Values.Look(ref enableEclipse, "enableEclipse", true);
            Scribe_Values.Look(ref enableToxicFallout, "enableToxicFallout", true);
            Scribe_Values.Look(ref enableFlashstorm, "enableFlashstorm", true);
            Scribe_Values.Look(ref enableMeteor, "enableMeteor", true);
            Scribe_Values.Look(ref enableTornado, "enableTornado", true);
            Scribe_Values.Look(ref enableLightning, "enableLightning", true);
            Scribe_Values.Look(ref enableRandomEvent, "enableRandomEvent", true);
            Scribe_Values.Look(ref enableRansomDemand, "enableRansomDemand", true);
            Scribe_Values.Look(ref enableInfestation, "enableInfestation", true);
            Scribe_Values.Look(ref enableMechShip, "enableMechShip", true);
            Scribe_Values.Look(ref enablePsychicDrone, "enablePsychicDrone", true);
            Scribe_Values.Look(ref enableShortCircuit, "enableShortCircuit", true);
            Scribe_Values.Look(ref enableCropBlight, "enableCropBlight", true);
            Scribe_Values.Look(ref enableAlphabeavers, "enableAlphabeavers", true);

            // Communication
            Scribe_Values.Look(ref enableSendLetter, "enableSendLetter", true);
            Scribe_Values.Look(ref enablePing, "enablePing", true);

            base.ExposeData();
        }
    }
}
