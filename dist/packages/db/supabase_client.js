"use strict";
// Supabase client initialization
// See IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md Section 12
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSupabaseClient = getSupabaseClient;
const supabase_js_1 = require("@supabase/supabase-js");
let supabaseClient = null;
function getSupabaseClient() {
    if (!supabaseClient) {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !supabaseKey) {
            throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
        }
        supabaseClient = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
    }
    return supabaseClient;
}
//# sourceMappingURL=supabase_client.js.map
