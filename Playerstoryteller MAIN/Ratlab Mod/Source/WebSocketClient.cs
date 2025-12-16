using System;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using Verse;

namespace PlayerStoryteller
{
    public class WebSocketClient
    {
        private ClientWebSocket ws;
        private string sessionId;
        private string streamKey;
        private string interactionPassword;
        private string wsUrl;
        private bool isPublic;
        private bool isConnecting;
        private SemaphoreSlim sendLock = new SemaphoreSlim(1, 1); // Allow 1 concurrent send
        private CancellationTokenSource cts;
        private byte[] sessionBytes;
        private long lastConnectAttempt;

        public bool IsConnected => ws != null && ws.State == WebSocketState.Open;

        public WebSocketClient(string apiUrl, string session, string key, bool isPublic, string password = "")
        {
            this.sessionId = session;
            this.streamKey = key;
            this.interactionPassword = password;
            this.isPublic = isPublic;
            this.wsUrl = ConvertToWsUrl(apiUrl);
        }

        private string ConvertToWsUrl(string httpUrl)
        {
            // Force production traffic through the secure Nginx path
            if (httpUrl.Contains("ratlab.online"))
            {
                return "wss://ratlab.online/mod-socket";
            }

            string host = "localhost";
            try { host = new Uri(httpUrl).Host; } catch {}
            return $"ws://{host}:3001";
        }

        public async Task Connect()
        {
            if (IsConnected || isConnecting) return;
            
            // Simple throttle: max 1 attempt per 3 seconds
            if (DateTime.Now.Ticks - lastConnectAttempt < 3 * TimeSpan.TicksPerSecond) return;
            lastConnectAttempt = DateTime.Now.Ticks;

            isConnecting = true;

            try
            {
                if (ws != null) { try { ws.Dispose(); } catch {} }
                ws = new ClientWebSocket();
                cts = new CancellationTokenSource();

                // Add headers for authentication and session identification
                ws.Options.SetRequestHeader("Authorization", $"Bearer {streamKey}");
                ws.Options.SetRequestHeader("Session-Id", sessionId);
                ws.Options.SetRequestHeader("is-public", isPublic.ToString().ToLower());

                // Add interaction password if set
                if (!string.IsNullOrEmpty(interactionPassword))
                {
                    ws.Options.SetRequestHeader("x-interaction-password", interactionPassword);
                }

                Log.Message($"[PlayerStoryteller] Attempting WS Connection to: {wsUrl}");
                await ws.ConnectAsync(new Uri(wsUrl), cts.Token);

                // Protocol: [Type:1] [Len:1] [SessionID:N]
                byte[] idBytes = Encoding.UTF8.GetBytes(sessionId);
                sessionBytes = new byte[1 + idBytes.Length];
                sessionBytes[0] = (byte)idBytes.Length;
                Array.Copy(idBytes, 0, sessionBytes, 1, idBytes.Length);

                Log.Message($"[PlayerStoryteller] WS Connected: {wsUrl}");
            }
            catch (Exception ex)
            {
                Log.Error($"[PlayerStoryteller] WS Connection Failed: {ex.Message}\n{ex.StackTrace}");
                // Silent fail on connection loop
            }
            finally
            {
                isConnecting = false;
            }
        }

        public async Task SendImage(byte[] imageDataBuffer, int length)
        {
            if (!IsConnected) { _ = Connect(); return; }

            await sendLock.WaitAsync();
            try
            {
                // Combine header and data into ONE packet
                int headerLen = 1 + sessionBytes.Length;
                byte[] packet = new byte[headerLen + length];
                
                // [0] Type
                packet[0] = 1; // Type 1 = Image
                // [1..N] Session Header
                Array.Copy(sessionBytes, 0, packet, 1, sessionBytes.Length);
                // [N..] Image Data (Copy only valid bytes)
                Array.Copy(imageDataBuffer, 0, packet, headerLen, length);

                await ws.SendAsync(new ArraySegment<byte>(packet), WebSocketMessageType.Binary, true, cts.Token);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] WebSocket SendImage failed: {ex.Message}");
                try { ws.Dispose(); } catch {}
                ws = null;
            }
            finally
            {
                sendLock.Release();
            }
        }

        public async Task SendMapImage(byte[] imageDataBuffer, int length)
        {
            if (!IsConnected) 
            {
                Log.Warning("[Player Storyteller] SendMapImage: WebSocket not connected. Dropping map update.");
                return; // Don't auto-connect on heavy payload to avoid spam loop
            }

            await sendLock.WaitAsync();
            try
            {
                // Log.Message($"[Player Storyteller] Sending Map Packet via WS. Len: {length}");
                int headerLen = 1 + sessionBytes.Length;
                byte[] packet = new byte[headerLen + length];
                
                packet[0] = 3; // Type 3 = Full Map Image
                Array.Copy(sessionBytes, 0, packet, 1, sessionBytes.Length);
                Array.Copy(imageDataBuffer, 0, packet, headerLen, length);

                await ws.SendAsync(new ArraySegment<byte>(packet), WebSocketMessageType.Binary, true, cts.Token);
                // Log.Message("[Player Storyteller] Map Packet Sent.");
            }
            catch (Exception ex)
            {
                 Log.Error($"[Player Storyteller] SendMapImage Failed: {ex}");
                 try { ws.Dispose(); } catch {}
                 ws = null;
            }
            finally
            {
                sendLock.Release();
            }
        }

        public async Task SendGameState(string json)
        {
            if (!IsConnected) return;

            // Optional: Skip lock wait if busy for game state (drop frame strategy)
            // if (!sendLock.Wait(0)) return; 
            // Better to wait but with timeout? No, just queue it.
            
            await sendLock.WaitAsync();
            try
            {
                byte[] jsonBytes = Encoding.UTF8.GetBytes(json);
                
                int headerLen = 1 + sessionBytes.Length;
                byte[] packet = new byte[headerLen + jsonBytes.Length];

                // [0] Type
                packet[0] = 2; // Type 2 = JSON
                // [1..N] Session Header
                Array.Copy(sessionBytes, 0, packet, 1, sessionBytes.Length);
                // [N..] JSON Data
                Array.Copy(jsonBytes, 0, packet, headerLen, jsonBytes.Length);

                await ws.SendAsync(new ArraySegment<byte>(packet), WebSocketMessageType.Binary, true, cts.Token);
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] WebSocket SendGameState failed: {ex.Message}");
                try { ws.Dispose(); } catch {}
                ws = null;
            }
            finally
            {
                sendLock.Release();
            }
        }
    }
}
