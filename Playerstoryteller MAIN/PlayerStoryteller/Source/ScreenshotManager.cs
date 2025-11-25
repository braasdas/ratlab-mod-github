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
                // Capture the current screen
                int width = Screen.width;
                int height = Screen.height;

                // Create a new texture to read the screen pixels into
                Texture2D screenshot = new Texture2D(width, height, TextureFormat.RGB24, false);

                // Read the screen pixels into the texture
                screenshot.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                screenshot.Apply();

                // Convert to PNG bytes
                byte[] bytes = ImageConversion.EncodeToPNG(screenshot);

                // Clean up
                UnityEngine.Object.Destroy(screenshot);

                if (bytes == null || bytes.Length == 0)
                {
                    Log.Warning("[Player Storyteller] Screenshot captured but PNG encoding failed");
                    return null;
                }

                Log.Message($"[Player Storyteller] Screenshot captured: {bytes.Length} bytes");
                return bytes;
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error capturing screenshot: {ex.Message}\n{ex.StackTrace}");
                return null;
            }
        }
    }
}
