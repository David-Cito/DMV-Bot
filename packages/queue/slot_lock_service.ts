// Slot Lock Service for Queue System V2
// See openspec/specs/queue-mechanics/spec.md - Slot Locking

import type { SlotLock } from '../core/types';
import { getSupabaseClient } from '../db/supabase_client';
import { buildSlotKey } from '../core/slot_keys';

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
export async function acquireSlotLock(
  locationId: string,
  slotDate: string,
  slotTime: string,
  botId: string,
  ttlSeconds: number = 300
): Promise<boolean> {
  const supabase = getSupabaseClient();
  const lockKey = buildSlotKey(locationId, slotDate, slotTime);

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
export async function releaseSlotLock(
  locationId: string,
  slotDate: string,
  slotTime: string,
  botId: string
): Promise<boolean> {
  const supabase = getSupabaseClient();
  const lockKey = buildSlotKey(locationId, slotDate, slotTime);

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
export async function getSlotLock(
  locationId: string,
  slotDate: string,
  slotTime: string
): Promise<SlotLock | null> {
  const supabase = getSupabaseClient();
  const lockKey = buildSlotKey(locationId, slotDate, slotTime);

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
export async function isSlotLocked(
  locationId: string,
  slotDate: string,
  slotTime: string
): Promise<boolean> {
  const lock = await getSlotLock(locationId, slotDate, slotTime);
  return lock !== null;
}

/**
 * Get all active locks for a location.
 */
export async function getActiveLocksForLocation(locationId: string): Promise<SlotLock[]> {
  const supabase = getSupabaseClient();

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
export async function releaseAllLocksForBot(botId: string): Promise<number> {
  const supabase = getSupabaseClient();

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
