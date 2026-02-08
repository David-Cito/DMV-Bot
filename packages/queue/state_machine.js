"use strict";
// State Machine Service for Queue System V2
// See openspec/specs/user-states/spec.md for state diagram
Object.defineProperty(exports, "__esModule", { value: true });
exports.TERMINAL_STATES = exports.VALID_TRANSITIONS = void 0;
exports.isValidTransition = isValidTransition;
exports.transitionState = transitionState;
exports.bulkTransitionState = bulkTransitionState;
exports.getQueueEntryState = getQueueEntryState;
exports.isInTerminalState = isInTerminalState;
const supabase_client_1 = require("../db/supabase_client");
// ============================================================================
// VALID STATE TRANSITIONS
// ============================================================================
/**
 * Map of valid state transitions.
 * Key = current state, Value = array of valid next states
 */
exports.VALID_TRANSITIONS = {
    waiting: ['invited', 'canceled', 'expired'],
    invited: ['ready', 'waiting', 'canceled', 'expired'],
    ready: ['active', 'canceled'],
    active: ['booking', 'payment_issue', 'canceled'],
    booking: ['booked', 'active', 'payment_issue', 'canceled'],
    booked: ['confirmed', 'canceled'],
    payment_issue: ['active', 'expired', 'canceled'],
    confirmed: ['completed', 'canceled'],
    completed: [],
    canceled: [],
    expired: [],
};
/**
 * Terminal states - no further transitions possible
 */
exports.TERMINAL_STATES = ['completed', 'canceled', 'expired'];
/**
 * Check if a state transition is valid
 */
function isValidTransition(from, to) {
    return exports.VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
// ============================================================================
// STATE TRANSITION FUNCTION
// ============================================================================
/**
 * Transition a queue entry to a new state.
 *
 * - Validates the transition is allowed
 * - Updates queue_entries table with new state and relevant timestamps
 * - Logs the transition to user_state_history
 * - Creates any necessary related records (bookings, transactions)
 *
 * @param queueEntryId - The queue entry to transition
 * @param toState - The target state
 * @param context - Context about why/how the transition is happening
 */
async function transitionState(queueEntryId, toState, context) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    // Fetch current state
    const { data: entry, error: fetchError } = await supabase
        .from('queue_entries')
        .select('id, user_id, location_id, tier, state')
        .eq('id', queueEntryId)
        .single();
    if (fetchError || !entry) {
        return {
            success: false,
            from_state: 'waiting',
            to_state: toState,
            queue_entry_id: queueEntryId,
            user_id: '',
            error: `Queue entry not found: ${fetchError?.message || 'not found'}`,
        };
    }
    const fromState = entry.state;
    // Validate transition
    if (!isValidTransition(fromState, toState)) {
        return {
            success: false,
            from_state: fromState,
            to_state: toState,
            queue_entry_id: queueEntryId,
            user_id: entry.user_id,
            error: `Invalid transition from ${fromState} to ${toState}`,
        };
    }
    // Build update object based on target state
    const updateData = buildUpdateData(toState, context);
    // Update queue entry with conditional check on current state
    const { data: updated, error: updateError } = await supabase
        .from('queue_entries')
        .update({
        state: toState,
        updated_at: new Date().toISOString(),
        ...updateData,
    })
        .eq('id', queueEntryId)
        .eq('state', fromState) // Optimistic lock - only update if state hasn't changed
        .select()
        .single();
    if (updateError || !updated) {
        return {
            success: false,
            from_state: fromState,
            to_state: toState,
            queue_entry_id: queueEntryId,
            user_id: entry.user_id,
            error: `Failed to update state (may have been modified concurrently): ${updateError?.message || 'no rows updated'}`,
        };
    }
    // Log state change
    await logStateChange(entry.user_id, queueEntryId, fromState, toState, context.trigger_type, context.trigger_details);
    // Handle side effects for specific transitions
    await handleTransitionSideEffects(entry, fromState, toState, context);
    return {
        success: true,
        from_state: fromState,
        to_state: toState,
        queue_entry_id: queueEntryId,
        user_id: entry.user_id,
    };
}
// ============================================================================
// UPDATE DATA BUILDERS
// ============================================================================
/**
 * Build the update data object based on the target state
 */
