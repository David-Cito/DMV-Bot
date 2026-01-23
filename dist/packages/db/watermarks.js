"use strict";
// Database operations for queue_watermarks
// See CLAUDE_IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md Section 6.1
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchWatermark = fetchWatermark;
exports.updateWatermark = updateWatermark;
const supabase_client_1 = require("./supabase_client");
async function fetchWatermark(key) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('queue_watermarks')
        .select('*')
        .eq('key', key)
        .maybeSingle();
    if (error) {
        throw new Error(`Failed to fetch watermark ${key}: ${error.message}`);
    }
    if (!data) {
        return null;
    }
    return {
        key: data.key,
        last_processed_at: new Date(data.last_processed_at),
    };
}
async function updateWatermark(key, lastProcessedAt) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { error } = await supabase
        .from('queue_watermarks')
        .upsert({
        key,
        last_processed_at: lastProcessedAt.toISOString(),
    })
        .eq('key', key);
    if (error) {
        throw new Error(`Failed to update watermark ${key}: ${error.message}`);
    }
}
//# sourceMappingURL=watermarks.js.map