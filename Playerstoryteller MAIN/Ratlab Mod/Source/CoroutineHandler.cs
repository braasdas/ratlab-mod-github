using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using Verse;

namespace PlayerStoryteller
{
    /// <summary>
    /// PERFORMANCE OPTIMIZED: Helper MapComponent to run coroutines since MapComponents don't have native coroutine support.
    /// Key optimizations:
    /// 1. Only checks coroutines every 30 ticks (0.5s) instead of every tick (60fps)
    /// 2. Caches reflection lookup for WaitForSeconds
    /// 3. Time-based checking instead of constant polling
    /// </summary>
    public class CoroutineHandler : MapComponent
    {
        private List<CoroutineInstance> activeCoroutines = new List<CoroutineInstance>();
        private static System.Reflection.FieldInfo waitSecondsField;

        // PERFORMANCE: Interval for checking coroutines (exposed for other classes)
        internal const int CoroutineCheckInterval = 30; // Check coroutines every 30 ticks (0.5s)

        public CoroutineHandler(Map map) : base(map)
        {
            // PERFORMANCE FIX: Cache reflection lookup once at startup
            if (waitSecondsField == null)
            {
                waitSecondsField = typeof(WaitForSeconds).GetField("m_Seconds",
                    System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            }
        }

        public Coroutine StartCoroutine(IEnumerator routine)
        {
            var instance = new CoroutineInstance(routine);
            activeCoroutines.Add(instance);
            return instance;
        }

        public void StopCoroutine(Coroutine coroutine)
        {
            if (coroutine is CoroutineInstance instance)
            {
                instance.stopped = true;
                activeCoroutines.Remove(instance);
            }
        }

        public override void MapComponentTick()
        {
            base.MapComponentTick();

            // CRITICAL PERFORMANCE FIX: Only process coroutines every 30 ticks (0.5s) instead of 60 times per second
            // This reduces overhead by 30x while maintaining responsiveness
            if (Find.TickManager.TicksGame % CoroutineCheckInterval != 0)
                return;

            float currentTime = Time.realtimeSinceStartup;

            // Process all active coroutines
            for (int i = activeCoroutines.Count - 1; i >= 0; i--)
            {
                var coroutine = activeCoroutines[i];

                if (coroutine.stopped)
                {
                    activeCoroutines.RemoveAt(i);
                    continue;
                }

                try
                {
                    // Only process if it's time to wake up
                    if (coroutine.ShouldTick(currentTime))
                    {
                        if (!coroutine.MoveNext(currentTime))
                        {
                            // Coroutine finished
                            activeCoroutines.RemoveAt(i);
                        }
                    }
                }
                catch (Exception ex)
                {
                    Log.Error($"[Player Storyteller] Coroutine error: {ex.Message}\n{ex.StackTrace}");
                    activeCoroutines.RemoveAt(i);
                }
            }
        }

        private class CoroutineInstance : Coroutine
        {
            private Stack<IEnumerator> executionStack = new Stack<IEnumerator>();
            private float waitUntilTime;
            public bool stopped;

            public CoroutineInstance(IEnumerator routine)
            {
                executionStack.Push(routine);
                this.waitUntilTime = 0f; // Ready to run immediately
            }

            public bool ShouldTick(float currentTime)
            {
                // PERFORMANCE FIX: Simple time check instead of reflection every tick
                return currentTime >= waitUntilTime;
            }

            public bool MoveNext(float currentTime)
            {
                if (stopped) return false;
                if (executionStack.Count == 0) return false;

                // Process the top of the stack
                IEnumerator top = executionStack.Peek();

                if (!top.MoveNext())
                {
                    // This routine finished, pop it and continue parent
                    executionStack.Pop();

                    if (executionStack.Count == 0) return false; // All done

                    // Wait for next tick to process parent routine
                    waitUntilTime = currentTime;
                    return true;
                }

                // Process the yield instruction
                var current = top.Current;

                if (current is IEnumerator nested)
                {
                    // Nested coroutine detected: Push to stack
                    executionStack.Push(nested);
                    waitUntilTime = currentTime; // Run nested immediately next tick
                }
                else if (current is WaitForSeconds waitForSeconds)
                {
                    waitUntilTime = currentTime + GetWaitTime(waitForSeconds);
                }
                else if (current is YieldInstruction)
                {
                    // For other yield instructions, check again next tick
                    waitUntilTime = currentTime;
                }
                else
                {
                    // No yield or null (or just a frame wait), ready immediately
                    waitUntilTime = currentTime;
                }

                return true;
            }

            private static float GetWaitTime(WaitForSeconds waitForSeconds)
            {
                // PERFORMANCE FIX: Use cached reflection field instead of looking up every time
                if (waitSecondsField != null)
                {
                    return (float)waitSecondsField.GetValue(waitForSeconds);
                }

                return 0f;
            }
        }
    }

    /// <summary>
    /// Base class for coroutine handles.
    /// </summary>
    public class Coroutine
    {
        // Marker class for coroutine handles
    }
}
