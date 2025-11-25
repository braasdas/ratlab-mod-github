using System;
using System.Text;
using System.Net.Http;
using System.Threading.Tasks;
using UnityEngine;
using Verse;

namespace PlayerStoryteller
{
    public static class NetworkSpeedTest
    {
        public static async Task<SpeedTestResult> RunSpeedTest(string serverUrl)
        {
            try
            {
                Log.Message("[Player Storyteller] Starting network speed test...");

                var httpClient = new HttpClient();
                httpClient.Timeout = TimeSpan.FromSeconds(10);

                // Test with 100KB payload (similar to a screenshot)
                int testSizeKB = 100;
                byte[] testData = new byte[testSizeKB * 1024];
                new System.Random().NextBytes(testData);
                string base64Data = Convert.ToBase64String(testData);

                // Create simple JSON manually
                string jsonPayload = "{\"testData\":\"" + base64Data + "\",\"size\":" + testSizeKB + "}";

                var content = new StringContent(
                    jsonPayload,
                    Encoding.UTF8,
                    "application/json"
                );

                // Run 3 tests and average the results
                long totalMs = 0;
                int successfulTests = 0;

                for (int i = 0; i < 3; i++)
                {
                    long startTicks = DateTime.Now.Ticks;

                    var response = await httpClient.PostAsync($"{serverUrl}/api/speedtest", content);

                    if (response.IsSuccessStatusCode)
                    {
                        await response.Content.ReadAsStringAsync(); // Read full response
                        long endTicks = DateTime.Now.Ticks;
                        long elapsedMs = (endTicks - startTicks) / TimeSpan.TicksPerMillisecond;
                        totalMs += elapsedMs;
                        successfulTests++;

                        Log.Message($"[Player Storyteller] Speed test {i + 1}/3: {elapsedMs}ms");
                    }

                    // Small delay between tests
                    await Task.Delay(100);
                }

                if (successfulTests == 0)
                {
                    Log.Warning("[Player Storyteller] All speed tests failed");
                    return null;
                }

                long avgMs = totalMs / successfulTests;
                double bandwidth = (testSizeKB * 2.0) / (avgMs / 1000.0); // KB/s (upload + download)

                var result = new SpeedTestResult
                {
                    averageRoundTripMs = avgMs,
                    estimatedBandwidthKBps = bandwidth,
                    successfulTests = successfulTests
                };

                Log.Message($"[Player Storyteller] Speed test complete: {avgMs}ms avg, ~{bandwidth:F0} KB/s");

                return result;
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Speed test error: {ex.Message}");
                return null;
            }
        }

        public static void ApplyOptimalSettings(SpeedTestResult result, PlayerStorytellerSettings settings)
        {
            if (result == null)
            {
                Log.Warning("[Player Storyteller] Cannot apply optimal settings - speed test failed");
                return;
            }

            // Calculate optimal settings based on bandwidth
            // Targeting ~80% of available bandwidth to leave headroom

            double targetBandwidthKBps = result.estimatedBandwidthKBps * 0.8;

            // Quality tiers based on available bandwidth
            if (targetBandwidthKBps > 500) // > 500 KB/s (4 Mbps)
            {
                // High quality
                settings.updateInterval = 0.2f;  // 5 FPS
                settings.resolutionScale = 1.0f; // Full resolution
                settings.screenshotQuality = 95;
                Log.Message("[Player Storyteller] Applied HIGH quality preset (5 FPS, 1.0x scale, 95% quality)");
            }
            else if (targetBandwidthKBps > 250) // > 250 KB/s (2 Mbps)
            {
                // Medium-high quality
                settings.updateInterval = 0.33f; // 3 FPS
                settings.resolutionScale = 0.85f;
                settings.screenshotQuality = 90;
                Log.Message("[Player Storyteller] Applied MEDIUM-HIGH quality preset (3 FPS, 0.85x scale, 90% quality)");
            }
            else if (targetBandwidthKBps > 150) // > 150 KB/s (1.2 Mbps)
            {
                // Medium quality
                settings.updateInterval = 0.5f;  // 2 FPS
                settings.resolutionScale = 0.75f;
                settings.screenshotQuality = 85;
                Log.Message("[Player Storyteller] Applied MEDIUM quality preset (2 FPS, 0.75x scale, 85% quality)");
            }
            else if (targetBandwidthKBps > 80) // > 80 KB/s (640 Kbps)
            {
                // Low-medium quality
                settings.updateInterval = 1.0f;  // 1 FPS
                settings.resolutionScale = 0.6f;
                settings.screenshotQuality = 75;
                Log.Message("[Player Storyteller] Applied LOW-MEDIUM quality preset (1 FPS, 0.6x scale, 75% quality)");
            }
            else // < 80 KB/s
            {
                // Low quality
                settings.updateInterval = 2.0f;  // 0.5 FPS
                settings.resolutionScale = 0.5f;
                settings.screenshotQuality = 60;
                Log.Message("[Player Storyteller] Applied LOW quality preset (0.5 FPS, 0.5x scale, 60% quality)");
            }

            settings.lastSpeedTestBandwidth = result.estimatedBandwidthKBps;
            settings.lastSpeedTestTime = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
        }
    }

    public class SpeedTestResult
    {
        public long averageRoundTripMs;
        public double estimatedBandwidthKBps;
        public int successfulTests;
    }
}
