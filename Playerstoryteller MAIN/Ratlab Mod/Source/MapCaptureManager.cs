using System;
using System.IO;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Rendering;
using Verse;
using BitMiracle.LibJpeg.Classic;

namespace PlayerStoryteller
{
    /// <summary>
    /// Manages high-performance map capture using AsyncGPUReadback.
    /// Handles both Screen Capture (for live feed) and Full Map Rendering (for tactical view).
    /// </summary>
    public class MapCaptureManager
    {
        // Dependencies
        private MapRenderer fullMapRenderer;
        private MapRenderer pawnViewRenderer;

        // Screen Capture State
        private Texture2D screenCaptureTexture;
        private RenderTexture screenTargetRT;
        private int lastScreenWidth = -1;
        private int lastScreenHeight = -1;
        
        // Locks
        private bool isCapturingScreen = false;
        private bool isCapturingFullMap = false;
        private bool isCapturingPawnViews = false;

        // Callback when image is ready (jpeg bytes)
        private Action<byte[]> onCaptureComplete;

        public MapCaptureManager()
        {
            fullMapRenderer = new MapRenderer();
            pawnViewRenderer = new MapRenderer();
        }

        public void SetCaptureCallback(Action<byte[]> callback)
        {
            onCaptureComplete = callback;
        }

        /// <summary>
        /// Captures the current camera view (Screen) using AsyncGPUReadback.
        /// </summary>
        public void CaptureScreenAsync(float scale = 1.0f, int quality = 75)
        {
            if (isCapturingScreen) return;
            isCapturingScreen = true;

            try
            {
                int fullWidth = Screen.width;
                int fullHeight = Screen.height;
                int targetWidth = (int)(fullWidth * scale);
                int targetHeight = (int)(fullHeight * scale);

                // Prepare textures
                PrepareScreenTextures(fullWidth, fullHeight, targetWidth, targetHeight);

                // 1. Capture screen to Texture2D (Main Thread)
                screenCaptureTexture.ReadPixels(new Rect(0, 0, fullWidth, fullHeight), 0, 0, false);
                screenCaptureTexture.Apply(false);

                // 2. Blit to RenderTexture (GPU Scaling)
                Graphics.Blit(screenCaptureTexture, screenTargetRT);

                // 3. Request Async Readback
                AsyncGPUReadback.Request(screenTargetRT, 0, TextureFormat.RGB24, (request) => 
                {
                    OnScreenReadbackComplete(request, targetWidth, targetHeight, quality);
                });
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Screen capture failed: {ex.Message}");
                isCapturingScreen = false;
            }
        }

        /// <summary>
        /// Captures the entire game map by rendering it to a large texture.
        /// </summary>
        public void CaptureFullMapAsync(Map map, int width = 2048, int height = 2048, int quality = 70)
        {
            if (isCapturingFullMap) return;
            isCapturingFullMap = true;

            try
            {
                if (!fullMapRenderer.IsInitialized)
                {
                    fullMapRenderer.Initialize(map, width, height);
                }

                // Render Map
                RenderTexture mapRT = fullMapRenderer.RenderFullMap();
                
                if (mapRT == null)
                {
                    isCapturingFullMap = false;
                    return;
                }

                // Async Readback
                AsyncGPUReadback.Request(mapRT, 0, TextureFormat.RGB24, (request) => 
                {
                    OnFullMapReadbackComplete(request, width, height, quality);
                });
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Full Map capture failed: {ex.Message}");
                isCapturingFullMap = false;
            }
        }

        /// <summary>
        /// Captures views for multiple pawns. 
        /// Called from Main Thread Coroutine.
        /// </summary>
        public void CapturePawnViews(System.Collections.Generic.Dictionary<string, Pawn> pawns, Action<System.Collections.Generic.Dictionary<string, byte[]>> callback)
        {
            if (isCapturingPawnViews) return;
            isCapturingPawnViews = true;

            int pending = 0;
            var results = new System.Collections.Generic.Dictionary<string, byte[]>();
            object resultsLock = new object();

            try
            {
                foreach (var kvp in pawns)
                {
                    Pawn p = kvp.Value;
                    if (p == null || !p.Spawned || p.Map == null) continue;

                    // Ensure renderer is using the correct map
                    pawnViewRenderer.Initialize(p.Map, 300, 300);

                    // Render (15f ortho size ~ 30 tiles wide)
                    RenderTexture rt = pawnViewRenderer.RenderPawnView(p, 300, 300, 15f);
                    if (rt != null)
                    {
                        System.Threading.Interlocked.Increment(ref pending);
                        string pawnId = kvp.Key;
                        int width = rt.width;
                        int height = rt.height;

                        // Async Readback
                        AsyncGPUReadback.Request(rt, 0, TextureFormat.RGB24, (request) => 
                        {
                            if (request.hasError)
                            {
                                Log.Warning($"[Player Storyteller] Pawn view readback error for {pawnId}");
                                if (System.Threading.Interlocked.Decrement(ref pending) == 0)
                                {
                                    isCapturingPawnViews = false;
                                    callback?.Invoke(results);
                                }
                                return;
                            }

                            var rawData = request.GetData<byte>().ToArray();

                            Task.Run(() => 
                            {
                                try
                                {
                                    byte[] jpegBytes = EncodeJpeg(rawData, width, height, 60);
                                    lock (resultsLock)
                                    {
                                        results[pawnId] = jpegBytes;
                                    }
                                }
                                catch (Exception ex)
                                {
                                    Log.Error($"[Player Storyteller] Pawn encode failed: {ex.Message}");
                                }
                                finally
                                {
                                    if (System.Threading.Interlocked.Decrement(ref pending) == 0)
                                    {
                                        isCapturingPawnViews = false;
                                        callback?.Invoke(results);
                                    }
                                }
                            });
                        });
                    }
                }
                
                // If no valid pawns were found or rendered
                if (pending == 0)
                {
                    isCapturingPawnViews = false;
                    callback?.Invoke(results);
                }
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Pawn View Capture Error: {ex.Message}");
                isCapturingPawnViews = false;
                callback?.Invoke(results);
            }
        }

