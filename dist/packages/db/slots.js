"use strict";
// Database operations for slot_states (read-only from existing monitoring tables)
// See CLAUDE_IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md Section 9
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchOpenedSlotsSinceWatermark = fetchOpenedSlotsSinceWatermark;
const supabase_client_1 = require("./supabase_client");
/**
 * Fetches newly opened slots since the given watermark.
 *
 * The slot_states table uses columns `date` and `time` which are mapped to
 * `slot_date` and `slot_time` in the SlotState type.
 *
 * Filters:
 * - first_seen > watermark
 * - last_seen > (db now - lookbackMinutes)
 *
 * Orders by first_seen ASC.
 * Skips rows with null date or time.
 * Normalizes time to HH:MM:SS format.
 */
async function fetchOpenedSlotsSinceWatermark(watermark, lookbackMinutes) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase.rpc('fetch_opened_slots_since', {
        p_watermark: watermark.toISOString(),
        p_lookback_minutes: lookbackMinutes,
    });
    if (error) {
        throw new Error(`Failed to fetch opened slots since watermark: ${error.message}`);
    }
    return (data || [])
        .filter((row) => row.slot_date && row.slot_time)
        .map((row) => ({
        location_id: row.location_id,
        slot_date: row.slot_date,
        slot_time: normalizeTimeToHHMMSS(row.slot_time),
        first_seen: new Date(row.first_seen),
        last_seen: new Date(row.last_seen),
    }));
}
/**
 * Normalizes a time string to HH:MM:SS format.
 * Handles various input formats like "HH:MM", "HH:MM:SS", etc.
 */
function normalizeTimeToHHMMSS(time) {
    if (!time)
        return '00:00:00';
    // If already in HH:MM:SS format, return as-is
    if (/^\d{2}:\d{2}:\d{2}$/.test(time)) {
        return time;
    }
    // If in HH:MM format, append :00
    if (/^\d{2}:\d{2}$/.test(time)) {
        return `${time}:00`;
    }
    // Try to parse and format
    const parts = time.split(':');
    const hours = (parts[0] || '00').padStart(2, '0');
    const minutes = (parts[1] || '00').padStart(2, '0');
    const seconds = (parts[2] || '00').padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}
//# sourceMappingURL=slots.js.map