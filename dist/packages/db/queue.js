"use strict";
// Database operations for queue_entries
// See IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md Section 5 and 8
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchOrderedQueueEntries = fetchOrderedQueueEntries;
exports.fetchQueueEntryByCustomer = fetchQueueEntryByCustomer;
exports.setDepositRequired = setDepositRequired;
exports.expireDeposit = expireDeposit;
exports.updateBookedState = updateBookedState;
const supabase_client_1 = require("./supabase_client");
/**
 * Fetches queue entries ordered by created_at ASC.
 * Only includes entries with status in ('queued', 'deposit_required', 'active').
 */
async function fetchOrderedQueueEntries() {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
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
async function fetchQueueEntryByCustomer(customerId) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
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
async function setDepositRequired(queueEntryId, expiresAt) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
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
async function expireDeposit(queueEntryId) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
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
async function updateBookedState(queueEntryId, locationId, slotDatetime) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
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
function mapRowToQueueEntry(row) {
    return {
        id: row.id,
        customer_id: row.customer_id,
        created_at: new Date(row.created_at),
        status: row.status,
        deposit_status: row.deposit_status,
        deposit_required_at: row.deposit_required_at ? new Date(row.deposit_required_at) : null,
        deposit_paid_at: row.deposit_paid_at ? new Date(row.deposit_paid_at) : null,
        deposit_expires_at: row.deposit_expires_at ? new Date(row.deposit_expires_at) : null,
        booked_at: row.booked_at ? new Date(row.booked_at) : null,
        booked_location_id: row.booked_location_id,
        booked_slot_datetime: row.booked_slot_datetime ? new Date(row.booked_slot_datetime) : null,
    };
}
//# sourceMappingURL=queue.js.map
