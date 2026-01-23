// Database operations for message_log
// See IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md Section 6.4 and 11

import type { MessageLogEntry, MessageType } from '../core/types';
import { getSupabaseClient } from './supabase_client';

export interface InsertMessageParams {
  customerId: string;
  messageType: MessageType;
  dedupeKey: string;
  metaJson?: Record<string, unknown>;
}

/**
 * Inserts a message with deduplication.
 *
 * - Attempts INSERT into message_log
 * - If error code is 23505 (unique_violation), returns null (message already sent)
 * - Otherwise throws the error
 * - On success, returns the inserted row
 */
export async function insertMessageWithDedupe(
  params: InsertMessageParams
): Promise<MessageLogEntry | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('message_log')
    .insert({
      customer_id: params.customerId,
      message_type: params.messageType,
      dedupe_key: params.dedupeKey,
      meta_json: params.metaJson ?? null,
    })
    .select()
    .single();

  if (error) {
    // Error code 23505 is unique_violation (dedupe key already exists)
    if (error.code === '23505') {
      return null;
    }
    throw new Error(`Failed to insert message: ${error.message}`);
  }

  return {
    id: data.id,
    customer_id: data.customer_id,
    message_type: data.message_type as MessageType,
    sent_at: new Date(data.sent_at),
    dedupe_key: data.dedupe_key,
    meta_json: data.meta_json,
  };
}

export async function fetchMessagesByCustomer(
  customerId: string,
  limit?: number
): Promise<MessageLogEntry[]> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from('message_log')
    .select('*')
    .eq('customer_id', customerId)
    .order('sent_at', { ascending: false });

  if (limit !== undefined) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch messages for customer ${customerId}: ${error.message}`);
  }

  return (data || []).map((row) => ({
    id: row.id,
    customer_id: row.customer_id,
    message_type: row.message_type as MessageType,
    sent_at: new Date(row.sent_at),
    dedupe_key: row.dedupe_key,
    meta_json: row.meta_json,
  }));
}

export async function hasMessageBeenSent(dedupeKey: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('message_log')
    .select('id')
    .eq('dedupe_key', dedupeKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to check if message has been sent: ${error.message}`);
  }

  return data !== null;
}

