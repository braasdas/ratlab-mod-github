using System;
using System.IO;
using UnityEngine;
using Verse;

namespace PlayerStoryteller
{
    public static class ScreenshotManager
    {
        public static byte[] CaptureMapScreenshot()
        {
            try
            {
                // Get the current map camera
                var camera = Find.Camera;
                if (camera == null)
                {
                    Log.Warning("Camera not found");
                    return null;
                }

                // Create a render texture
                int width = 1920;
                int height = 1080;
                RenderTexture rt = new RenderTexture(width, height, 24);
                camera.targetTexture = rt;

                // Render the camera
                Texture2D screenshot = new Texture2D(width, height, TextureFormat.RGB24, false);
                camera.Render();
                RenderTexture.active = rt;
                screenshot.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                screenshot.Apply();

                // Clean up
                camera.targetTexture = null;
                RenderTexture.active = null;
                UnityEngine.Object.Destroy(rt);

                // Convert to PNG bytes
                byte[] bytes = screenshot.EncodeToPNG();
                UnityEngine.Object.Destroy(screenshot);

                return bytes;
            }
            catch (Exception ex)
            {
                Log.Error($"Error capturing screenshot: {ex.Message}");
                return null;
            }
        }
    }
}
