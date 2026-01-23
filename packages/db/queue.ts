// Database operations for queue_entries
// See IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md Section 5 and 8

import type { QueueEntry } from '../core/types';
import { getSupabaseClient } from './supabase_client';

/**
 * Fetches queue entries ordered by created_at ASC.
 * Only includes entries with status in ('queued', 'deposit_required', 'active').
 */
export async function fetchOrderedQueueEntries(): Promise<QueueEntry[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('queue_entries')
    .select('*')
    .in('status', ['queued', 'deposit_required', 'active'])
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch ordered queue entries: ${error.message}`);
  }

  return (data || []).map(mapRowToQueueEntry);
}

/**
 * Fetches a queue entry by customer ID.
 */
export async function fetchQueueEntryByCustomer(customerId: string): Promise<QueueEntry | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('queue_entries')
    .select('*')
    .eq('customer_id', customerId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch queue entry for customer ${customerId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapRowToQueueEntry(data);
}

/**
 * Sets deposit as required for a queue entry.
 *
 * Conditional update guards:
 * - Only if deposit_status = 'none' AND status != 'booked'
 *
 * This prevents race conditions where a booking completes while
 * we're trying to request a deposit.
 */
export async function setDepositRequired(
  queueEntryId: string,
  expiresAt: Date
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('queue_entries')
    .update({
      deposit_status: 'required',
      status: 'deposit_required',
      deposit_required_at: new Date().toISOString(),
      deposit_expires_at: expiresAt.toISOString(),
    })
    .eq('id', queueEntryId)
    .eq('deposit_status', 'none')
    .neq('status', 'booked');

  if (error) {
    throw new Error(`Failed to set deposit required for queue entry ${queueEntryId}: ${error.message}`);
  }
}

export async function expireDeposit(queueEntryId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('queue_entries')
    .update({
      deposit_status: 'expired',
      status: 'queued',
    })
    .eq('id', queueEntryId)
    .eq('deposit_status', 'required')
    .lt('deposit_expires_at', new Date().toISOString())
    .neq('status', 'booked');

  if (error) {
    throw new Error(`Failed to expire deposit for queue entry ${queueEntryId}: ${error.message}`);
  }
}

/**
 * Updates a queue entry to booked state.
 */
export async function updateBookedState(
  queueEntryId: string,
  locationId: string,
  slotDatetime: Date
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('queue_entries')
    .update({
      status: 'booked',
      booked_at: new Date().toISOString(),
      booked_location_id: locationId,
      booked_slot_datetime: slotDatetime.toISOString(),
    })
    .eq('id', queueEntryId);

  if (error) {
    throw new Error(`Failed to update booked state for queue entry ${queueEntryId}: ${error.message}`);
  }
}

function mapRowToQueueEntry(row: Record<string, unknown>): QueueEntry {
  return {
    id: row.id as string,
    customer_id: row.customer_id as string,
    created_at: new Date(row.created_at as string),
    status: row.status as QueueEntry['status'],
    deposit_status: row.deposit_status as QueueEntry['deposit_status'],
    deposit_required_at: row.deposit_required_at ? new Date(row.deposit_required_at as string) : null,
    deposit_paid_at: row.deposit_paid_at ? new Date(row.deposit_paid_at as string) : null,
    deposit_expires_at: row.deposit_expires_at ? new Date(row.deposit_expires_at as string) : null,
    booked_at: row.booked_at ? new Date(row.booked_at as string) : null,
    booked_location_id: row.booked_location_id as string | null,
    booked_slot_datetime: row.booked_slot_datetime ? new Date(row.booked_slot_datetime as string) : null,
  };
}

