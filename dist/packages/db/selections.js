"use strict";
// Database operations for user_target_window_selections
// See CLAUDE_IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md Section 5.3
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchUserSelection = fetchUserSelection;
exports.upsertUserSelection = upsertUserSelection;
const supabase_client_1 = require("./supabase_client");
async function fetchUserSelection(customerId) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('user_target_window_selections')
        .select('*')
        .eq('customer_id', customerId)
        .maybeSingle();
    if (error) {
        throw new Error(`Failed to fetch user selection for customer ${customerId}: ${error.message}`);
    }
    if (!data) {
        return null;
    }
    return {
        customer_id: data.customer_id,
        timezone: data.timezone,
        date_horizon_key: data.date_horizon_key,
        weekday_rule_key: data.weekday_rule_key,
        custom_weekdays: data.custom_weekdays || [],
        time_block_keys: data.time_block_keys || [],
        updated_at: new Date(data.updated_at),
    };
}
async function upsertUserSelection(selection) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('user_target_window_selections')
        .upsert({
        customer_id: selection.customer_id,
        timezone: selection.timezone,
        date_horizon_key: selection.date_horizon_key,
        weekday_rule_key: selection.weekday_rule_key,
        custom_weekdays: selection.custom_weekdays,
        time_block_keys: selection.time_block_keys,
        updated_at: new Date().toISOString(),
    })
        .select()
        .single();
    if (error) {
        throw new Error(`Failed to upsert user selection for customer ${selection.customer_id}: ${error.message}`);
    }
    return {
        customer_id: data.customer_id,
        timezone: data.timezone,
        date_horizon_key: data.date_horizon_key,
        weekday_rule_key: data.weekday_rule_key,
        custom_weekdays: data.custom_weekdays || [],
        time_block_keys: data.time_block_keys || [],
        updated_at: new Date(data.updated_at),
    };
}
//# sourceMappingURL=selections.js.map