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
        private MapRenderer mapRenderer;

        // Screen Capture State
        private Texture2D screenCaptureTexture;
        private RenderTexture screenTargetRT;
        private int lastScreenWidth = -1;
        private int lastScreenHeight = -1;

        // General State
        private bool isCapturing = false;
        private bool asyncReadbackPending = false;

        // Callback when image is ready (jpeg bytes)
        private Action<byte[]> onCaptureComplete;

        public MapCaptureManager()
        {
            mapRenderer = new MapRenderer();
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
            if (isCapturing || asyncReadbackPending) return;
            isCapturing = true;

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
                asyncReadbackPending = true;
                AsyncGPUReadback.Request(screenTargetRT, 0, TextureFormat.RGB24, (request) =>
                {
                    OnReadbackComplete(request, targetWidth, targetHeight, quality);
                });
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Screen capture failed: {ex}");
                isCapturing = false;
                asyncReadbackPending = false;
            }
        }

        private RenderTexture fullMapRT;

        /// <summary>
        /// Captures the entire game map by rendering it in tiles over multiple frames.
        /// This amortizes the cost and prevents massive lag spikes.
        /// </summary>
        public System.Collections.IEnumerator CaptureFullMapRoutine(Map map, int width = 2048, int height = 2048, int quality = 70)
        {
            if (isCapturing || asyncReadbackPending) yield break;
            isCapturing = true;

            if (!mapRenderer.IsInitialized)
            {
                // We use a smaller tile size for rendering to keep GPU cost low per frame
                // 1024x1024 is a good balance.
                mapRenderer.Initialize(map, width / 2, height / 2);
            }

            // Prepare the Full Map Render Target (The accumulator)
            if (fullMapRT == null || fullMapRT.width != width || fullMapRT.height != height)
            {
                if (fullMapRT != null) fullMapRT.Release();
                fullMapRT = new RenderTexture(width, height, 0, RenderTextureFormat.ARGB32);
            }

            // Grid Configuration (2x2 = 4 tiles) - Reverted to minimize visual artifacts
            int cols = 2;
            int rows = 2;
            
            int tilePixelWidth = width / cols;
            int tilePixelHeight = height / rows;

            if (!mapRenderer.IsInitialized || mapRenderer.Width != tilePixelWidth || mapRenderer.Height != tilePixelHeight)
            {
                // Re-initialize if dimensions changed
                mapRenderer.Initialize(map, tilePixelWidth, tilePixelHeight);
            }

            // Prepare the Full Map Render Target (The accumulator)
            if (fullMapRT == null || fullMapRT.width != width || fullMapRT.height != height)
            {
                if (fullMapRT != null) fullMapRT.Release();
                fullMapRT = new RenderTexture(width, height, 0, RenderTextureFormat.ARGB32);
            }

            float tileWorldWidth = map.Size.x / (float)cols;
            float tileWorldHeight = map.Size.z / (float)rows;

            // Log.Message($"[Player Storyteller] Starting Tiled Map Capture: {cols}x{rows}");
            Log.Message($"[Player Storyteller] Starting Map Capture Routine (2x2). Total: {width}x{height}");

            // Render loop
            for (int z = 0; z < rows; z++)
            {
                for (int x = 0; x < cols; x++)
                {
                    // Calculate Map Rect for this chunk
                    float rectX = x * tileWorldWidth;
                    float rectZ = z * tileWorldHeight;
                    
                    Rect chunkRect = new Rect(rectX, rectZ, tileWorldWidth, tileWorldHeight);

                    // Render the chunk
                    RenderTexture chunkRT = mapRenderer.RenderMapRect(chunkRect);

                    if (chunkRT != null)
                    {
                        // Calculate pixel offsets
                        int destX = x * tilePixelWidth;
                        int destY = z * tilePixelHeight;

                        // Efficiently copy the chunk into the accumulator
                        Graphics.CopyTexture(
                            chunkRT, 0, 0, 0, 0, chunkRT.width, chunkRT.height,
                            fullMapRT, 0, 0, destX, destY
                        );
                    }
                    else
                    {
                        Log.Error($"[Player Storyteller] RenderMapRect returned null for chunk {x},{z}");
                    }

                    // Wait for next frame
                    yield return null;
                }
            }

            Log.Message("[Player Storyteller] Tiled Render Complete. Requesting GPU Readback.");

            // Async Readback of the Full Map
            asyncReadbackPending = true;
            AsyncGPUReadback.Request(fullMapRT, 0, TextureFormat.RGB24, (request) =>
            {
                if (request.hasError)
                {
                    Log.Error("[Player Storyteller] GPU Readback reported error!");
                }
                else
                {
                    Log.Message("[Player Storyteller] GPU Readback success. Processing data...");
                }
                OnReadbackComplete(request, width, height, quality);
            });
        }

        public void CaptureFullMapAsync(Map map, int width = 2048, int height = 2048, int quality = 70)
        {
             // Deprecated wrapper or could start coroutine if passed a handler
             Log.Error("[Player Storyteller] CaptureFullMapAsync called directly. Use CaptureFullMapRoutine via StartCoroutine.");
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

        private void OnReadbackComplete(AsyncGPUReadbackRequest request, int width, int height, int quality)
        {
            asyncReadbackPending = false;

            if (request.hasError)
            {
                Log.Warning("[Player Storyteller] GPU Readback error.");
                isCapturing = false;
                return;
            }

            // Get raw data (Main Thread, but fast copy)
            var rawData = request.GetData<byte>().ToArray();

            // Offload JPEG encoding to thread pool
            Task.Run(() =>
            {
                try
                {
                    byte[] jpegBytes;
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
                        jpegBytes = stream.ToArray();
                    }

                    if (jpegBytes != null)
                    {
                        onCaptureComplete?.Invoke(jpegBytes);
                    }
                }
                catch (Exception)
                {
                    // Logging from background thread is unsafe
                }
                finally
                {
                    isCapturing = false;
                }
            });
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

            if (mapRenderer != null)
            {
                mapRenderer.Cleanup();
            }

            isCapturing = false;
            asyncReadbackPending = false;
        }
    }
}