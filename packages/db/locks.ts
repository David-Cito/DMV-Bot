// Database operations for booking_locks
// See IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md Section 6.3

import type { BookingLock } from '../core/types';
import { getSupabaseClient } from './supabase_client';

/**
 * Attempts to acquire a booking lock using the acquire_booking_lock RPC function.
 *
 * The RPC function:
 * - Uses database now() for all time comparisons
 * - Upserts lock only if no row exists OR locked_until < now()
 * - Returns true if acquired, false otherwise (does not throw on contention)
 * - Is atomic to prevent race conditions
 */
export async function acquireLock(
  lockKey: string,
  ownerRunId: string,
  ttlSeconds: number
): Promise<boolean> {
  const supabase = getSupabaseClient();
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
export async function releaseLock(lockKey: string): Promise<void> {
  const supabase = getSupabaseClient();
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
export async function fetchLock(lockKey: string): Promise<BookingLock | null> {
  const supabase = getSupabaseClient();
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

