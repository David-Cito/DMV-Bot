"use strict";
// Slot Lock Service for Queue System V2
// See openspec/specs/queue-mechanics/spec.md - Slot Locking
Object.defineProperty(exports, "__esModule", { value: true });
exports.acquireSlotLock = acquireSlotLock;
exports.releaseSlotLock = releaseSlotLock;
exports.getSlotLock = getSlotLock;
exports.isSlotLocked = isSlotLocked;
exports.getActiveLocksForLocation = getActiveLocksForLocation;
exports.releaseAllLocksForBot = releaseAllLocksForBot;
const supabase_client_1 = require("../db/supabase_client");
const slot_keys_1 = require("../core/slot_keys");
// ============================================================================
// SLOT LOCK OPERATIONS
// ============================================================================
/**
 * Acquire a lock on a slot for booking.
 * Uses the database function for atomic acquisition.
 *
 * @param locationId - Location ID
 * @param slotDate - Date string (YYYY-MM-DD)
 * @param slotTime - Time string (HH:MM:SS)
 * @param botId - Bot ID acquiring the lock
 * @param ttlSeconds - Lock TTL in seconds (default 300 = 5 min)
 * @returns true if lock acquired, false if already locked
 */
async function acquireSlotLock(locationId, slotDate, slotTime, botId, ttlSeconds = 300) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const lockKey = (0, slot_keys_1.buildSlotKey)(locationId, slotDate, slotTime);
    const { data, error } = await supabase.rpc('acquire_slot_lock', {
        p_lock_key: lockKey,
        p_bot_id: botId,
        p_ttl_seconds: ttlSeconds,
    });
    if (error) {
        console.error(`Failed to acquire slot lock: ${error.message}`);
        return false;
    }
    return data === true;
}
/**
 * Release a slot lock.
 *
 * @param locationId - Location ID
 * @param slotDate - Date string (YYYY-MM-DD)
 * @param slotTime - Time string (HH:MM:SS)
 * @param botId - Bot ID releasing the lock
 * @returns true if lock was released, false if lock didn't exist or wasn't owned
 */
async function releaseSlotLock(locationId, slotDate, slotTime, botId) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const lockKey = (0, slot_keys_1.buildSlotKey)(locationId, slotDate, slotTime);
    const { data, error } = await supabase.rpc('release_slot_lock', {
        p_lock_key: lockKey,
        p_bot_id: botId,
    });
    if (error) {
        console.error(`Failed to release slot lock: ${error.message}`);
        return false;
    }
    return data === true;
}
/**
 * Check if a slot is currently locked.
 *
 * @param locationId - Location ID
 * @param slotDate - Date string (YYYY-MM-DD)
 * @param slotTime - Time string (HH:MM:SS)
 * @returns The lock if exists and not expired, null otherwise
 */
async function getSlotLock(locationId, slotDate, slotTime) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const lockKey = (0, slot_keys_1.buildSlotKey)(locationId, slotDate, slotTime);
    const { data, error } = await supabase
        .from('slot_locks')
        .select('*')
        .eq('lock_key', lockKey)
        .gt('expires_at', new Date().toISOString())
        .single();
    if (error || !data) {
        return null;
    }
    return {
        lock_key: data.lock_key,
        locked_by_bot_id: data.locked_by_bot_id,
        locked_at: new Date(data.locked_at),
        expires_at: new Date(data.expires_at),
    };
}
/**
 * Check if a slot is locked (simple boolean check).
 */
async function isSlotLocked(locationId, slotDate, slotTime) {
    const lock = await getSlotLock(locationId, slotDate, slotTime);
    return lock !== null;
}
/**
 * Get all active locks for a location.
 */
async function getActiveLocksForLocation(locationId) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    // Lock keys start with locationId
    const { data, error } = await supabase
        .from('slot_locks')
        .select('*')
        .like('lock_key', `${locationId}|%`)
        .gt('expires_at', new Date().toISOString());
    if (error) {
        throw new Error(`Failed to fetch locks: ${error.message}`);
    }
    return (data || []).map((row) => ({
        lock_key: row.lock_key,
        locked_by_bot_id: row.locked_by_bot_id,
        locked_at: new Date(row.locked_at),
        expires_at: new Date(row.expires_at),
    }));
}
/**
 * Force release all locks held by a bot.
 * Used when a bot crashes and needs cleanup.
 */
async function releaseAllLocksForBot(botId) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('slot_locks')
        .delete()
        .eq('locked_by_bot_id', botId)
        .select();
    if (error) {
        throw new Error(`Failed to release locks: ${error.message}`);
    }
    return data?.length || 0;
}
//# sourceMappingURL=slot_lock_service.js.map