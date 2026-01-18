using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Verse;
using RimWorld;
using UnityEngine;

namespace PlayerStoryteller
{
    /// <summary>
    /// Manages viewer data, including buying pawns and tracking them.
    /// Stores relationships between Twitch usernames and in-game Pawns.
    /// </summary>
    public class ViewerManager : MapComponent
    {
        // Persistent data: Username -> Pawn Name (First, Nick, Last)
        private Dictionary<string, string> viewerToPawnMap = new Dictionary<string, string>();
        
        // Runtime cache: Username -> Pawn Object
        private Dictionary<string, Pawn> runtimePawnCache = new Dictionary<string, Pawn>();

        // Queue of viewers waiting to join
        private List<string> viewerQueue = new List<string>();

        public ViewerManager(Map map) : base(map)
        {
        }

        public override void ExposeData()
        {
            base.ExposeData();
            Scribe_Collections.Look(ref viewerToPawnMap, "viewerToPawnMap", LookMode.Value, LookMode.Value);
            Scribe_Collections.Look(ref viewerQueue, "viewerQueue", LookMode.Value);
        }

        public override void MapComponentTick()
        {
            // Periodically validate cache (every ~5 seconds)
            if (Find.TickManager.TicksGame % 300 == 0)
            {
                ValidatePawnCache();
            }
        }

        /// <summary>
        /// Checks if a viewer already has an active pawn in the colony.
        /// </summary>
        public bool ViewerHasActivePawn(string username)
        {
            if (string.IsNullOrEmpty(username)) return false;
            
            // Check cache first
            if (runtimePawnCache.TryGetValue(username, out Pawn cachedPawn))
            {
                if (cachedPawn != null && !cachedPawn.Dead && !cachedPawn.Destroyed)
                {
                    return true;
                }
            }

            // Check persistent map
            if (viewerToPawnMap.TryGetValue(username, out _))
            {
                // Pawn exists in records, try to find them alive
                Pawn foundPawn = FindActivePawnForViewer(username);
                return foundPawn != null;
            }

            return false;
        }

        /// <summary>
        /// Registers a new pawn to a viewer.
        /// </summary>
        public void RegisterPawn(string username, Pawn pawn)
        {
            if (string.IsNullOrEmpty(username) || pawn == null) return;

            // Store Name as string key for persistence
            string fullName = pawn.Name.ToString();
            viewerToPawnMap[username] = fullName;
            
            // Cache runtime reference
            runtimePawnCache[username] = pawn;

            Log.Message($"[Player Storyteller] Registered viewer {username} to pawn {fullName}");
        }

        /// <summary>
        /// Tries to find the active Pawn object for a viewer.
        /// </summary>
        public Pawn FindActivePawnForViewer(string username)
        {
            if (string.IsNullOrEmpty(username)) return null;

            // 1. Check Cache
            if (runtimePawnCache.TryGetValue(username, out Pawn cachedPawn))
            {
                if (cachedPawn != null && !cachedPawn.Dead && !cachedPawn.Destroyed) return cachedPawn;
            }

            // 2. Check Persistent Map
            if (viewerToPawnMap.TryGetValue(username, out string savedName))
            {
                // Search current colonists (covers maps and caravans usually)
                foreach (Pawn p in Find.ColonistBar.GetColonistsInOrder())
                {
                    if (p.Name.ToString() == savedName)
                    {
                        runtimePawnCache[username] = p;
                        return p;
                    }
                }
            }

            return null;
        }

        /// <summary>
        /// Returns a copy of the currently active viewer pawns.
        /// </summary>
        public Dictionary<string, Pawn> GetActivePawns()
        {
            // Try to recover cache from persistent data if it seems empty but we have records
            if (runtimePawnCache.Count < viewerToPawnMap.Count)
            {
                RebuildPawnCache();
            }

            ValidatePawnCache(); // Ensure we don't return dead pawns
            return new Dictionary<string, Pawn>(runtimePawnCache);
        }

        public Dictionary<string, string> GetAdoptionsList()
        {
            ValidatePawnCache();
            var adoptions = new Dictionary<string, string>();
            
            foreach (var kvp in runtimePawnCache)
            {
                if (kvp.Value != null)
                {
                    adoptions[kvp.Key] = kvp.Value.thingIDNumber.ToString();
                }
            }
            return adoptions;
        }

        private void RebuildPawnCache()
        {
            if (viewerToPawnMap == null || map == null) return;

            // Only look for pawns on this map to avoid cross-map issues
            // and ensure we only render what this map component controls
            var potentialPawns = map.mapPawns.AllPawnsSpawned;

            foreach (var kvp in viewerToPawnMap)
            {
                string username = kvp.Key;
                
                // Skip if already valid in cache
                if (runtimePawnCache.TryGetValue(username, out Pawn cached) && cached != null && !cached.Dead && !cached.Destroyed)
                {
                    continue;
                }

                string savedName = kvp.Value;
                
                // Try to find matching pawn on this map by name
                // Name.ToString() usually returns "First 'Nick' Last" or "First Last"
                Pawn match = potentialPawns.FirstOrDefault(p => p.Name != null && p.Name.ToString() == savedName);
                
                if (match != null)
                {
                    runtimePawnCache[username] = match;
                    Log.Message($"[Player Storyteller] Reconnected viewer {username} to pawn {match.Name.ToStringShort}");
                }
            }
        }

        private void ValidatePawnCache()
        {
            // Remove dead or destroyed pawns from cache
            List<string> toRemove = new List<string>();
            foreach (var kvp in runtimePawnCache)
            {
                if (kvp.Value == null || kvp.Value.Dead || kvp.Value.Destroyed)
                {
                    toRemove.Add(kvp.Key);
                }
            }

            foreach (string key in toRemove)
            {
                runtimePawnCache.Remove(key);
                // We keep them in viewerToPawnMap so we know they *were* in the game (for stats/history)
                // But for "Active" checks, they will fail.
            }
        }
    }
}
