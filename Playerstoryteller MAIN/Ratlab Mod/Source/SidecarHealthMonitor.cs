using System;
using Verse;

namespace PlayerStoryteller
{
    /// <summary>
    /// Monitors the health of the sidecar process and restarts it if needed.
    /// </summary>
    public class SidecarHealthMonitor
    {
        private readonly SidecarManager sidecarManager;

        public SidecarHealthMonitor(SidecarManager sidecarManager)
        {
            this.sidecarManager = sidecarManager;
        }

        /// <summary>
        /// Checks sidecar health and restarts if necessary.
        /// Should be called every 5 seconds.
        /// </summary>
        public void CheckHealth()
        {
            try
            {
                string sessionId = PlayerStorytellerMod.GetSessionId();
                if (string.IsNullOrEmpty(sessionId))
                {
                    sessionId = "default-session";
                }

                // Restart sidecar if it died
                sidecarManager?.EnsureRunning(sessionId, PlayerStorytellerMod.settings.secretKey);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error in SidecarHealthMonitor: {ex}");
            }
        }
    }
}
