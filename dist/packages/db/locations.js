"use strict";
// Database operations for user_location_preferences and locations
// See IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md Section 5.4
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchLocationById = fetchLocationById;
exports.fetchUserLocationPreferences = fetchUserLocationPreferences;
exports.fetchUserLocationPreferencesByCustomerIds = fetchUserLocationPreferencesByCustomerIds;
exports.addUserLocationPreference = addUserLocationPreference;
exports.removeUserLocationPreference = removeUserLocationPreference;
const supabase_client_1 = require("./supabase_client");
async function fetchLocationById(locationId) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
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
async function fetchUserLocationPreferences(customerId) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
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
async function fetchUserLocationPreferencesByCustomerIds(customerIds) {
    if (customerIds.length === 0) {
        return new Map();
    }
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('user_location_preferences')
        .select('*')
        .in('customer_id', customerIds);
    if (error) {
        throw new Error(`Failed to fetch location preferences for customers: ${error.message}`);
    }
    const result = new Map();
    // Initialize empty arrays for all requested customer IDs
    for (const customerId of customerIds) {
        result.set(customerId, []);
    }
    // Group preferences by customer ID
    for (const row of data || []) {
        const pref = {
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
async function addUserLocationPreference(customerId, locationId) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
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
async function removeUserLocationPreference(customerId, locationId) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { error } = await supabase
        .from('user_location_preferences')
        .delete()
        .eq('customer_id', customerId)
        .eq('location_id', locationId);
    if (error) {
        throw new Error(`Failed to remove location preference for customer ${customerId}: ${error.message}`);
    }
}
//# sourceMappingURL=locations.js.map
