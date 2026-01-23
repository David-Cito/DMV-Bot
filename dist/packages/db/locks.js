"use strict";
// Database operations for booking_locks
// See CLAUDE_IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md Section 6.3
Object.defineProperty(exports, "__esModule", { value: true });
exports.acquireLock = acquireLock;
exports.releaseLock = releaseLock;
exports.fetchLock = fetchLock;
const supabase_client_1 = require("./supabase_client");
/**
 * Attempts to acquire a booking lock using the acquire_booking_lock RPC function.
 *
 * The RPC function:
 * - Uses database now() for all time comparisons
 * - Upserts lock only if no row exists OR locked_until < now()
 * - Returns true if acquired, false otherwise (does not throw on contention)
 * - Is atomic to prevent race conditions
 */
async function acquireLock(lockKey, ownerRunId, ttlSeconds) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase.rpc('acquire_booking_lock', {
        p_lock_key: lockKey,
        p_owner_run_id: ownerRunId,
        p_ttl_seconds: ttlSeconds,
    });
    if (error) {
        throw new Error(`Failed to acquire lock ${lockKey}: ${error.message}`);
    }
    return data === true;
}
/**
 * Releases a booking lock by setting locked_until to now.
 * This allows immediate acquisition by other processes.
 */
async function releaseLock(lockKey) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { error } = await supabase
        .from('booking_locks')
        .update({
        locked_until: new Date().toISOString(),
    })
        .eq('lock_key', lockKey);
    if (error) {
        throw new Error(`Failed to release lock ${lockKey}: ${error.message}`);
    }
}
/**
 * Fetches a booking lock by its key.
 */
async function fetchLock(lockKey) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('booking_locks')
        .select('*')
        .eq('lock_key', lockKey)
        .maybeSingle();
    if (error) {
        throw new Error(`Failed to fetch lock ${lockKey}: ${error.message}`);
    }
    if (!data) {
        return null;
    }
    return {
        lock_key: data.lock_key,
        locked_until: new Date(data.locked_until),
        owner_run_id: data.owner_run_id,
    };
}
//# sourceMappingURL=locks.js.map