"use strict";
// Database operations for target_window_presets
// See CLAUDE_IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md Section 4
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchActivePresetsByType = fetchActivePresetsByType;
exports.fetchPresetByKey = fetchPresetByKey;
const supabase_client_1 = require("./supabase_client");
async function fetchActivePresetsByType(presetType) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('target_window_presets')
        .select('*')
        .eq('preset_type', presetType)
        .eq('active', true)
        .order('sort_order', { ascending: true });
    if (error) {
        throw new Error(`Failed to fetch presets for type ${presetType}: ${error.message}`);
    }
    return (data || []).map(mapRowToPreset);
}
async function fetchPresetByKey(presetType, key) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('target_window_presets')
        .select('*')
        .eq('preset_type', presetType)
        .eq('key', key)
        .eq('active', true)
        .maybeSingle();
    if (error) {
        throw new Error(`Failed to fetch preset ${presetType}/${key}: ${error.message}`);
    }
    if (!data) {
        return null;
    }
    return mapRowToPreset(data);
}
function mapRowToPreset(row) {
    const base = {
        id: row.id,
        preset_type: row.preset_type,
        key: row.key,
        label: row.label,
        active: row.active,
        sort_order: row.sort_order,
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at),
        rules_json: row.rules_json,
    };
    // Return with proper typing based on preset_type
    return base;
}
//# sourceMappingURL=presets.js.map