function buildUpdateData(toState, context) {
    const now = new Date().toISOString();
    switch (toState) {
        case 'invited':
            return {
                invited_at: now,
            };
        case 'ready':
            return {
                deposit_paid_at: now,
            };
        case 'active':
            return {
                queue_entered_at: now,
                // Clear booking fields if returning from booking state
                booking_bot_id: null,
                booking_started_at: null,
                booking_slot_id: null,
            };
        case 'booking':
            return {
                booking_bot_id: context.booking_bot_id,
                booking_started_at: now,
                booking_slot_id: context.booking_slot_id,
            };
        case 'booked':
            return {
                booked_at: now,
                // Clear booking tracking fields
                booking_bot_id: null,
                booking_started_at: null,
                booking_slot_id: null,
            };
        case 'payment_issue':
            return {
                // Clear booking fields
                booking_bot_id: null,
                booking_started_at: null,
                booking_slot_id: null,
            };
        case 'waiting':
            return {
                // Clear invite timestamp when returning to waiting
                invited_at: null,
            };
        default:
            return {};
    }
}
// ============================================================================
// STATE CHANGE LOGGING
// ============================================================================
/**
 * Log a state change to user_state_history
 */
async function logStateChange(userId, queueEntryId, fromState, toState, triggerType, triggerDetails) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { error } = await supabase
        .from('user_state_history')
        .insert({
        user_id: userId,
        queue_entry_id: queueEntryId,
        from_state: fromState,
        to_state: toState,
        trigger_type: triggerType,
        trigger_details: triggerDetails || null,
    });
    if (error) {
        // Log but don't fail the transition
        console.error(`Failed to log state change: ${error.message}`);
    }
}
// ============================================================================
// SIDE EFFECTS
// ============================================================================
/**
 * Handle side effects for specific state transitions
 */
async function handleTransitionSideEffects(entry, fromState, toState, context) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    // Create booking record when transitioning to booked
    if (toState === 'booked' && context.appointment_date && context.appointment_time) {
        await supabase
            .from('bookings')
            .insert({
            user_id: entry.user_id,
            queue_entry_id: entry.id,
            location_id: entry.location_id,
            appointment_date: context.appointment_date,
            appointment_time: context.appointment_time,
            dmv_confirmation_number: context.dmv_confirmation_number || null,
            status: 'booked',
            cancel_window_ends_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min window
            booking_fee_cents: context.booking_fee_cents || 0,
            stripe_charge_id: context.stripe_charge_id || null,
        });
    }
    // Update booking status when confirming
    if (toState === 'confirmed' && fromState === 'booked') {
        await supabase
            .from('bookings')
            .update({ status: 'confirmed' })
            .eq('queue_entry_id', entry.id)
            .eq('status', 'booked');
    }
    // Update booking status when canceling from booked state
    if (toState === 'canceled' && fromState === 'booked') {
        await supabase
            .from('bookings')
            .update({ status: 'canceled' })
            .eq('queue_entry_id', entry.id)
            .eq('status', 'booked');
    }
    // Update booking status when completing
    if (toState === 'completed' && fromState === 'confirmed') {
        await supabase
            .from('bookings')
            .update({ status: 'completed' })
            .eq('queue_entry_id', entry.id)
            .eq('status', 'confirmed');
    }
}
// ============================================================================
// BULK OPERATIONS
// ============================================================================
/**
 * Transition multiple queue entries to a new state.
 * Used for batch operations like expiring old invites.
 *
 * @param queueEntryIds - Array of queue entry IDs
 * @param toState - Target state for all entries
 * @param context - Transition context
 */
async function bulkTransitionState(queueEntryIds, toState, context) {
    const results = [];
    let success = 0;
    let failed = 0;
    for (const id of queueEntryIds) {
        const result = await transitionState(id, toState, context);
        results.push(result);
        if (result.success) {
            success++;
        }
        else {
            failed++;
        }
    }
    return { success, failed, results };
}
// ============================================================================
// STATE QUERIES
// ============================================================================
/**
 * Get the current state of a queue entry
 */
async function getQueueEntryState(queueEntryId) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('queue_entries')
        .select('state')
        .eq('id', queueEntryId)
        .single();
    if (error || !data) {
        return null;
    }
    return data.state;
}
/**
 * Check if a queue entry is in a terminal state
 */
async function isInTerminalState(queueEntryId) {
    const state = await getQueueEntryState(queueEntryId);
    return state !== null && exports.TERMINAL_STATES.includes(state);
}
