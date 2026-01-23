// Batch database operations to avoid N+1 queries
// See IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md

import type { Customer, UserTargetWindowSelection } from '../core/types';
import { getSupabaseClient } from './supabase_client';

/**
 * Fetches user selections for multiple customers in a single query.
 * Returns a Map keyed by customer ID.
 */
export async function fetchUserSelectionsByCustomerIds(
  customerIds: string[]
): Promise<Map<string, UserTargetWindowSelection>> {
  if (customerIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('user_target_window_selections')
    .select('*')
    .in('customer_id', customerIds);

  if (error) {
    throw new Error(`Failed to fetch user selections: ${error.message}`);
  }

  const result = new Map<string, UserTargetWindowSelection>();

  for (const row of data || []) {
    result.set(row.customer_id, {
      customer_id: row.customer_id,
      timezone: row.timezone,
      date_horizon_key: row.date_horizon_key,
      weekday_rule_key: row.weekday_rule_key,
      custom_weekdays: row.custom_weekdays || [],
      time_block_keys: row.time_block_keys || [],
      updated_at: new Date(row.updated_at),
    });
  }

  return result;
}

/**
 * Fetches customers by their IDs in a single query.
 * Returns a Map keyed by customer ID.
 */
export async function fetchCustomersByIds(
  customerIds: string[]
): Promise<Map<string, Customer>> {
  if (customerIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .in('id', customerIds);

  if (error) {
    throw new Error(`Failed to fetch customers: ${error.message}`);
  }

  const result = new Map<string, Customer>();

  for (const row of data || []) {
    result.set(row.id, {
      id: row.id,
      phone: row.phone,
      email: row.email,
      created_at: new Date(row.created_at),
    });
  }

  return result;
}

