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
                Log.Error($"[Player Storyteller] Screen capture failed: {ex.Message}");
                isCapturing = false;
                asyncReadbackPending = false;
            }
        }

        /// <summary>
        /// Captures the entire game map by rendering it to a large texture.
        /// </summary>
        public void CaptureFullMapAsync(Map map, int width = 2048, int height = 2048, int quality = 70)
        {
            if (isCapturing || asyncReadbackPending) return;
            isCapturing = true;

            try
            {
                if (!mapRenderer.IsInitialized)
                {
                    mapRenderer.Initialize(map, width, height);
                }

                // Render Map
                RenderTexture mapRT = mapRenderer.RenderFullMap();
                
                if (mapRT == null)
                {
                    isCapturing = false;
                    return;
                }

                // Async Readback
                asyncReadbackPending = true;
                AsyncGPUReadback.Request(mapRT, 0, TextureFormat.RGB24, (request) => 
                {
                    OnReadbackComplete(request, width, height, quality);
                });
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Full Map capture failed: {ex.Message}");
                isCapturing = false;
                asyncReadbackPending = false;
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

                    onCaptureComplete?.Invoke(jpegBytes);
                }
                catch (Exception ex)
                {
                    Log.Error($"[Player Storyteller] Background encode failed: {ex.Message}");
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