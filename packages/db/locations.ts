// Database operations for user_location_preferences and locations
// See CLAUDE_IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md Section 5.4

import type { Location, UserLocationPreference } from '../core/types';
import { getSupabaseClient } from './supabase_client';

export async function fetchLocationById(locationId: string): Promise<Location | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('locations')
    .select('id, name')
    .eq('id', locationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch location ${locationId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return {
    id: data.id,
    name: data.name,
  };
}

export async function fetchUserLocationPreferences(
  customerId: string
): Promise<UserLocationPreference[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('user_location_preferences')
    .select('*')
    .eq('customer_id', customerId);

  if (error) {
    throw new Error(`Failed to fetch location preferences for customer ${customerId}: ${error.message}`);
  }

  return (data || []).map((row) => ({
    customer_id: row.customer_id,
    location_id: row.location_id,
    created_at: new Date(row.created_at),
  }));
}

export async function fetchUserLocationPreferencesByCustomerIds(
  customerIds: string[]
): Promise<Map<string, UserLocationPreference[]>> {
  if (customerIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('user_location_preferences')
    .select('*')
    .in('customer_id', customerIds);

  if (error) {
    throw new Error(`Failed to fetch location preferences for customers: ${error.message}`);
  }

  const result = new Map<string, UserLocationPreference[]>();

  // Initialize empty arrays for all requested customer IDs
  for (const customerId of customerIds) {
    result.set(customerId, []);
  }

  // Group preferences by customer ID
  for (const row of data || []) {
    const pref: UserLocationPreference = {
      customer_id: row.customer_id,
      location_id: row.location_id,
      created_at: new Date(row.created_at),
    };
    const existing = result.get(row.customer_id) || [];
    existing.push(pref);
    result.set(row.customer_id, existing);
  }

  return result;
}

export async function addUserLocationPreference(
  customerId: string,
  locationId: string
): Promise<UserLocationPreference> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('user_location_preferences')
    .insert({
      customer_id: customerId,
      location_id: locationId,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to add location preference for customer ${customerId}: ${error.message}`);
  }

  return {
    customer_id: data.customer_id,
    location_id: data.location_id,
    created_at: new Date(data.created_at),
  };
}

export async function removeUserLocationPreference(
  customerId: string,
  locationId: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('user_location_preferences')
    .delete()
    .eq('customer_id', customerId)
    .eq('location_id', locationId);

  if (error) {
    throw new Error(`Failed to remove location preference for customer ${customerId}: ${error.message}`);
  }
}
