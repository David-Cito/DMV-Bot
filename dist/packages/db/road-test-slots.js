"use strict";
// Database operations for road test slots
// Road Test Bot - See openspec/specs/road-test-bot/spec.md for documentation
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertRoadTestSlots = upsertRoadTestSlots;
exports.markDisappearedSlots = markDisappearedSlots;
exports.getActiveSlots = getActiveSlots;
exports.getUnnotifiedAppearedSlots = getUnnotifiedAppearedSlots;
exports.getUnnotifiedDisappearedSlots = getUnnotifiedDisappearedSlots;
exports.markSlotsNotifiedAppeared = markSlotsNotifiedAppeared;
exports.markSlotsNotifiedDisappeared = markSlotsNotifiedDisappeared;
exports.getSlotsAppearedSince = getSlotsAppearedSince;
exports.getSlotsDisappearedSince = getSlotsDisappearedSince;
exports.recordRoadTestScan = recordRoadTestScan;
exports.getLastSuccessfulScan = getLastSuccessfulScan;
exports.recordNotification = recordNotification;
exports.getLastNotification = getLastNotification;
const supabase_client_1 = require("./supabase_client");
// ============================================================================
// SLOT OPERATIONS
// ============================================================================
/**
 * Upsert road test slots with change tracking.
 * - New slots are inserted with first_seen = now
 * - Existing active slots get last_seen updated
 * - Reappeared slots are reactivated
 */
async function upsertRoadTestSlots(slots) {
    if (slots.length === 0) {
        return { newSlots: 0, reactivatedSlots: 0, updatedSlots: 0 };
    }
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const now = new Date().toISOString();
    let newSlots = 0;
    let reactivatedSlots = 0;
    let updatedSlots = 0;
    // Process each slot
    for (const slot of slots) {
        // Check if slot exists
        const { data: existing, error: selectError } = await supabase
            .from('road_test_slots')
            .select('id, is_active')
            .eq('date', slot.date)
            .eq('time', slot.time)
            .eq('location', slot.location)
            .maybeSingle();
        if (selectError) {
            console.error(`[DB] Error checking slot: ${selectError.message}`);
            continue;
        }
        if (!existing) {
            // New slot - insert
            const { error: insertError } = await supabase
                .from('road_test_slots')
                .insert({
                date: slot.date,
                time: slot.time,
                location: slot.location,
                slot_type: slot.slot_type,
                button_name: slot.button_name || null,
                button_value: slot.button_value || null,
                first_seen: now,
                last_seen: now,
                is_active: true,
                notified_appeared: false,
                notified_disappeared: false,
            });
            if (insertError) {
                console.error(`[DB] Error inserting slot: ${insertError.message}`);
            }
            else {
                newSlots++;
            }
        }
        else if (!existing.is_active) {
            // Slot reappeared - reactivate
            const { error: updateError } = await supabase
                .from('road_test_slots')
                .update({
                is_active: true,
                last_seen: now,
                disappeared_at: null,
                notified_appeared: false,
                notified_disappeared: false,
                button_name: slot.button_name || null,
                button_value: slot.button_value || null,
            })
                .eq('id', existing.id);
            if (updateError) {
                console.error(`[DB] Error reactivating slot: ${updateError.message}`);
            }
            else {
                reactivatedSlots++;
            }
        }
        else {
            // Update existing active slot
            const { error: updateError } = await supabase
                .from('road_test_slots')
                .update({
                last_seen: now,
                button_name: slot.button_name || null,
                button_value: slot.button_value || null,
            })
                .eq('id', existing.id);
            if (updateError) {
                console.error(`[DB] Error updating slot: ${updateError.message}`);
            }
            else {
                updatedSlots++;
            }
        }
    }
    return { newSlots, reactivatedSlots, updatedSlots };
}
/**
 * Mark slots not seen since cutoff as disappeared.
 * Returns the count of slots marked as disappeared.
 */
async function markDisappearedSlots(cutoffTime) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('road_test_slots')
        .update({
        is_active: false,
        disappeared_at: now,
        notified_disappeared: false,
    })
        .eq('is_active', true)
        .lt('last_seen', cutoffTime.toISOString())
        .select('id');
    if (error) {
        console.error(`[DB] Error marking disappeared slots: ${error.message}`);
        return 0;
    }
    return data?.length || 0;
}
/**
 * Get all active slots.
 */
