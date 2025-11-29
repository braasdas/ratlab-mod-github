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

namespace PlayerStoryteller
{
    public class PlayerStorytellerMod : Mod
    {
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
            settings = GetSettings<PlayerStorytellerSettings>();
            httpClient = new HttpClient();

            Log.Message("[Player Storyteller] Mod initialized");
        }

        public override string SettingsCategory()
        {
            return "Player Storyteller";
        }

        private bool isRunningSpeedTest = false;
        private Vector2 scrollPosition = Vector2.zero;
        private static readonly float SettingsHeight = 2800f; // Increased for all action controls
        private static bool hasShownPrivacyNotice = false; // Track if we've already shown the dialog

        public override void DoSettingsWindowContents(Rect inRect)
        {
            // PRIVACY NOTICE: Show on first run (only once per session)
            if (!settings.hasAcceptedPrivacyNotice && !hasShownPrivacyNotice)
            {
                hasShownPrivacyNotice = true;
                ShowPrivacyNoticeDialog();
            }

            // Create scrollable view
            Rect viewRect = new Rect(0f, 0f, inRect.width - 20f, SettingsHeight);
            Widgets.BeginScrollView(inRect, ref scrollPosition, viewRect);

            Listing_Standard listingStandard = new Listing_Standard();
            listingStandard.Begin(viewRect);

            // Development Mode Section
            Text.Font = GameFont.Medium;
            listingStandard.Label("Development Mode");
            Text.Font = GameFont.Small;

            listingStandard.CheckboxLabeled("Dev Mode (Use localhost:3000 instead of production server)", ref settings.devMode);

            if (settings.devMode)
            {
                Text.Font = GameFont.Tiny;
                GUI.color = new Color(1f, 0.5f, 0f);
                listingStandard.Label("WARNING: Server will connect to http://localhost:3000");
                GUI.color = Color.white;
                Text.Font = GameFont.Small;
            }

            listingStandard.Gap(12f);

            // Stream Privacy Section
            Text.Font = GameFont.Medium;
            listingStandard.Label("Stream Privacy & Security");
            Text.Font = GameFont.Small;

            listingStandard.CheckboxLabeled("Enable Live Screen Streaming", ref settings.enableLiveScreen);
            Text.Font = GameFont.Tiny;
            listingStandard.Label("If disabled, viewers will see a 'Stream Disabled' message instead of the live game view.");
            Text.Font = GameFont.Small;

            listingStandard.Gap(6f);

            // Generate Secret Key if missing
            if (string.IsNullOrEmpty(settings.secretKey))
            {
                settings.secretKey = GeneratePrivateStreamId(); // Reuse the random string generator
                settings.Write();
            }

            // Display Stream Key (Masked)
            listingStandard.Label("Stream Key (SECRET - Do not share):");
            string keyDisplay = settings.showSecretKey ? settings.secretKey : new string('•', settings.secretKey.Length);
            
            Rect keyRect = listingStandard.GetRect(30f);
            Rect keyTextRect = new Rect(keyRect.x, keyRect.y, keyRect.width - 120f, keyRect.height);
            Rect keyBtnRect = new Rect(keyRect.width - 110f, keyRect.y, 110f, keyRect.height);

            Widgets.Label(keyTextRect, keyDisplay);
            if (Widgets.ButtonText(keyBtnRect, settings.showSecretKey ? "Hide" : "Show"))
            {
                settings.showSecretKey = !settings.showSecretKey;
            }

            listingStandard.Gap(6f);
            
            // Interaction Password
            listingStandard.Label("Interaction Password (Optional):");
            settings.interactionPassword = listingStandard.TextEntry(settings.interactionPassword);
            Text.Font = GameFont.Tiny;
            listingStandard.Label("If set, viewers must enter this password to interact with your colony.");
            Text.Font = GameFont.Small;

            listingStandard.Gap(12f);

            listingStandard.CheckboxLabeled("Public Stream (anyone can discover)", ref settings.isPublicStream);

            if (!settings.isPublicStream)
            {
                // Generate private stream ID if not set
                if (string.IsNullOrEmpty(settings.privateStreamId))
                {
                    settings.privateStreamId = GeneratePrivateStreamId();
                    settings.Write();
                }

                Text.Font = GameFont.Tiny;
                listingStandard.Label($"Private Session ID: {settings.privateStreamId}");
                Text.Font = GameFont.Small;

                string serverUrl = GetServerUrl();
                string privateLink = $"{serverUrl}/?session={Uri.EscapeDataString(settings.privateStreamId)}";

                if (listingStandard.ButtonText("Copy Invite Link to Clipboard"))
                {
                    GUIUtility.systemCopyBuffer = privateLink;
                    Messages.Message("Invite link copied to clipboard!", MessageTypeDefOf.PositiveEvent);
                }

                Text.Font = GameFont.Tiny;
                listingStandard.Label("Share this link with viewers to give them access to your private stream.");
                Text.Font = GameFont.Small;
            }
            else
            {
                Text.Font = GameFont.Tiny;
                listingStandard.Label("Your stream will appear in the public session list for anyone to view.");
                Text.Font = GameFont.Small;
            }

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

            // Screenshot update interval slider with current FPS display
            float fps = 1f / settings.updateInterval;
            listingStandard.Label($"Screenshot Update Interval: {settings.updateInterval:F2}s (~{fps:F1} FPS)");
            settings.updateInterval = listingStandard.Slider(settings.updateInterval, 0.03f, 5f);
            if (settings.updateInterval < 0.04f)
            {
                listingStandard.Label("Warning: Very low update intervals (high FPS) may cause stutters or performance issues.");
            }

            listingStandard.Gap(12f);

            // Section header for data polling
            Text.Font = GameFont.Medium;
            listingStandard.Label("Data Polling Intervals:");
            Text.Font = GameFont.Small;

            // Fast data polling (colonists)
            listingStandard.Label($"Fast Data (Colonists): {settings.fastDataInterval:F1}s");
            settings.fastDataInterval = listingStandard.Slider(settings.fastDataInterval, 0.5f, 10f);

            // Slow data polling (resources, power, creatures)
            listingStandard.Label($"Slow Data (Resources, Power, Creatures): {settings.slowDataInterval:F1}s");
            settings.slowDataInterval = listingStandard.Slider(settings.slowDataInterval, 1f, 30f);

            // Static data polling (factions, research)
            listingStandard.Label($"Static Data (Factions, Research): {settings.staticDataInterval:F0}s");
            settings.staticDataInterval = listingStandard.Slider(settings.staticDataInterval, 10f, 120f);

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

            listingStandard.Gap(24f);

            // ===== ACTION CONTROLS SECTION =====
            Text.Font = GameFont.Medium;
            listingStandard.Label("Action Controls");
            Text.Font = GameFont.Small;

            listingStandard.Gap(12f);

            // Rate limiting
            Text.Font = GameFont.Small;
            listingStandard.Label($"Max Actions per Minute: {settings.maxActionsPerMinute}");
            settings.maxActionsPerMinute = (int)listingStandard.Slider(settings.maxActionsPerMinute, 1f, 100f);

            Text.Font = GameFont.Tiny;
            listingStandard.Label("Limits how many viewer actions can be executed per minute. Prevents spam.");
            Text.Font = GameFont.Small;

            listingStandard.Gap(12f);

            // Quick toggle all buttons
            if (listingStandard.ButtonText("Enable All Actions"))
            {
                settings.EnableAllActions();
            }
            if (listingStandard.ButtonText("Disable All Actions"))
            {
                settings.DisableAllActions();
            }

            listingStandard.Gap(12f);

            // Helpful Actions
            Text.Font = GameFont.Medium;
            listingStandard.Label("Helpful Actions");
            Text.Font = GameFont.Small;

            listingStandard.CheckboxLabeled("Heal Colonist", ref settings.enableHealColonist);
            listingStandard.CheckboxLabeled("Heal All", ref settings.enableHealAll);
            listingStandard.CheckboxLabeled("Inspire Colonist", ref settings.enableInspireColonist);
            listingStandard.CheckboxLabeled("Inspire All", ref settings.enableInspireAll);
            listingStandard.CheckboxLabeled("Send Wanderer", ref settings.enableSendWanderer);
            listingStandard.CheckboxLabeled("Send Refugee", ref settings.enableSendRefugee);

            listingStandard.Gap(12f);

            // Resources
            Text.Font = GameFont.Medium;
            listingStandard.Label("Resource Drops");
            Text.Font = GameFont.Small;

            listingStandard.CheckboxLabeled("Drop Food", ref settings.enableDropFood);
            listingStandard.CheckboxLabeled("Drop Medicine", ref settings.enableDropMedicine);
            listingStandard.CheckboxLabeled("Drop Steel", ref settings.enableDropSteel);
            listingStandard.CheckboxLabeled("Drop Components", ref settings.enableDropComponents);
            listingStandard.CheckboxLabeled("Drop Silver", ref settings.enableDropSilver);
            listingStandard.CheckboxLabeled("Send Legendary Item", ref settings.enableLegendary);
            listingStandard.CheckboxLabeled("Send Trader", ref settings.enableSendTrader);

            listingStandard.Gap(12f);

            // Animals & Nature
            Text.Font = GameFont.Medium;
            listingStandard.Label("Animals & Nature");
            Text.Font = GameFont.Small;

            listingStandard.CheckboxLabeled("Tame Animal", ref settings.enableTameAnimal);
            listingStandard.CheckboxLabeled("Spawn Animal", ref settings.enableSpawnAnimal);
            listingStandard.CheckboxLabeled("Good Event", ref settings.enableGoodEvent);

            listingStandard.Gap(12f);

            // Weather Controls
            Text.Font = GameFont.Medium;
            listingStandard.Label("Weather Controls");
            Text.Font = GameFont.Small;

            listingStandard.CheckboxLabeled("Clear Weather", ref settings.enableWeatherClear);
            listingStandard.CheckboxLabeled("Rain", ref settings.enableWeatherRain);
            listingStandard.CheckboxLabeled("Fog", ref settings.enableWeatherFog);
            listingStandard.CheckboxLabeled("Snow", ref settings.enableWeatherSnow);
            listingStandard.CheckboxLabeled("Thunderstorm", ref settings.enableWeatherThunderstorm);

            listingStandard.Gap(12f);

            // Dangerous Events
            Text.Font = GameFont.Medium;
            GUI.color = new Color(1f, 0.5f, 0.5f);
            listingStandard.Label("Dangerous Events");
            GUI.color = Color.white;
            Text.Font = GameFont.Small;

            listingStandard.CheckboxLabeled("Raid", ref settings.enableRaid);
            listingStandard.CheckboxLabeled("Manhunter Pack", ref settings.enableManhunter);
            listingStandard.CheckboxLabeled("Mad Animal", ref settings.enableMadAnimal);
            listingStandard.CheckboxLabeled("Solar Flare", ref settings.enableSolarFlare);
            listingStandard.CheckboxLabeled("Eclipse", ref settings.enableEclipse);
            listingStandard.CheckboxLabeled("Toxic Fallout", ref settings.enableToxicFallout);
            listingStandard.CheckboxLabeled("Flashstorm", ref settings.enableFlashstorm);
            listingStandard.CheckboxLabeled("Meteor", ref settings.enableMeteor);
            listingStandard.CheckboxLabeled("Tornado", ref settings.enableTornado);
            listingStandard.CheckboxLabeled("Lightning Strike", ref settings.enableLightning);
            listingStandard.CheckboxLabeled("Random Event", ref settings.enableRandomEvent);

            listingStandard.Gap(12f);

            // Communication
            Text.Font = GameFont.Medium;
            listingStandard.Label("Communication");
            Text.Font = GameFont.Small;

            listingStandard.CheckboxLabeled("Send Letter (Messages)", ref settings.enableSendLetter);
            listingStandard.CheckboxLabeled("Ping (Map markers)", ref settings.enablePing);

            listingStandard.End();

            // Close scroll view
            Widgets.EndScrollView();

            base.DoSettingsWindowContents(inRect);

            // Run automatic speed test on first open
            if (!settings.hasRunInitialSpeedTest && !isRunningSpeedTest)
            {
                settings.hasRunInitialSpeedTest = true;
                RunSpeedTestAsync();
            }
        }

