"use strict";
// Database operations for customers
// See IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md Section 5.1
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchCustomerById = fetchCustomerById;
exports.fetchCustomerByPhone = fetchCustomerByPhone;
exports.upsertCustomer = upsertCustomer;
const supabase_client_1 = require("./supabase_client");
async function fetchCustomerById(customerId) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('id', customerId)
        .maybeSingle();
    if (error) {
        throw new Error(`Failed to fetch customer ${customerId}: ${error.message}`);
    }
    if (!data) {
        return null;
    }
    return {
        id: data.id,
        phone: data.phone,
        email: data.email,
        created_at: new Date(data.created_at),
    };
}
async function fetchCustomerByPhone(phone) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('phone', phone)
        .maybeSingle();
    if (error) {
        throw new Error(`Failed to fetch customer by phone ${phone}: ${error.message}`);
    }
    if (!data) {
        return null;
    }
    return {
        id: data.id,
        phone: data.phone,
        email: data.email,
        created_at: new Date(data.created_at),
    };
}
async function upsertCustomer(params) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('customers')
        .upsert({
        phone: params.phone,
        email: params.email ?? null,
    }, { onConflict: 'phone' })
        .select()
        .single();
    if (error) {
        throw new Error(`Failed to upsert customer with phone ${params.phone}: ${error.message}`);
    }
    return {
        id: data.id,
        phone: data.phone,
        email: data.email,
        created_at: new Date(data.created_at),
    };
}
//# sourceMappingURL=customers.js.map
