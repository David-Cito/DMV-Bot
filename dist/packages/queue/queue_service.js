"use strict";
// Queue Service for Queue System V2
// See openspec/specs/queue-mechanics/spec.md
Object.defineProperty(exports, "__esModule", { value: true });
exports.createQueueEntry = createQueueEntry;
exports.getQueueEntry = getQueueEntry;
exports.getQueueEntryByUserAndLocation = getQueueEntryByUserAndLocation;
exports.getQueueEntriesByUser = getQueueEntriesByUser;
exports.getQueueCounts = getQueueCounts;
exports.processQueuePromotions = processQueuePromotions;
exports.selectUsersForBooking = selectUsersForBooking;
exports.releaseUsersFromBooking = releaseUsersFromBooking;
const supabase_client_1 = require("../db/supabase_client");
const state_machine_1 = require("./state_machine");
/**
 * Create a new queue entry for a user.
 * User starts in 'waiting' state (waitlist).
 */
async function createQueueEntry(params) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('queue_entries')
        .insert({
        user_id: params.user_id,
        location_id: params.location_id,
        tier: params.tier,
        time_preference: params.time_preference || null,
        state: 'waiting',
    })
        .select()
        .single();
    if (error) {
        throw new Error(`Failed to create queue entry: ${error.message}`);
    }
    return mapQueueEntry(data);
}
/**
 * Get a queue entry by ID
 */
async function getQueueEntry(queueEntryId) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('queue_entries')
        .select('*')
        .eq('id', queueEntryId)
        .single();
    if (error || !data) {
        return null;
    }
    return mapQueueEntry(data);
}
/**
 * Get a user's queue entry for a specific location
 */
async function getQueueEntryByUserAndLocation(userId, locationId) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('queue_entries')
        .select('*')
        .eq('user_id', userId)
        .eq('location_id', locationId)
        .single();
    if (error || !data) {
        return null;
    }
    return mapQueueEntry(data);
}
/**
 * Get all queue entries for a user
 */
async function getQueueEntriesByUser(userId) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('queue_entries')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
    if (error) {
        throw new Error(`Failed to fetch queue entries: ${error.message}`);
    }
    return (data || []).map(mapQueueEntry);
}
/**
 * Get queue counts for a location
 */
async function getQueueCounts(locationId) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('queue_entries')
        .select('state')
        .eq('location_id', locationId)
        .in('state', ['waiting', 'invited', 'ready', 'active', 'booking']);
    if (error) {
        throw new Error(`Failed to fetch queue counts: ${error.message}`);
    }
    const counts = {
        waiting: 0,
        invited: 0,
        ready: 0,
        active: 0,
        booking: 0,
        total_in_queue: 0,
    };
    for (const row of data || []) {
        const state = row.state;
        if (state in counts) {
            counts[state]++;
        }
    }
    counts.total_in_queue = counts.ready + counts.active + counts.booking;
    return counts;
}
// ============================================================================
// QUEUE PROMOTION
// ============================================================================
/**
 * Process queue promotions for a location.
 *
 * 1. Move 'ready' users to 'active' if queue has space
 * 2. Invite 'waiting' users if pre-queue has space
 *
 * @param locationId - Location to process
 * @returns Number of users promoted/invited
 */
async function processQueuePromotions(locationId) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    // Get location settings
    const { data: location, error: locError } = await supabase
        .from('locations')
        .select('queue_size_limit')
        .eq('id', locationId)
        .single();
    if (locError || !location) {
        throw new Error(`Location not found: ${locError?.message || locationId}`);
    }
    const queueSizeLimit = location.queue_size_limit;
    const preQueueLimit = Math.floor(queueSizeLimit / 2);
    // Get current counts
    const counts = await getQueueCounts(locationId);
    let promotedToActive = 0;
    let invitedToPrequeue = 0;
    // 1. Promote 'ready' users to 'active'
    const activeSpots = queueSizeLimit - counts.active - counts.booking;
    if (activeSpots > 0 && counts.ready > 0) {
        const toPromote = Math.min(activeSpots, counts.ready);
        // Get ready users in order (priority first, then by deposit_paid_at)
        const { data: readyUsers } = await supabase
            .from('queue_entries')
            .select('id')
            .eq('location_id', locationId)
            .eq('state', 'ready')
            .order('tier', { ascending: true }) // 'flexible' < 'priority' alphabetically, so we want desc
            .order('deposit_paid_at', { ascending: true })
            .limit(toPromote);
        // Actually order should be priority first. Let's fix the ordering.
        // 'priority' should come before 'flexible'
        // We'll use a raw query approach or just fetch and sort
        const { data: readyUsersSorted } = await supabase
            .from('queue_entries')
            .select('id, tier, deposit_paid_at')
            .eq('location_id', locationId)
            .eq('state', 'ready')
            .order('deposit_paid_at', { ascending: true });
        // Sort: priority first, then by deposit_paid_at
        const sorted = (readyUsersSorted || []).sort((a, b) => {
            if (a.tier === 'priority' && b.tier === 'flexible')
                return -1;
            if (a.tier === 'flexible' && b.tier === 'priority')
                return 1;
            return new Date(a.deposit_paid_at).getTime() - new Date(b.deposit_paid_at).getTime();
        });
        for (const user of sorted.slice(0, toPromote)) {
            const result = await (0, state_machine_1.transitionState)(user.id, 'active', {
                trigger_type: 'system',
                trigger_details: { reason: 'queue_promotion' },
            });
            if (result.success) {
                promotedToActive++;
            }
        }
    }
    // 2. Invite 'waiting' users to pre-queue
    // Recalculate counts after promotions
    const updatedCounts = await getQueueCounts(locationId);
    const preQueueSpots = preQueueLimit - updatedCounts.invited - updatedCounts.ready;
    if (preQueueSpots > 0 && updatedCounts.waiting > 0) {
        const toInvite = Math.min(preQueueSpots, updatedCounts.waiting);
        // Get waiting users in order (priority first, then by created_at)
        const { data: waitingUsers } = await supabase
            .from('queue_entries')
            .select('id, tier, created_at')
            .eq('location_id', locationId)
            .eq('state', 'waiting')
            .order('created_at', { ascending: true });
        // Sort: priority first, then by created_at
        const sorted = (waitingUsers || []).sort((a, b) => {
            if (a.tier === 'priority' && b.tier === 'flexible')
                return -1;
            if (a.tier === 'flexible' && b.tier === 'priority')
                return 1;
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });
        for (const user of sorted.slice(0, toInvite)) {
            const result = await (0, state_machine_1.transitionState)(user.id, 'invited', {
                trigger_type: 'system',
                trigger_details: { reason: 'queue_spot_available' },
            });
            if (result.success) {
                invitedToPrequeue++;
            }
        }
    }
    return {
        promoted_to_active: promotedToActive,
        invited_to_prequeue: invitedToPrequeue,
    };
}
/**
 * Select eligible users for a booking attempt.
 * Uses the database function for atomic selection with FOR UPDATE SKIP LOCKED.
 * This prevents race conditions when multiple bots run concurrently.
 *
 * @param locationId - Location to select users from
 * @param slotTime - Time of the slot (HH:MM:SS format)
 * @param botId - Bot ID for tracking
 * @param slotId - Slot ID for tracking
 * @param limit - Max users to select (default 2)
 */
