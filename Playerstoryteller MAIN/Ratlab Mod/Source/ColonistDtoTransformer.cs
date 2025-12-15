using System;
using Newtonsoft.Json.Linq;
using Verse;

namespace PlayerStoryteller
{
    /// <summary>
    /// Transforms nested ColonistDetailedDto from RIMAPI into a flat, unified structure.
    /// Eliminates frontend complexity by providing consistent data shape across all tiers.
    /// </summary>
    public static class ColonistDtoTransformer
    {
        /// <summary>
        /// Flattens a nested ColonistDetailedDto (from RIMAPI) into a single-level object.
        /// Merges colonist, colonist_work_info, colonist_medical_info, etc. to root level.
        /// </summary>
        /// <param name="detailed">Nested colonist DTO from RIMAPI /colonists/detailed endpoint</param>
        /// <returns>Flattened JObject with all fields at root level</returns>
        public static JObject FlattenColonistDetailed(JToken detailed)
        {
            try
            {
                var flat = new JObject();

                // Extract nested objects
                var colonist = detailed["colonist"];
                var workInfo = detailed["colonist_work_info"];
                var medicalInfo = detailed["colonist_medical_info"];
                var socialInfo = detailed["colonist_social_info"];
                var policiesInfo = detailed["colonist_policies_info"];

                // Copy all base colonist fields (id, name, gender, age, health, mood, hunger, position, etc.)
                if (colonist != null)
                {
                    foreach (var prop in colonist.Children<JProperty>())
                    {
                        flat[prop.Name] = prop.Value;
                    }
                }

                // Add top-level needs from root
                AddIfNotNull(flat, detailed, "sleep");
                AddIfNotNull(flat, detailed, "comfort");
                AddIfNotNull(flat, detailed, "surrounding_beauty");
                AddIfNotNull(flat, detailed, "fresh_air");

                // Flatten work info fields to root
                if (workInfo != null)
                {
                    AddIfNotNull(flat, workInfo, "skills");
                    AddIfNotNull(flat, workInfo, "current_job");
                    AddIfNotNull(flat, workInfo, "traits");
                    AddIfNotNull(flat, workInfo, "work_priorities");
                }

                // Flatten medical info fields to root
                if (medicalInfo != null)
                {
                    AddIfNotNull(flat, medicalInfo, "hediffs");
                    AddIfNotNull(flat, medicalInfo, "medical_policy_id");
                    AddIfNotNull(flat, medicalInfo, "is_self_tend_allowed");
                }

                // Flatten social info fields to root
                if (socialInfo != null)
                {
                    AddIfNotNull(flat, socialInfo, "direct_relations");
                    AddIfNotNull(flat, socialInfo, "children_count");
                }

                // Flatten policies info fields to root
                if (policiesInfo != null)
                {
                    AddIfNotNull(flat, policiesInfo, "food_policy_id");
                    AddIfNotNull(flat, policiesInfo, "hostility_response");
                }

                return flat;
            }
            catch (Exception ex)
            {
                Log.Error($"[Player Storyteller] Error flattening colonist DTO: {ex}");
                // Return original on error to avoid breaking data flow
                return detailed as JObject ?? new JObject();
            }
        }

        /// <summary>
        /// Helper method to copy a field from source to target if it exists.
        /// </summary>
        private static void AddIfNotNull(JObject target, JToken source, string fieldName)
        {
            var value = source[fieldName];
            if (value != null && value.Type != JTokenType.Null)
            {
                target[fieldName] = value;
            }
        }
    }
}
