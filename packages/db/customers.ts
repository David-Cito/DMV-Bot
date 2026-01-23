// Database operations for customers
// See CLAUDE_IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md Section 5.1

import type { Customer } from '../core/types';
import { getSupabaseClient } from './supabase_client';

export async function fetchCustomerById(customerId: string): Promise<Customer | null> {
  const supabase = getSupabaseClient();
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

export async function fetchCustomerByPhone(phone: string): Promise<Customer | null> {
  const supabase = getSupabaseClient();
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

export async function upsertCustomer(params: {
  phone: string;
  email?: string;
}): Promise<Customer> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('customers')
    .upsert(
      {
        phone: params.phone,
        email: params.email ?? null,
      },
      { onConflict: 'phone' }
    )
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
