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

        // Reflection cache for MapDrawer sections
        private static FieldInfo sectionsField = typeof(MapDrawer).GetField("sections", BindingFlags.Instance | BindingFlags.NonPublic);

        public bool IsInitialized => targetTexture != null;

        public void Initialize(Map map, int width, int height)
        {
            if (map == null) return;
            currentMap = map;
            SetupTexture(width, height);
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

        /// <summary>
        /// Renders a specific rectangular area of the map.
        /// Used for tiled rendering to reduce main thread lag.
        /// </summary>
        /// <param name="mapRect">The area of the map to render (in world coordinates).</param>
        /// <returns>The RenderTexture containing the rendered chunk.</returns>
        public RenderTexture RenderMapRect(Rect mapRect)
        {
            if (!IsInitialized || currentMap == null) return null;

            Camera cam = Find.Camera;
            if (cam == null) return null;

            // Cache original Camera state
            Vector3 oldCamPos = cam.transform.position;
            Quaternion oldCamRot = cam.transform.rotation;
            float oldCamSize = cam.orthographicSize;
            RenderTexture oldTarget = cam.targetTexture;
            float oldFarClip = cam.farClipPlane;

            try
            {
                // 1. Position Camera at center of rect
                Vector3 center = new Vector3(mapRect.center.x, 15f, mapRect.center.y);
                cam.transform.position = center;

                // 2. Set Orthographic Size to fit the rect height
                // Ortho size is half the vertical size of the viewing volume
                cam.orthographicSize = mapRect.height / 2f;

                // 3. Set Target
                cam.targetTexture = targetTexture;

                // 4. Force Draw Visible Sections
                // RimWorld's MapDrawer relies on CameraDriver.CurrentViewRect, which doesn't update
                // when we move the camera manually. We must manually submit the sections we want to see.
                if (sectionsField != null)
                {
                    Array sections = (Array)sectionsField.GetValue(currentMap.mapDrawer);
                    if (sections != null)
                    {
                        // Convert mapRect to integer bounds
                        int minX = (int)mapRect.xMin;
                        int minZ = (int)mapRect.yMin;
                        int maxX = (int)mapRect.xMax;
                        int maxZ = (int)mapRect.yMax;
                        const int SectionSize = 17;

                        foreach (object sectionObj in sections)
                        {
                            if (sectionObj is Section section)
                            {
                                // Check if section overlaps with the chunk we are rendering
                                // Section bounds are [botLeft.x, botLeft.x + 17)
                                if (section.botLeft.x < maxX && section.botLeft.x + SectionSize > minX &&
                                    section.botLeft.z < maxZ && section.botLeft.z + SectionSize > minZ)
                                {
                                    section.DrawSection();
                                }
                            }
                        }
                    }
                }

                // 5. Render
                cam.Render();

                return targetTexture;
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Map Render Error: {ex.Message}");
                return null;
            }
            finally
            {
                // 5. Restore Original State
                cam.targetTexture = oldTarget;
                cam.transform.position = oldCamPos;
                cam.transform.rotation = oldCamRot;
                cam.orthographicSize = oldCamSize;
                cam.farClipPlane = oldFarClip;
            }
        }

        public void Cleanup()
        {
            if (targetTexture != null)
            {
                targetTexture.Release();
                UnityEngine.Object.Destroy(targetTexture);
                targetTexture = null;
            }
        }
    }
}