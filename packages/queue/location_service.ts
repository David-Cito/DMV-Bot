// Location Service for Queue System V2
// See openspec/specs/database/spec.md

import type { Location, PricingTier, PricingConfig } from '../core/types';
import { getSupabaseClient } from '../db/supabase_client';

// ============================================================================
// LOCATION CODE LOOKUPS (Database-backed)
// ============================================================================

/**
 * Get location code from display name (database lookup)
 * @returns Location code or null if not found
 */
export async function getLocationCode(name: string): Promise<string | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('locations')
    .select('code')
    .ilike('name', name)
    .single();

  if (error || !data) {
    return null;
  }

  return data.code;
}

/**
 * Get location display name from code (database lookup)
 * @returns Location name or null if not found
 */
export async function getLocationName(code: string): Promise<string | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('locations')
    .select('name')
    .eq('code', code)
    .single();

  if (error || !data) {
    return null;
  }

  return data.name;
}

/**
 * Get a location by its code
 */
export async function getLocationByCode(code: string): Promise<Location | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .eq('code', code)
    .single();

  if (error || !data) {
    return null;
  }

  return mapLocation(data);
}

// ============================================================================
// LOCATION OPERATIONS
// ============================================================================

/**
 * Get a location by ID
 */
export async function getLocation(locationId: string): Promise<Location | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .eq('id', locationId)
    .single();

  if (error || !data) {
    return null;
  }

  return mapLocation(data);
}

/**
 * Get a location by name (case-insensitive)
 */
export async function getLocationByName(name: string): Promise<Location | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .ilike('name', name)
    .single();

  if (error || !data) {
    return null;
  }

  return mapLocation(data);
}

/**
 * Get all active locations
 */
export async function getActiveLocations(): Promise<Location[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch locations: ${error.message}`);
  }

  return (data || []).map(mapLocation);
}

/**
 * Get all locations (including inactive)
 */
export async function getAllLocations(): Promise<Location[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .order('name', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch locations: ${error.message}`);
  }

  return (data || []).map(mapLocation);
}

/**
 * Update location settings
 */
export async function updateLocation(
  locationId: string,
  updates: Partial<Pick<Location, 'queue_size_limit' | 'pricing_tier' | 'is_active'>>
): Promise<Location> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('locations')
    .update(updates)
    .eq('id', locationId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update location: ${error.message}`);
  }

  return mapLocation(data);
}

// ============================================================================
// PRICING
// ============================================================================

/**
 * Get pricing for a location and tier combination
 */
export async function getPricing(
  pricingTier: PricingTier,
  userTier: 'priority' | 'flexible'
): Promise<PricingConfig> {
  const supabase = getSupabaseClient();

  const configKey = `pricing_${pricingTier}_${userTier}`;

  const { data, error } = await supabase
    .from('admin_config')
    .select('value')
    .eq('key', configKey)
    .single();

  if (error || !data) {
    // Return defaults if config not found
    return getDefaultPricing(pricingTier, userTier);
  }

  const value = data.value as PricingConfig;
  return {
    deposit_cents: value.deposit_cents,
    booking_fee_cents: value.booking_fee_cents,
  };
}

/**
 * Get pricing for a specific location and user tier
 */
export async function getLocationPricing(
  locationId: string,
  userTier: 'priority' | 'flexible'
): Promise<PricingConfig> {
  const location = await getLocation(locationId);
  if (!location) {
    throw new Error(`Location not found: ${locationId}`);
  }

  return getPricing(location.pricing_tier, userTier);
}

/**
 * Default pricing if config not found
 */
function getDefaultPricing(
  pricingTier: PricingTier,
  userTier: 'priority' | 'flexible'
): PricingConfig {
  if (pricingTier === 'high_traffic') {
    return userTier === 'priority'
      ? { deposit_cents: 1500, booking_fee_cents: 4000 }
      : { deposit_cents: 1000, booking_fee_cents: 3500 };
  } else {
    return userTier === 'priority'
      ? { deposit_cents: 1000, booking_fee_cents: 3000 }
      : { deposit_cents: 500, booking_fee_cents: 2500 };
  }
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Map database row to Location type
 */
function mapLocation(row: any): Location {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    pricing_tier: row.pricing_tier as PricingTier,
    queue_size_limit: row.queue_size_limit,
    is_active: row.is_active,
  };
}