        private static string GetServerUrl()
        {
            // Dev mode: use localhost
            if (settings.devMode)
            {
                return "http://localhost:3000";
            }

            // Production: Decodes "http://75.127.14.105:9090"
            byte[] data = Convert.FromBase64String("aHR0cHM6Ly9yYXRsYWIub25saW5lLw==");
            return Encoding.UTF8.GetString(data).TrimEnd('/');
        }

        private async void RunSpeedTestAsync()
        {
            isRunningSpeedTest = true;

            try
            {
                var result = await NetworkSpeedTest.RunSpeedTest(GetServerUrl());

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

        private void ShowPrivacyNoticeDialog()
        {
            Find.WindowStack.Add(new Dialog_MessageBox(
                "PRIVACY NOTICE\n\n" +
                "This mod transmits data to an external server:\n\n" +
                "• Live screenshots of your game\n" +
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
                    Messages.Message("Privacy notice accepted. Configure settings below.", MessageTypeDefOf.PositiveEvent);
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
                        Log.Message($"[Player Storyteller] {logIdentifier} sent successfully.");
                        return true;
                    }
                    else
                    {
                        Log.Warning($"[Player Storyteller] Failed to send {logIdentifier}: {response.StatusCode}. Retry {i + 1}/{MaxRetries}...");
                    }
                }
                catch (Exception ex)
                {
                    Log.Warning($"[Player Storyteller] Error sending {logIdentifier}: {ex.Message}. Retry {i + 1}/{MaxRetries}...");
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
                Log.Message("[Player Storyteller] Connection reset. Resuming mod operation.");
            }
        }

        private static void ShowConnectionFailureDialog()
        {
            Find.WindowStack.Add(new Dialog_MessageBox(
                "PLAYER STORYTELLER - CONNECTION FAILED\n\n" +
                "The mod has failed to connect to the Player Storyteller server after 3 attempts.\n\n" +
                "Possible causes:\n" +
                "• Server is currently offline or unreachable\n" +
                "• Your internet connection is down\n" +
                "• Firewall blocking outgoing connections\n" +
                "• Server maintenance in progress\n\n" +
                "The mod has been paused to prevent spam.\n\n" +
                "To resume:\n" +
                "1. Check your internet connection\n" +
                "2. Save your game\n" +
                "3. Reload the save file\n\n" +
                "The mod will automatically attempt to reconnect when you reload.",
                "OK",
                delegate {
                    Log.Message("[Player Storyteller] User acknowledged connection failure.");
                },
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
                        // Reset failure counter on success
                        consecutiveFailures = 0;
                    }
                    else
                    {
                        // Increment failure counter
                        consecutiveFailures++;
                        Log.Warning($"[Player Storyteller] Connection failure #{consecutiveFailures}/3");

                        if (consecutiveFailures >= 3 && !connectionPaused)
                        {
                            connectionPaused = true;
                            Log.Error("[Player Storyteller] Connection paused after 3 consecutive failures.");
                            ShowConnectionFailureDialog();
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in SendUpdateToServerAsync: {ex.Message}");

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
            // Generate a unique 12-character ID (alphanumeric, easy to share)
            const string chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
            var random = new System.Random();
            return new string(Enumerable.Repeat(chars, 12)
                .Select(s => s[random.Next(s.Length)]).ToArray());
        }

        private static string GetSessionId()
        {
            // If private stream, use the unique private ID
            if (!settings.isPublicStream)
            {
                if (string.IsNullOrEmpty(settings.privateStreamId))
                {
                    settings.privateStreamId = GeneratePrivateStreamId();
                    settings.Write();
                }
                return settings.privateStreamId;
            }

            // Public stream: use the world seed as session identifier
            if (Current.Game != null && Current.Game.World != null)
            {
                return Current.Game.World.info.seedString;
            }
            return "default-session";
        }

        public static async Task<List<PlayerAction>> GetPlayerActionsAsync()
        {
            try
            {
                string sessionId = GetSessionId();
                // CRITICAL FIX: Encode the session ID to handle spaces in seeds
                string encodedSessionId = Uri.EscapeDataString(sessionId);
                string serverUrl = GetServerUrl();
                string url = $"{serverUrl}/api/actions/{encodedSessionId}";
                Log.Message($"[Player Storyteller] Polling for actions at URL: {url}"); // Added logging

                var response = await httpClient.GetAsync(url);

                if (response.IsSuccessStatusCode)
                {
                    string json = await response.Content.ReadAsStringAsync();
                    Log.Message($"[Player Storyteller] Received JSON response: {json}");

                    // Manual JSON parsing since Unity's JsonUtility is unreliable
                    var actions = new List<PlayerAction>();

                    try
                    {
                        // Extract the actions array from the response
                        var actionsMatch = System.Text.RegularExpressions.Regex.Match(json, @"""actions""\s*:\s*\[(.*?)\](?=\s*[,}])");
                        if (actionsMatch.Success)
                        {
                            string actionsArrayContent = actionsMatch.Groups[1].Value;

                            // Split into individual action objects
                            // Use a more robust pattern that handles nested JSON in data field
                            // This pattern matches { ... } while properly handling escaped quotes and nested braces
                            var actionMatches = System.Text.RegularExpressions.Regex.Matches(actionsArrayContent, @"\{(?:[^{}""\\]|""(?:[^""\\]|\\.)*""|\\.|(?<open>\{)|(?<-open>\}))+(?(open)(?!))\}");

                            foreach (System.Text.RegularExpressions.Match actionMatch in actionMatches)
                            {
                                string actionJson = actionMatch.Value;
                                Log.Message($"[Player Storyteller] Raw action JSON: {actionJson}");

                                // Extract action field
                                var actionFieldMatch = System.Text.RegularExpressions.Regex.Match(actionJson, @"""action""\s*:\s*""([^""]+)""");

                                // Extract data field - handle escaped quotes properly
                                // This regex matches everything between quotes, including escaped quotes (\")
                                var dataFieldMatch = System.Text.RegularExpressions.Regex.Match(actionJson, @"""data""\s*:\s*""((?:[^""\\]|\\.)*)""");

                                if (actionFieldMatch.Success)
                                {
                                    string dataValue = dataFieldMatch.Success ? dataFieldMatch.Groups[1].Value : "";

                                    Log.Message($"[Player Storyteller] Data field match success: {dataFieldMatch.Success}");
                                    Log.Message($"[Player Storyteller] Data value: '{dataValue}'");

                                    var action = new PlayerAction
                                    {
                                        action = actionFieldMatch.Groups[1].Value,
                                        data = dataValue,
                                        timestamp = ""
                                    };
                                    actions.Add(action);

                                    Log.Message($"[Player Storyteller] Parsed action: {action.action}, data length: {dataValue.Length}");
                                }
                            }

                            if (actions.Count > 0)
                            {
                                Log.Message($"[Player Storyteller] Parsed {actions.Count} player actions.");
                            }

                            return actions;
                        }
                        else
                        {
                            Log.Warning($"[Player Storyteller] Could not find 'actions' array in response.");
                        }
                    }
                    catch (Exception parseEx)
                    {
                        Log.Error($"[Player Storyteller] Error parsing actions JSON: {parseEx.Message}");
                    }
                }
                else
                {
                    Log.Warning($"[Player Storyteller] Failed to get player actions: {response.StatusCode}");
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error getting player actions: {ex.Message}");
            }

            return new List<PlayerAction>();
        }
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
        public string screenshot; // base64 string
        public string gameState; // JSON string
    }

    public class PlayerStorytellerSettings : ModSettings
    {
        public float updateInterval = 1.0f;        // PERFORMANCE: Default to 1 FPS (was 0.5s)

        // Tiered polling intervals for different data types
        public float fastDataInterval = 2.0f;      // Colonists - PERFORMANCE: 2s (was 1.5s)
        public float slowDataInterval = 8.0f;      // Resources, power, creatures - PERFORMANCE: 8s (was 5s)
        public float staticDataInterval = 45.0f;   // Factions, research - PERFORMANCE: 45s (was 30s)

        public float resolutionScale = 0.6f;       // PERFORMANCE: 0.6x (was 0.75x)
        public int screenshotQuality = 70;         // PERFORMANCE: 70% (was 85%)
        public double lastSpeedTestBandwidth = 0.0;
        public string lastSpeedTestTime = "";
        public bool hasRunInitialSpeedTest = false;
        public string networkQuality = "medium"; // high, medium-high, medium, low-medium, low
        public bool enableLiveScreen = true;

        // Stream privacy settings
        public bool isPublicStream = true;         // Public by default (anyone can discover)
        public string privateStreamId = "";        // Unique ID for private streams
        public string secretKey = "";              // Authentication key for the streamer
        public string interactionPassword = "";    // Optional password for viewer interactions
        public bool showSecretKey = false;         // UI toggle, not saved

        // Development mode
        public bool devMode = false;               // Use localhost instead of production server

        // Privacy consent
        public bool hasAcceptedPrivacyNotice = false;  // First-run privacy notice

        // Action Controls
        public int maxActionsPerMinute = 30;       // Rate limit for viewer actions

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

        // Weather
        public bool enableWeatherClear = true;
        public bool enableWeatherRain = true;
        public bool enableWeatherFog = true;
        public bool enableWeatherSnow = true;
        public bool enableWeatherThunderstorm = true;

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

        // Communication
        public bool enableSendLetter = true;
        public bool enablePing = true;

        // Helper methods
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
        }

        public override void ExposeData()
        {
            Scribe_Values.Look(ref updateInterval, "updateInterval", 1.0f);
            Scribe_Values.Look(ref fastDataInterval, "fastDataInterval", 2.0f);
            Scribe_Values.Look(ref slowDataInterval, "slowDataInterval", 8.0f);
            Scribe_Values.Look(ref staticDataInterval, "staticDataInterval", 45.0f);
            Scribe_Values.Look(ref resolutionScale, "resolutionScale", 0.6f);
            Scribe_Values.Look(ref screenshotQuality, "screenshotQuality", 70);
            Scribe_Values.Look(ref lastSpeedTestBandwidth, "lastSpeedTestBandwidth", 0.0);
            Scribe_Values.Look(ref lastSpeedTestTime, "lastSpeedTestTime", "");
            Scribe_Values.Look(ref hasRunInitialSpeedTest, "hasRunInitialSpeedTest", false);
            Scribe_Values.Look(ref networkQuality, "networkQuality", "medium");
            Scribe_Values.Look(ref enableLiveScreen, "enableLiveScreen", true);
            Scribe_Values.Look(ref isPublicStream, "isPublicStream", true);
            Scribe_Values.Look(ref privateStreamId, "privateStreamId", "");
            Scribe_Values.Look(ref secretKey, "secretKey", "");
            Scribe_Values.Look(ref interactionPassword, "interactionPassword", "");
            Scribe_Values.Look(ref devMode, "devMode", false);
            Scribe_Values.Look(ref hasAcceptedPrivacyNotice, "hasAcceptedPrivacyNotice", false);

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

            // Weather
            Scribe_Values.Look(ref enableWeatherClear, "enableWeatherClear", true);
            Scribe_Values.Look(ref enableWeatherRain, "enableWeatherRain", true);
            Scribe_Values.Look(ref enableWeatherFog, "enableWeatherFog", true);
            Scribe_Values.Look(ref enableWeatherSnow, "enableWeatherSnow", true);
            Scribe_Values.Look(ref enableWeatherThunderstorm, "enableWeatherThunderstorm", true);

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

            // Communication
            Scribe_Values.Look(ref enableSendLetter, "enableSendLetter", true);
            Scribe_Values.Look(ref enablePing, "enablePing", true);

            base.ExposeData();
        }
    }
}
