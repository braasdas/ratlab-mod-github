using System;
using System.Collections.Generic;
using System.Text;
using Verse;
using RimWorld;

namespace PlayerStoryteller
{
    /// <summary>
    /// Manages security for viewer actions including rate limiting,
    /// permission checks, and input sanitization.
    /// </summary>
    public class ActionSecurityManager
    {
        private const int RateLimitWindowTicks = 3600; // 1 minute at normal speed
        private const int MaxMessageLength = 500;
        private const int MinMessageLength = 3;

        private Queue<int> actionTimestamps = new Queue<int>();
        private readonly object rateLimitLock = new object();

        /// <summary>
        /// Checks if an action can be executed based on rate limiting.
        /// Returns true if under the limit, false otherwise.
        /// </summary>
        public bool CheckRateLimit()
        {
            lock (rateLimitLock)
            {
                int currentTick = Find.TickManager.TicksGame;
                int oneMinuteAgo = currentTick - RateLimitWindowTicks;

                while (actionTimestamps.Count > 0 && actionTimestamps.Peek() < oneMinuteAgo)
                {
                    actionTimestamps.Dequeue();
                }

                if (actionTimestamps.Count >= PlayerStorytellerMod.settings.maxActionsPerMinute)
                {
                    Messages.Message($"Action rate limit exceeded! Max {PlayerStorytellerMod.settings.maxActionsPerMinute} actions per minute.", MessageTypeDefOf.RejectInput);
                    return false;
                }

                actionTimestamps.Enqueue(currentTick);
                return true;
            }
        }

        /// <summary>
        /// Checks if a specific action is enabled in mod settings.
        /// </summary>
        public bool IsActionEnabled(string actionName)
        {
            var settings = PlayerStorytellerMod.settings;
            switch (actionName)
            {
                case "healColonist": return settings.enableHealColonist;
                case "healAll": return settings.enableHealAll;
                case "inspireColonist": return settings.enableInspireColonist;
                case "inspireAll": return settings.enableInspireAll;
                case "sendWanderer": return settings.enableSendWanderer;
                case "sendRefugee": return settings.enableSendRefugee;
                case "dropFood": return settings.enableDropFood;
                case "dropMedicine": return settings.enableDropMedicine;
                case "dropSteel": return settings.enableDropSteel;
                case "dropComponents": return settings.enableDropComponents;
                case "dropSilver": return settings.enableDropSilver;
                case "legendary": return settings.enableLegendary;
                case "sendTrader": return settings.enableSendTrader;
                case "tameAnimal": return settings.enableTameAnimal;
                case "spawnAnimal": return settings.enableSpawnAnimal;
                case "goodEvent": return settings.enableGoodEvent;
                case "weatherClear": return settings.enableWeatherClear;
                case "weatherRain": return settings.enableWeatherRain;
                case "weatherFog": return settings.enableWeatherFog;
                case "weatherSnow": return settings.enableWeatherSnow;
                case "weatherThunderstorm": return settings.enableWeatherThunderstorm;
                case "raid": return settings.enableRaid;
                case "manhunter": return settings.enableManhunter;
                case "madAnimal": return settings.enableMadAnimal;
                case "solarFlare": return settings.enableSolarFlare;
                case "eclipse": return settings.enableEclipse;
                case "toxicFallout": return settings.enableToxicFallout;
                case "flashstorm": return settings.enableFlashstorm;
                case "meteor": return settings.enableMeteor;
                case "tornado": return settings.enableTornado;
                case "lightning": return settings.enableLightning;
                case "randomEvent": return settings.enableRandomEvent;
                case "sendLetter": return settings.enableSendLetter;
                case "ping": return settings.enablePing;
                default: return true; // Allow unknown actions by default
            }
        }

        /// <summary>
        /// Sanitizes user input to prevent injection attacks or inappropriate content.
        /// </summary>
        public string SanitizeUserInput(string input)
        {
            if (string.IsNullOrWhiteSpace(input))
            {
                return null;
            }

            string sanitized = input.Trim();

            if (sanitized.Length < MinMessageLength)
            {
                Messages.Message($"Message too short (minimum {MinMessageLength} characters)", MessageTypeDefOf.RejectInput);
                return null;
            }

            if (sanitized.Length > MaxMessageLength)
            {
                sanitized = sanitized.Substring(0, MaxMessageLength);
                Messages.Message($"Message truncated to {MaxMessageLength} characters", MessageTypeDefOf.CautionInput);
            }

            // Allow: letters, numbers, spaces, basic punctuation
            var sb = new StringBuilder(sanitized.Length);
            foreach (char c in sanitized)
            {
                if (char.IsLetterOrDigit(c) || char.IsWhiteSpace(c) || ".,!?'-:;()[]{}\"".IndexOf(c) >= 0)
                {
                    sb.Append(c);
                }
            }

            string result = sb.ToString();

            if (string.IsNullOrWhiteSpace(result))
            {
                Messages.Message("Message contains no valid characters", MessageTypeDefOf.RejectInput);
                return null;
            }

            return result;
        }
    }
}
