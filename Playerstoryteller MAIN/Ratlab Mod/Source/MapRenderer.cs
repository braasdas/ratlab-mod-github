using System;
using System.Reflection;
using UnityEngine;
using Verse;
using RimWorld;

namespace PlayerStoryteller
{
    /// <summary>
    /// Handles the specific logic of setting up a camera to render the full map.
    /// Hijacks the Main Camera and forces all map sections to draw.
    /// </summary>
    public class MapRenderer
    {
        private RenderTexture targetTexture;
        private Map currentMap;
        private Camera captureCamera; // Dedicated camera for capture
        private GameObject captureCameraObj;

        // Reflection cache for MapDrawer sections
        private static FieldInfo sectionsField = typeof(MapDrawer).GetField("sections", BindingFlags.Instance | BindingFlags.NonPublic);

        public bool IsInitialized => targetTexture != null && captureCamera != null;
        public int Width => targetTexture != null ? targetTexture.width : 0;
        public int Height => targetTexture != null ? targetTexture.height : 0;

        public void Initialize(Map map, int width, int height)
        {
            if (map == null) return;
            currentMap = map;
            SetupTexture(width, height);
            SetupCamera();
            
            // Subscribe to rendering pipeline
            Camera.onPreCull -= OnCameraPreCull; // Safety remove
            Camera.onPreCull += OnCameraPreCull;
        }

        private void SetupCamera()
        {
            if (captureCamera != null) return;

            Camera mainCam = Find.Camera;
            if (mainCam == null) return;

            captureCameraObj = new GameObject("MapCaptureCamera");
            // DontSave flag prevents it from being saved with the scene/game
            captureCameraObj.hideFlags = HideFlags.HideAndDontSave; 
            
            captureCamera = captureCameraObj.AddComponent<Camera>();
            captureCamera.CopyFrom(mainCam);
            captureCamera.enabled = false; // We render manually via Render()
        }

        private void SetupTexture(int width, int height)
        {
            if (targetTexture == null || targetTexture.width != width || targetTexture.height != height)
            {
                if (targetTexture != null) targetTexture.Release();

                targetTexture = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
                targetTexture.Create();
            }
        }

        private Rect? pendingRenderRect;

        private void OnCameraPreCull(Camera cam)
        {
            if (cam != captureCamera) return;
            if (pendingRenderRect == null) return;

            // Force Draw Visible Sections strictly for this camera context
            if (sectionsField != null)
            {
                Array sections = (Array)sectionsField.GetValue(currentMap.mapDrawer);
                if (sections != null)
                {
                    Rect rect = pendingRenderRect.Value;
                    int minX = (int)rect.xMin;
                    int minZ = (int)rect.yMin;
                    int maxX = (int)rect.xMax;
                    int maxZ = (int)rect.yMax;
                    const int SectionSize = 17;

                    foreach (object sectionObj in sections)
                    {
                        if (sectionObj is Section section)
                        {
                            if (section.botLeft.x < maxX && section.botLeft.x + SectionSize > minX &&
                                section.botLeft.z < maxZ && section.botLeft.z + SectionSize > minZ)
                            {
                                section.DrawSection();
                            }
                        }
                    }
                }
            }
        }

        /// <summary>
        /// Renders a specific rectangular area of the map.
        /// Used for tiled rendering to reduce main thread lag.
        /// </summary>
        /// <param name="mapRect">The area of the map to render (in world coordinates).</param>
        /// <returns>The RenderTexture containing the rendered chunk.</returns>
        public RenderTexture RenderMapRect(Rect mapRect)
        {
            if (!IsInitialized || currentMap == null) return null;

            try
            {
                // 1. Position Camera at center of rect
                Vector3 center = new Vector3(mapRect.center.x, 15f, mapRect.center.y);
                captureCamera.transform.position = center;

                // 2. Set Orthographic Size to fit the rect height
                captureCamera.orthographicSize = mapRect.height / 2f;

                // 3. Set Target
                captureCamera.targetTexture = targetTexture;

                // 4. Set State for PreCull Callback
                pendingRenderRect = mapRect;

                // 5. Render
                // This triggers OnCameraPreCull, which submits the meshes ONLY for this camera.
                captureCamera.Render();

                return targetTexture;
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Map Render Error: {ex}");
                return null;
            }
            finally
            {
                pendingRenderRect = null;
            }
        }

        public void Cleanup()
        {
            Camera.onPreCull -= OnCameraPreCull;

            if (targetTexture != null)
            {
                targetTexture.Release();
                UnityEngine.Object.Destroy(targetTexture);
                targetTexture = null;
            }
            
            if (captureCameraObj != null)
            {
                UnityEngine.Object.Destroy(captureCameraObj);
                captureCameraObj = null;
                captureCamera = null;
            }
        }
    }
}