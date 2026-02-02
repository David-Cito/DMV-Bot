"use strict";
// User Service for Queue System V2
// See openspec/specs/database/spec.md
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUser = createUser;
exports.getUser = getUser;
exports.getUserByPhone = getUserByPhone;
exports.getOrCreateUser = getOrCreateUser;
exports.updateUser = updateUser;
exports.setStripeCustomerId = setStripeCustomerId;
exports.getUserWithQueueInfo = getUserWithQueueInfo;
const supabase_client_1 = require("../db/supabase_client");
/**
 * Create a new user
 */
async function createUser(params) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('users')
        .insert({
        phone: params.phone,
        email: params.email || null,
        name: params.name || null,
        stripe_customer_id: params.stripe_customer_id || null,
    })
        .select()
        .single();
    if (error) {
        throw new Error(`Failed to create user: ${error.message}`);
    }
    return mapUser(data);
}
/**
 * Get a user by ID
 */
async function getUser(userId) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();
    if (error || !data) {
        return null;
    }
    return mapUser(data);
}
/**
 * Get a user by phone number
 */
async function getUserByPhone(phone) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    // Normalize phone number
    const normalizedPhone = normalizePhone(phone);
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('phone', normalizedPhone)
        .single();
    if (error || !data) {
        return null;
    }
    return mapUser(data);
}
/**
 * Get or create a user by phone number
 */
async function getOrCreateUser(phone, name) {
    const normalizedPhone = normalizePhone(phone);
    // Try to find existing user
    const existing = await getUserByPhone(normalizedPhone);
    if (existing) {
        return existing;
    }
    // Create new user
    return createUser({ phone: normalizedPhone, name });
}
/**
 * Update a user's information
 */
async function updateUser(userId, updates) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('users')
        .update({
        ...updates,
        updated_at: new Date().toISOString(),
    })
        .eq('id', userId)
        .select()
        .single();
    if (error) {
        throw new Error(`Failed to update user: ${error.message}`);
    }
    return mapUser(data);
}
/**
 * Update a user's Stripe customer ID
 */
async function setStripeCustomerId(userId, stripeCustomerId) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { error } = await supabase
        .from('users')
        .update({
        stripe_customer_id: stripeCustomerId,
        updated_at: new Date().toISOString(),
    })
        .eq('id', userId);
    if (error) {
        throw new Error(`Failed to set Stripe customer ID: ${error.message}`);
    }
}
/**
 * Get a user with their active queue entry info
 */
async function getUserWithQueueInfo(userId) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data: user, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();
    if (userError || !user) {
        return null;
    }
    // Get active queue entry (not in terminal state)
    const { data: queueEntry } = await supabase
        .from('queue_entries')
        .select(`
      id,
      location_id,
      tier,
      state,
      locations (name)
    `)
        .eq('user_id', userId)
        .not('state', 'in', '("completed","canceled","expired")')
        .single();
    const result = mapUser(user);
    if (queueEntry) {
        result.queue_entry = {
            id: queueEntry.id,
            location_id: queueEntry.location_id,
            location_name: queueEntry.locations?.name || '',
            tier: queueEntry.tier,
            state: queueEntry.state,
        };
    }
    return result;
}
// ============================================================================
// HELPERS
// ============================================================================
/**
 * Normalize phone number to E.164 format
 * Assumes US numbers if no country code provided
 */
function normalizePhone(phone) {
    // Remove all non-digits
    const digits = phone.replace(/\D/g, '');
    // If starts with 1 and has 11 digits, it's a US number with country code
    if (digits.startsWith('1') && digits.length === 11) {
        return `+${digits}`;
    }
    // If 10 digits, assume US and add +1
    if (digits.length === 10) {
        return `+1${digits}`;
    }
    // Otherwise, assume it's already in correct format or add +
    if (!phone.startsWith('+')) {
        return `+${digits}`;
    }
    return phone;
}
/**
 * Map database row to User type
 */
function mapUser(row) {
    return {
        id: row.id,
        phone: row.phone,
        email: row.email,
        name: row.name,
        stripe_customer_id: row.stripe_customer_id,
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at),
    };
}
//# sourceMappingURL=user_service.js.map