        private void PrepareScreenTextures(int srcW, int srcH, int dstW, int dstH)
        {
            if (screenCaptureTexture == null || lastScreenWidth != srcW || lastScreenHeight != srcH)
            {
                if (screenCaptureTexture != null) UnityEngine.Object.Destroy(screenCaptureTexture);
                screenCaptureTexture = new Texture2D(srcW, srcH, TextureFormat.RGB24, false);
                lastScreenWidth = srcW;
                lastScreenHeight = srcH;
            }

            if (screenTargetRT == null || screenTargetRT.width != dstW || screenTargetRT.height != dstH)
            {
                if (screenTargetRT != null) screenTargetRT.Release();
                screenTargetRT = new RenderTexture(dstW, dstH, 0, RenderTextureFormat.ARGB32);
            }
        }

        private void OnScreenReadbackComplete(AsyncGPUReadbackRequest request, int width, int height, int quality)
        {
            if (request.hasError)
            {
                Log.Warning("[Player Storyteller] Screen GPU Readback error.");
                isCapturingScreen = false;
                return;
            }

            // Get raw data
            var rawData = request.GetData<byte>().ToArray();

            // Offload JPEG encoding
            Task.Run(() => 
            {
                try
                {
                    byte[] jpegBytes = EncodeJpeg(rawData, width, height, quality);
                    onCaptureComplete?.Invoke(jpegBytes);
                }
                catch (Exception ex)
                {
                    Log.Error($"[Player Storyteller] Screen encode failed: {ex.Message}");
                }
                finally
                {
                    isCapturingScreen = false;
                }
            });
        }

        private void OnFullMapReadbackComplete(AsyncGPUReadbackRequest request, int width, int height, int quality)
        {
            if (request.hasError)
            {
                Log.Warning("[Player Storyteller] Full Map GPU Readback error.");
                isCapturingFullMap = false;
                return;
            }

            var rawData = request.GetData<byte>().ToArray();

            Task.Run(() => 
            {
                try
                {
                    byte[] jpegBytes = EncodeJpeg(rawData, width, height, quality);
                    onCaptureComplete?.Invoke(jpegBytes);
                }
                catch (Exception ex)
                {
                    Log.Error($"[Player Storyteller] Full Map encode failed: {ex.Message}");
                }
                finally
                {
                    isCapturingFullMap = false;
                }
            });
        }

        private byte[] EncodeJpeg(byte[] rawData, int width, int height, int quality)
        {
            using (var stream = new MemoryStream())
            {
                var cinfo = new jpeg_compress_struct(new jpeg_error_mgr());
                cinfo.Image_width = width;
                cinfo.Image_height = height;
                cinfo.Input_components = 3;
                cinfo.In_color_space = J_COLOR_SPACE.JCS_RGB;

                cinfo.jpeg_set_defaults();
                cinfo.jpeg_set_quality(quality, true);
                cinfo.jpeg_stdio_dest(stream);
                cinfo.jpeg_start_compress(true);

                byte[][] rowData = new byte[1][];
                int rowStride = width * 3;

                // Flip vertically (Unity bottom-left vs JPEG top-left)
                while (cinfo.Next_scanline < cinfo.Image_height)
                {
                    int rowOffset = (height - 1 - cinfo.Next_scanline) * rowStride;
                    if (rowData[0] == null || rowData[0].Length != rowStride)
                        rowData[0] = new byte[rowStride];
                    
                    Array.Copy(rawData, rowOffset, rowData[0], 0, rowStride);
                    cinfo.jpeg_write_scanlines(rowData, 1);
                }

                cinfo.jpeg_finish_compress();
                return stream.ToArray();
            }
        }

        public void Cleanup()
        {
            if (screenTargetRT != null)
            {
                screenTargetRT.Release();
                UnityEngine.Object.Destroy(screenTargetRT);
                screenTargetRT = null;
            }
            if (screenCaptureTexture != null)
            {
                UnityEngine.Object.Destroy(screenCaptureTexture);
                screenCaptureTexture = null;
            }
            
            if (fullMapRenderer != null) fullMapRenderer.Cleanup();
            if (pawnViewRenderer != null) pawnViewRenderer.Cleanup();

            isCapturingScreen = false;
            isCapturingFullMap = false;
            isCapturingPawnViews = false;
        }
    }
}