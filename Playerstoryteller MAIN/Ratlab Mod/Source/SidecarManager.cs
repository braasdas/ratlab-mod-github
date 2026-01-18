using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Text.RegularExpressions;
using Verse;
using RimWorld;

namespace PlayerStoryteller
{
    /// <summary>
    /// Status message from sidecar
    /// </summary>
    public class StatusMessage
    {
        public string type;
        public string message;
        public string level;
    }

    /// <summary>
    /// Manages the external "Sidecar" process (Go) for WebRTC streaming.
    /// WINDOW CAPTURE MODE: The sidecar captures the RimWorld window directly (like OBS).
    /// This eliminates all capture overhead from the game process.
    /// The mod only needs to send JSON game state data.
    /// </summary>
    public class SidecarManager
    {
        private Process sidecarProcess;
        private bool isRunning = false;
        private DateTime lastStartAttempt = DateTime.MinValue;

        // Threading (only for output reading now)
        private CancellationTokenSource cancellationTokenSource;
        private Task outputReaderTask;

        // Notification queue (processed on main thread)
        private static ConcurrentQueue<StatusMessage> pendingNotifications = new ConcurrentQueue<StatusMessage>();
        private static bool driverWarningShown = false; // Show driver warning only once per session

        // Paths
        private string SidecarDirectory => Path.Combine(GenFilePaths.SaveDataFolderPath, "Sidecar"); 
        
        private string GetSidecarScriptPath()
        {
            // Try to find the mod directory
            var modContent = LoadedModManager.GetMod<PlayerStorytellerMod>().Content;
            // Look for 'go-sidecar/ratlab-sidecar.exe' (Rust version) in the mod root
            string path = Path.Combine(modContent.RootDir, "go-sidecar", "ratlab-sidecar.exe");
            return path;
        }

        /// <summary>
        /// Simple JSON parser for StatusMessage (avoids external dependencies)
        /// </summary>
        private static StatusMessage ParseStatusMessage(string json)
        {
            // Simple regex-based parsing for our known JSON structure
            var typeMatch = Regex.Match(json, "\"type\"\\s*:\\s*\"([^\"]*)\"");
            var messageMatch = Regex.Match(json, "\"message\"\\s*:\\s*\"([^\"]*)\"");
            var levelMatch = Regex.Match(json, "\"level\"\\s*:\\s*\"([^\"]*)\"");

            if (!typeMatch.Success || !messageMatch.Success || !levelMatch.Success)
                return null;

            return new StatusMessage
            {
                type = typeMatch.Groups[1].Value,
                message = messageMatch.Groups[1].Value,
                level = levelMatch.Groups[1].Value
            };
        }

        /// <summary>
        /// Call this on the main Unity thread to show any pending notifications
        /// </summary>
        public static void ProcessPendingNotifications()
        {
            while (pendingNotifications.TryDequeue(out StatusMessage notification))
            {
                // Don't spam driver warnings
                if (notification.type == "driver_warning")
                {
                    if (driverWarningShown) continue;
                    driverWarningShown = true;
                }

                MessageTypeDef messageType = MessageTypeDefOf.NeutralEvent;
                if (notification.level == "warning")
                {
                    messageType = MessageTypeDefOf.CautionInput;
                }
                else if (notification.level == "error")
                {
                    messageType = MessageTypeDefOf.RejectInput;
                }

                Messages.Message($"[Rat Lab] {notification.message}", messageType);
            }
        }

        public void EnsureRunning(string sessionId, string streamKey)
        {
            if (!isRunning || sidecarProcess == null || sidecarProcess.HasExited)
            {
                // Log.Warning("[PlayerStoryteller] Sidecar not running. Restarting...");
                isRunning = false;
                Start(sessionId, streamKey);
            }
        }

