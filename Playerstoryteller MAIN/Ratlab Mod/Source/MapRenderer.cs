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
        /// Positions the camera to view the entire map and renders a single frame.
        /// </summary>
        /// <returns>The RenderTexture containing the map image.</returns>
        public RenderTexture RenderFullMap()
        {
            if (!IsInitialized || currentMap == null) return null;

            Camera cam = Find.Camera;
            if (cam == null) return null;
            
            if (sectionsField == null)
            {
                Log.Error("[Player Storyteller] Failed to reflect MapDrawer sections. Map capture disabled.");
                return null;
            }

            // Cache original Camera state
            Vector3 oldCamPos = cam.transform.position;
            Quaternion oldCamRot = cam.transform.rotation;
            float oldCamSize = cam.orthographicSize;
            RenderTexture oldTarget = cam.targetTexture;
            
            try
            {
                // 1. Calculate Map Bounds
                float mapWidth = currentMap.Size.x;
                float mapHeight = currentMap.Size.z;
                
                // Center position
                Vector3 center = new Vector3(mapWidth / 2f, 15f, mapHeight / 2f);
                
                // 2. Hijack Camera
                cam.targetTexture = targetTexture;
                cam.transform.position = center;
                
                // 3. Set Orthographic Size
                float aspect = (float)targetTexture.width / (float)targetTexture.height;
                float orthoSize = mapHeight / 2f;
                if (mapWidth / aspect > mapHeight)
                {
                    orthoSize = (mapWidth / aspect) / 2f;
                }
                cam.orthographicSize = orthoSize;

                // 4. Force Draw All Map Sections
                // We manually submit render commands for every section of the map
                Array sections = (Array)sectionsField.GetValue(currentMap.mapDrawer);
                if (sections != null)
                {
                    foreach (object section in sections)
                    {
                        // Section is Verse.Section, but we use dynamic or reflection to call DrawSection
                        // to avoid assembly visibility issues if Section is internal (though it shouldn't be).
                        // Safest way:
                        if (section is Section s)
                        {
                            s.DrawSection();
                        }
                    }
                }

                // 5. Render
                // The camera now sees all the meshes we just submitted
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
                // 6. Restore Original State
                cam.targetTexture = oldTarget;
                cam.transform.position = oldCamPos;
                cam.transform.rotation = oldCamRot;
                cam.orthographicSize = oldCamSize;
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