async function getActiveSlots() {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('road_test_slots')
        .select('*')
        .eq('is_active', true)
        .order('date', { ascending: true })
        .order('time', { ascending: true });
    if (error) {
        throw new Error(`Failed to fetch active slots: ${error.message}`);
    }
    return data || [];
}
/**
 * Get slots that appeared but haven't been notified.
 */
async function getUnnotifiedAppearedSlots() {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('road_test_slots')
        .select('*')
        .eq('is_active', true)
        .eq('notified_appeared', false)
        .order('first_seen', { ascending: true });
    if (error) {
        throw new Error(`Failed to fetch unnotified appeared slots: ${error.message}`);
    }
    return data || [];
}
/**
 * Get slots that disappeared but haven't been notified.
 */
async function getUnnotifiedDisappearedSlots() {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('road_test_slots')
        .select('*')
        .eq('is_active', false)
        .eq('notified_disappeared', false)
        .order('disappeared_at', { ascending: true });
    if (error) {
        throw new Error(`Failed to fetch unnotified disappeared slots: ${error.message}`);
    }
    return data || [];
}
/**
 * Mark slots as notified for appearance.
 */
async function markSlotsNotifiedAppeared(slotIds) {
    if (slotIds.length === 0)
        return;
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { error } = await supabase
        .from('road_test_slots')
        .update({ notified_appeared: true })
        .in('id', slotIds);
    if (error) {
        throw new Error(`Failed to mark slots as notified: ${error.message}`);
    }
}
/**
 * Mark slots as notified for disappearance.
 */
async function markSlotsNotifiedDisappeared(slotIds) {
    if (slotIds.length === 0)
        return;
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { error } = await supabase
        .from('road_test_slots')
        .update({ notified_disappeared: true })
        .in('id', slotIds);
    if (error) {
        throw new Error(`Failed to mark slots as notified: ${error.message}`);
    }
}
/**
 * Get slots that appeared since a specific time.
 */
async function getSlotsAppearedSince(since) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('road_test_slots')
        .select('*')
        .gte('first_seen', since.toISOString())
        .order('first_seen', { ascending: true });
    if (error) {
        throw new Error(`Failed to fetch slots appeared since: ${error.message}`);
    }
    return data || [];
}
/**
 * Get slots that disappeared since a specific time.
 */
async function getSlotsDisappearedSince(since) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('road_test_slots')
        .select('*')
        .eq('is_active', false)
        .gte('disappeared_at', since.toISOString())
        .order('disappeared_at', { ascending: true });
    if (error) {
        throw new Error(`Failed to fetch slots disappeared since: ${error.message}`);
    }
    return data || [];
}
// ============================================================================
// SCAN OPERATIONS
// ============================================================================
/**
 * Record a scan run in the database.
 */
async function recordRoadTestScan(scan) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('road_test_scans')
        .insert({
        scanned_at: new Date().toISOString(),
        ok: scan.ok,
        reason: scan.reason || null,
        scan_duration_ms: scan.durationMs || null,
        days_scanned: scan.daysScanned || null,
        total_slots_found: scan.totalSlots,
        slots_by_location: scan.slotsByLocation,
        new_slots_count: scan.newSlotsCount || 0,
        disappeared_slots_count: scan.disappearedSlotsCount || 0,
    })
        .select('id')
        .single();
    if (error) {
        throw new Error(`Failed to record scan: ${error.message}`);
    }
    return data.id;
}
/**
 * Get the most recent successful scan.
 */
async function getLastSuccessfulScan() {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('road_test_scans')
        .select('id, scanned_at')
        .eq('ok', true)
        .order('scanned_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) {
        throw new Error(`Failed to get last scan: ${error.message}`);
    }
    return data;
}
// ============================================================================
// NOTIFICATION LOG OPERATIONS
// ============================================================================
/**
 * Record a notification in the log.
 */
async function recordNotification(type, slotsNotified, messageHash) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { error } = await supabase
        .from('road_test_notification_log')
        .insert({
        notification_type: type,
        sent_at: new Date().toISOString(),
        slots_notified: slotsNotified,
        message_hash: messageHash || null,
    });
    if (error) {
        throw new Error(`Failed to record notification: ${error.message}`);
    }
}
/**
 * Get the last notification of a specific type.
 */
async function getLastNotification(type) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('road_test_notification_log')
        .select('id, sent_at, slots_notified')
        .eq('notification_type', type)
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) {
        throw new Error(`Failed to get last notification: ${error.message}`);
    }
    return data;
}
//# sourceMappingURL=road-test-slots.js.map