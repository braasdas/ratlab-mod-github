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
                var settings = PlayerStorytellerMod.settings;

                // Calculate scaled dimensions
                int originalWidth = Screen.width;
                int originalHeight = Screen.height;
                int scaledWidth = (int)(originalWidth * settings.resolutionScale);
                int scaledHeight = (int)(originalHeight * settings.resolutionScale);

                // Create a texture to capture the screen
                Texture2D fullScreenshot = new Texture2D(originalWidth, originalHeight, TextureFormat.RGB24, false);
                fullScreenshot.ReadPixels(new Rect(0, 0, originalWidth, originalHeight), 0, 0);
                fullScreenshot.Apply();

                byte[] bytes;

                // If scaling is needed, create a scaled version
                if (settings.resolutionScale < 1.0f)
                {
                    // Create scaled texture
                    Texture2D scaledScreenshot = ScaleTexture(fullScreenshot, scaledWidth, scaledHeight);
                    UnityEngine.Object.Destroy(fullScreenshot);

                    // Encode to JPEG with quality setting
                    bytes = ImageConversion.EncodeToJPG(scaledScreenshot, settings.screenshotQuality);
                    UnityEngine.Object.Destroy(scaledScreenshot);
                }
                else
                {
                    // Use full resolution
                    bytes = ImageConversion.EncodeToJPG(fullScreenshot, settings.screenshotQuality);
                    UnityEngine.Object.Destroy(fullScreenshot);
                }

                if (bytes == null || bytes.Length == 0)
                {
                    Log.Warning("[Player Storyteller] Screenshot captured but JPEG encoding failed");
                    return null;
                }

                Log.Message($"[Player Storyteller] Screenshot captured: {scaledWidth}x{scaledHeight} @ Q{settings.screenshotQuality} = {bytes.Length / 1024}KB");
                return bytes;
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error capturing screenshot: {ex.Message}\n{ex.StackTrace}");
                return null;
            }
        }

        private static Texture2D ScaleTexture(Texture2D source, int targetWidth, int targetHeight)
        {
            Texture2D result = new Texture2D(targetWidth, targetHeight, TextureFormat.RGB24, false);
            Color[] rpixels = result.GetPixels(0);
            float incX = 1.0f / (float)targetWidth;
            float incY = 1.0f / (float)targetHeight;

            for (int px = 0; px < rpixels.Length; px++)
            {
                int x = px % targetWidth;
                int y = px / targetWidth;
                rpixels[px] = source.GetPixelBilinear(incX * ((float)x), incY * ((float)y));
            }

            result.SetPixels(rpixels, 0);
            result.Apply();
            return result;
        }
    }
}