async function selectUsersForBooking(locationId, slotTime, botId, slotId, limit = 2) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    // Call the atomic database function
    // Uses FOR UPDATE SKIP LOCKED to prevent race conditions
    const { data, error } = await supabase.rpc('select_users_for_booking_atomic', {
        p_location_id: locationId,
        p_slot_time: slotTime,
        p_bot_id: botId,
        p_slot_id: slotId,
        p_limit: limit,
    });
    if (error) {
        throw new Error(`Failed to select users for booking: ${error.message}`);
    }
    return (data || []).map((row) => ({
        queue_entry_id: row.queue_entry_id,
        user_id: row.user_id,
        tier: row.tier,
        time_preference: row.time_preference,
    }));
}
/**
 * Release users back to active state after a failed booking attempt.
 * Uses atomic database function for consistency.
 */
async function releaseUsersFromBooking(queueEntryIds, reason) {
    if (queueEntryIds.length === 0)
        return 0;
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    // Use atomic database function
    const { data, error } = await supabase.rpc('release_users_from_booking_atomic', {
        p_queue_entry_ids: queueEntryIds,
        p_reason: reason,
    });
    if (error) {
        console.error(`Failed to release users from booking: ${error.message}`);
        // Fallback to individual transitions
        for (const id of queueEntryIds) {
            await (0, state_machine_1.transitionState)(id, 'active', {
                trigger_type: 'bot_action',
                trigger_details: { reason },
            }).catch(e => console.error(`Failed to release ${id}: ${e.message}`));
        }
        return queueEntryIds.length;
    }
    return data || 0;
}
// ============================================================================
// HELPERS
// ============================================================================
/**
 * Get time block from time string
 * DMV appointments: 8:00am - 3:45pm, every 15 minutes
 *
 * Time blocks:
 * - Morning: 8:00am - 10:45am
 * - Midday: 11:00am - 1:45pm
 * - Afternoon: 2:00pm - 3:45pm
 */
function getTimeBlock(time) {
    const [hourStr, minStr] = time.split(':');
    const hour = parseInt(hourStr, 10);
    const minute = parseInt(minStr || '0', 10);
    const timeInMinutes = hour * 60 + minute;
    // Morning: 8:00 - 10:45 (8am - 10:45am)
    if (timeInMinutes >= 8 * 60 && timeInMinutes <= 10 * 60 + 45)
        return 'morning';
    // Midday: 11:00 - 13:45 (11am - 1:45pm)
    if (timeInMinutes >= 11 * 60 && timeInMinutes <= 13 * 60 + 45)
        return 'midday';
    // Afternoon: 14:00 - 15:45 (2pm - 3:45pm)
    if (timeInMinutes >= 14 * 60 && timeInMinutes <= 15 * 60 + 45)
        return 'afternoon';
    return null; // Outside DMV hours
}
/**
 * Map database row to QueueEntry type
 */
function mapQueueEntry(row) {
    return {
        id: row.id,
        user_id: row.user_id,
        location_id: row.location_id,
        tier: row.tier,
        time_preference: row.time_preference,
        state: row.state,
        booking_bot_id: row.booking_bot_id,
        booking_started_at: row.booking_started_at ? new Date(row.booking_started_at) : null,
        booking_slot_id: row.booking_slot_id,
        invited_at: row.invited_at ? new Date(row.invited_at) : null,
        deposit_paid_at: row.deposit_paid_at ? new Date(row.deposit_paid_at) : null,
        queue_entered_at: row.queue_entered_at ? new Date(row.queue_entered_at) : null,
        booked_at: row.booked_at ? new Date(row.booked_at) : null,
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at),
    };
}
//# sourceMappingURL=queue_service.js.map