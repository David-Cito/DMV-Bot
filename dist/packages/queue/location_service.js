"use strict";
// Location Service for Queue System V2
// See openspec/specs/database/spec.md
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLocationCode = getLocationCode;
exports.getLocationName = getLocationName;
exports.getLocationByCode = getLocationByCode;
exports.getLocation = getLocation;
exports.getLocationByName = getLocationByName;
exports.getActiveLocations = getActiveLocations;
exports.getAllLocations = getAllLocations;
exports.updateLocation = updateLocation;
exports.getPricing = getPricing;
exports.getLocationPricing = getLocationPricing;
const supabase_client_1 = require("../db/supabase_client");
// ============================================================================
// LOCATION CODE LOOKUPS (Database-backed)
// ============================================================================
/**
 * Get location code from display name (database lookup)
 * @returns Location code or null if not found
 */
async function getLocationCode(name) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
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
async function getLocationName(code) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
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
async function getLocationByCode(code) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
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
async function getLocation(locationId) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
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
async function getLocationByName(name) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
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
async function getActiveLocations() {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
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
async function getAllLocations() {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
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
async function updateLocation(locationId, updates) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
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
async function getPricing(pricingTier, userTier) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
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
    const value = data.value;
    return {
        deposit_cents: value.deposit_cents,
        booking_fee_cents: value.booking_fee_cents,
    };
}
/**
 * Get pricing for a specific location and user tier
 */
async function getLocationPricing(locationId, userTier) {
    const location = await getLocation(locationId);
    if (!location) {
        throw new Error(`Location not found: ${locationId}`);
    }
    return getPricing(location.pricing_tier, userTier);
}
/**
 * Default pricing if config not found
 */
function getDefaultPricing(pricingTier, userTier) {
    if (pricingTier === 'high_traffic') {
        return userTier === 'priority'
            ? { deposit_cents: 1500, booking_fee_cents: 4000 }
            : { deposit_cents: 1000, booking_fee_cents: 3500 };
    }
    else {
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
function mapLocation(row) {
    return {
        id: row.id,
        name: row.name,
        code: row.code,
        pricing_tier: row.pricing_tier,
        queue_size_limit: row.queue_size_limit,
        is_active: row.is_active,
    };
}
//# sourceMappingURL=location_service.js.map