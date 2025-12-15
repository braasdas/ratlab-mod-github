using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading.Tasks;
using Verse;
using RimWorld;

namespace PlayerStoryteller
{
    /// <summary>
    /// Polls for viewer actions and queues them for execution on the main thread.
    /// Coordinates with ActionSecurityManager for rate limiting and permissions.
    /// </summary>
    public class ViewerActionProcessor
    {
        private readonly ActionSecurityManager securityManager;
        private readonly Map map;

        // Thread-safe action queue for processing actions on main thread
        private readonly ConcurrentQueue<Action> mainThreadActionQueue = new ConcurrentQueue<Action>();

        // Callback for processing individual actions (will be set by MapComponent)
        private Action<PlayerAction> actionHandler;

        public ViewerActionProcessor(ActionSecurityManager securityManager, Map map)
        {
            this.securityManager = securityManager;
            this.map = map;
        }

        /// <summary>
        /// Sets the callback that will handle individual player actions.
        /// This allows the MapComponent to provide its own action handling logic.
        /// </summary>
        public void SetActionHandler(Action<PlayerAction> handler)
        {
            this.actionHandler = handler;
        }

        /// <summary>
        /// Polls for viewer actions from the server and queues them for main thread execution.
        /// Should be called every 2 seconds.
        /// </summary>
        public async Task PollForActionsAsync()
        {
            try
            {
                var actions = await PlayerStorytellerMod.GetPlayerActionsAsync();
                foreach (var action in actions)
                {
                    // Queue for main thread execution
                    Log.Message($"[Player Storyteller] Enqueuing action: {action.action} with data: {action.data}");
                    mainThreadActionQueue.Enqueue(() => ProcessPlayerAction(action));
                }
                if (actions.Count > 0)
                {
                    Log.Message($"[Player Storyteller] Queue size after enqueue: {mainThreadActionQueue.Count}");
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error polling for actions: {ex}");
            }
        }

        /// <summary>
        /// Processes queued actions on the main thread.
        /// Should be called every game tick from MapComponentTick.
        /// </summary>
        public void ProcessQueuedActions()
        {
            while (!mainThreadActionQueue.IsEmpty)
            {
                if (mainThreadActionQueue.TryDequeue(out var action))
                {
                    try
                    {
                        Log.Message("[Player Storyteller] Dequeued action from queue, executing now...");
                        action();
                    }
                    catch (Exception ex)
                    {
                        Log.Error($"[Player Storyteller] Error executing queued action: {ex}");
                    }
                }
            }
        }

        /// <summary>
        /// Processes a single player action with security checks.
        /// </summary>
        private void ProcessPlayerAction(PlayerAction action)
        {
            try
            {
                if (action == null || string.IsNullOrEmpty(action.action))
                {
                    Log.Warning("[Player Storyteller] Received an action that was null or had no action name.");
                    return;
                }

                // Security check: rate limiting
                if (!securityManager.CheckRateLimit())
                {
                    Log.Warning($"[Player Storyteller] Action '{action.action}' rate limited");
                    return;
                }

                // Security check: is action enabled in settings?
                if (!securityManager.IsActionEnabled(action.action))
                {
                    Messages.Message($"Action '{action.action}' is currently disabled in mod settings.", MessageTypeDefOf.RejectInput);
                    Log.Warning($"[Player Storyteller] Action '{action.action}' disabled in settings");
                    return;
                }

                // Delegate to the action handler (set by MapComponent)
                if (actionHandler != null)
                {
                    actionHandler(action);
                }
                else
                {
                    Log.Error("[Player Storyteller] No action handler set for ViewerActionProcessor");
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error processing action '{action?.action}': {ex.Message}\n{ex.StackTrace}");
            }
        }

        /// <summary>
        /// Gets the security manager (for access to sanitization methods).
        /// </summary>
        public ActionSecurityManager SecurityManager => securityManager;
    }
}
