"use strict";
// Cleanup Service for Queue System V2
// See openspec/specs/analytics/spec.md - Cleanup Jobs section
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetStuckBookings = resetStuckBookings;
exports.expireOldInvites = expireOldInvites;
exports.cleanupExpiredSlotLocks = cleanupExpiredSlotLocks;
exports.expirePaymentIssues = expirePaymentIssues;
exports.processExpiredCancelWindows = processExpiredCancelWindows;
exports.runCleanupJobs = runCleanupJobs;
const supabase_client_1 = require("../db/supabase_client");
const state_machine_1 = require("./state_machine");
// ============================================================================
// STUCK BOOKING RESET
// ============================================================================
/**
 * Reset users stuck in 'booking' state for too long.
 * This handles cases where the booking bot crashed or timed out.
 *
 * @param timeoutMinutes - Minutes after which a booking is considered stuck (default 10)
 * @returns Number of users reset
 */
async function resetStuckBookings(timeoutMinutes = 10) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    // Use the database function for atomic reset
    const { data, error } = await supabase.rpc('reset_stuck_bookings', {
        p_timeout_minutes: timeoutMinutes,
    });
    if (error) {
        console.error(`Failed to reset stuck bookings: ${error.message}`);
        return 0;
    }
    const resetCount = data?.length || 0;
    // Log system events for each reset
    for (const row of data || []) {
        await supabase.from('system_events').insert({
            event_type: 'booking_timeout_reset',
            severity: 'warning',
            user_id: row.user_id,
            details: {
                queue_entry_id: row.queue_entry_id,
                stuck_since: row.stuck_since,
                timeout_minutes: timeoutMinutes,
            },
        });
    }
    return resetCount;
}
// ============================================================================
// EXPIRED INVITES
// ============================================================================
/**
 * Expire invites that haven't been accepted within the time limit.
 * Users are returned to 'waiting' state.
 *
 * @param hoursLimit - Hours after which an invite expires (default 24)
 * @returns Number of invites expired
 */
async function expireOldInvites(hoursLimit = 24) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const cutoff = new Date(Date.now() - hoursLimit * 60 * 60 * 1000).toISOString();
    // Find expired invites
    const { data: expiredInvites, error } = await supabase
        .from('queue_entries')
        .select('id')
        .eq('state', 'invited')
        .lt('invited_at', cutoff);
    if (error) {
        console.error(`Failed to fetch expired invites: ${error.message}`);
        return 0;
    }
    if (!expiredInvites || expiredInvites.length === 0) {
        return 0;
    }
    // Transition each back to waiting
    const ids = expiredInvites.map((e) => e.id);
    const result = await (0, state_machine_1.bulkTransitionState)(ids, 'waiting', {
        trigger_type: 'cleanup',
        trigger_details: { reason: 'invite_expired', hours_limit: hoursLimit },
    });
    return result.success;
}
// ============================================================================
// EXPIRED SLOT LOCKS
// ============================================================================
/**
 * Clean up expired slot locks.
 * Uses the database function for efficiency.
 *
 * @returns Number of locks cleaned up
 */
async function cleanupExpiredSlotLocks() {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase.rpc('cleanup_expired_locks');
    if (error) {
        console.error(`Failed to cleanup expired locks: ${error.message}`);
        return 0;
    }
    return data || 0;
}
// ============================================================================
// PAYMENT ISSUE TIMEOUT
// ============================================================================
/**
 * Expire users who have been in 'payment_issue' state too long.
 *
 * @param daysLimit - Days after which payment_issue expires (default 7)
 * @returns Number of users expired
 */
async function expirePaymentIssues(daysLimit = 7) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const cutoff = new Date(Date.now() - daysLimit * 24 * 60 * 60 * 1000).toISOString();
    // Find users with old payment issues
    const { data: expiredUsers, error } = await supabase
        .from('queue_entries')
        .select('id')
        .eq('state', 'payment_issue')
        .lt('updated_at', cutoff);
    if (error) {
        console.error(`Failed to fetch expired payment issues: ${error.message}`);
        return 0;
    }
    if (!expiredUsers || expiredUsers.length === 0) {
        return 0;
    }
    // Transition each to expired
    const ids = expiredUsers.map((e) => e.id);
    const result = await (0, state_machine_1.bulkTransitionState)(ids, 'expired', {
        trigger_type: 'cleanup',
        trigger_details: { reason: 'payment_issue_timeout', days_limit: daysLimit },
    });
    return result.success;
}
// ============================================================================
// CANCEL WINDOW EXPIRATION
// ============================================================================
/**
 * Process bookings where the cancel window has expired.
 * Transitions from 'booked' to 'confirmed'.
 *
 * @returns Number of bookings confirmed
 */
async function processExpiredCancelWindows() {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const now = new Date().toISOString();
    // Find bookings with expired cancel window
    const { data: expiredBookings, error } = await supabase
        .from('bookings')
        .select('queue_entry_id')
        .eq('status', 'booked')
        .lt('cancel_window_ends_at', now);
    if (error) {
        console.error(`Failed to fetch expired cancel windows: ${error.message}`);
        return 0;
    }
    if (!expiredBookings || expiredBookings.length === 0) {
        return 0;
    }
    // Transition each to confirmed
    const ids = expiredBookings.map((b) => b.queue_entry_id);
    const result = await (0, state_machine_1.bulkTransitionState)(ids, 'confirmed', {
        trigger_type: 'system',
        trigger_details: { reason: 'cancel_window_expired' },
    });
    return result.success;
}
/**
 * Run all cleanup jobs.
 * This should be called periodically (e.g., every 10 minutes).
 */
async function runCleanupJobs() {
    const startTime = Date.now();
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    // Log bot run start
    const { data: botRun } = await supabase
        .from('bot_runs')
        .insert({
        bot_type: 'cleanup',
        started_at: new Date().toISOString(),
    })
        .select()
        .single();
    const results = {
        stuck_bookings_reset: 0,
        invites_expired: 0,
        slot_locks_cleaned: 0,
        payment_issues_expired: 0,
        cancel_windows_processed: 0,
        duration_ms: 0,
    };
    try {
        // Run all cleanup tasks
        results.stuck_bookings_reset = await resetStuckBookings();
        results.invites_expired = await expireOldInvites();
        results.slot_locks_cleaned = await cleanupExpiredSlotLocks();
        results.payment_issues_expired = await expirePaymentIssues();
        results.cancel_windows_processed = await processExpiredCancelWindows();
        results.duration_ms = Date.now() - startTime;
        // Update bot run
        if (botRun) {
            await supabase
                .from('bot_runs')
                .update({
                ended_at: new Date().toISOString(),
                status: 'success',
                duration_ms: results.duration_ms,
            })
                .eq('id', botRun.id);
        }
    }
    catch (error) {
        results.duration_ms = Date.now() - startTime;
        // Log error
        if (botRun) {
            await supabase
                .from('bot_runs')
                .update({
                ended_at: new Date().toISOString(),
                status: 'error',
                error_message: error instanceof Error ? error.message : 'Unknown error',
                duration_ms: results.duration_ms,
            })
                .eq('id', botRun.id);
        }
        throw error;
    }
    return results;
}