        public void Start(string sessionId, string streamKey)
        {
            // Double check process state
            if (sidecarProcess != null && !sidecarProcess.HasExited && isRunning)
            {
                return;
            }

            // Throttle restart attempts (max once per 5 seconds)
            if ((DateTime.Now - lastStartAttempt).TotalSeconds < 5) return;
            lastStartAttempt = DateTime.Now;

            try
            {
                Stop(); // Ensure clean slate

                string exePath = GetSidecarScriptPath();
                if (!File.Exists(exePath))
                {
                    Log.Error(string.Format("[PlayerStoryteller] Sidecar binary not found at: {0}", exePath));
                    return;
                }

                Log.Message(string.Format("[PlayerStoryteller] Starting Sidecar: {0}", exePath));

                string rimWorldPid = System.Diagnostics.Process.GetCurrentProcess().Id.ToString();

                // Get server URL and convert to WebSocket format
                string serverUrl = PlayerStorytellerMod.GetServerUrl();
                string wsUrl;
                
                // Force production traffic through the secure Nginx path
                if (serverUrl.Contains("ratlab.online")) 
                {
                    wsUrl = "wss://ratlab.online/stream";
                }
                else 
                {
                    // Keep localhost:3000 for local testing
                    wsUrl = serverUrl.Replace("https://", "wss://").Replace("http://", "ws://");
                    if (!wsUrl.EndsWith("/stream")) wsUrl = wsUrl.TrimEnd('/') + "/stream";
                }

                ProcessStartInfo startInfo = new ProcessStartInfo
                {
                    FileName = exePath,
                    Arguments = $"--url {wsUrl} --pid {rimWorldPid} --stream-key {streamKey} --session-id {sessionId} --quality {PlayerStorytellerMod.settings.streamingQuality}",
                    UseShellExecute = false,
                    RedirectStandardInput = false,  // Window capture mode doesn't need stdin
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                    WorkingDirectory = Path.GetDirectoryName(exePath)
                };

                sidecarProcess = new Process();
                sidecarProcess.StartInfo = startInfo;
                sidecarProcess.EnableRaisingEvents = true;
                sidecarProcess.Exited += (s, e) =>
                {
                    Log.Warning("[PlayerStoryteller] Sidecar process exited unexpectedly.");
                    isRunning = false;
                };

                sidecarProcess.Start();

                // Window capture mode - no stdin needed, but we still want to read status messages
                cancellationTokenSource = new CancellationTokenSource();
                outputReaderTask = Task.Run(() => ReadOutputLoop(sidecarProcess.StandardOutput, cancellationTokenSource.Token), cancellationTokenSource.Token);

                isRunning = true;
                Log.Message(string.Format("[PlayerStoryteller] Sidecar started in WINDOW CAPTURE mode (PID: {0})", sidecarProcess.Id));
            }
            catch (Exception ex)
            {
                Log.Error(string.Format("[PlayerStoryteller] Failed to start sidecar: {0}", ex));
                isRunning = false;
            }
        }

        private void ReadOutputLoop(StreamReader reader, CancellationToken token)
        {
            try
            {
                while (!token.IsCancellationRequested && isRunning)
                {
                    string line = reader.ReadLine();
                    if (line == null) break; // EOF

                    // Parse STATUS: messages from sidecar
                    if (line.StartsWith("STATUS:"))
                    {
                        try
                        {
                            string jsonPart = line.Substring(7); // Remove "STATUS:" prefix
                            StatusMessage msg = ParseStatusMessage(jsonPart);
                            if (msg != null)
                            {
                                pendingNotifications.Enqueue(msg);
                            }
                        }
                        catch (Exception ex)
                        {
                            Log.Warning("[PlayerStoryteller] Failed to parse sidecar status: " + ex.Message);
                        }
                    }
                }
            }
            catch (OperationCanceledException)
            {
                // Expected on Stop()
            }
            catch (Exception ex)
            {
                Log.Warning("[PlayerStoryteller] Sidecar output reader error: " + ex.Message);
            }
        }

        // WriteLoop removed - Window capture mode doesn't use stdin

        public void Stop()
        {
            // Stop output reader task
            if (cancellationTokenSource != null)
            {
                try { cancellationTokenSource.Cancel(); } catch {}
                cancellationTokenSource = null;
            }

            // Kill sidecar process
            try
            {
                if (sidecarProcess != null && !sidecarProcess.HasExited)
                {
                    sidecarProcess.Kill();
                    sidecarProcess.Dispose();
                }
            }
            catch (Exception ex)
            {
                Log.Warning(string.Format("[PlayerStoryteller] Error stopping sidecar: {0}", ex.Message));
            }
            finally
            {
                sidecarProcess = null;
                isRunning = false;
            }
        }

        public void SendFrame(byte[] dataBuffer, int length)
        {
            // WINDOW CAPTURE MODE: Sidecar captures the window directly.
            // This method is now a no-op but kept for backwards compatibility.
            // The Go sidecar will capture the RimWorld window externally.
        }
    }
}