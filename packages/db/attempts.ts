// Database operations for booking_attempts
// See CLAUDE_IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md Section 6.2

import type { BookingAttempt, BookingAttemptResult } from '../core/types';
import { getSupabaseClient } from './supabase_client';

export interface InsertBookingAttemptParams {
  customerId: string;
  locationId: string;
  slotDate: string;
  slotTime: string;
  slotDatetimeUtc: Date;
  result: BookingAttemptResult;
  errorCode?: string;
  errorMessage?: string;
  dispatcherRunId: string;
}

export async function insertBookingAttempt(
  params: InsertBookingAttemptParams
): Promise<BookingAttempt> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('booking_attempts')
    .insert({
      customer_id: params.customerId,
      location_id: params.locationId,
      slot_date: params.slotDate,
      slot_time: params.slotTime,
      slot_datetime_utc: params.slotDatetimeUtc.toISOString(),
      result: params.result,
      error_code: params.errorCode ?? null,
      error_message: params.errorMessage ?? null,
      dispatcher_run_id: params.dispatcherRunId,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to insert booking attempt: ${error.message}`);
  }

  return {
    id: data.id,
    customer_id: data.customer_id,
    location_id: data.location_id,
    slot_date: data.slot_date,
    slot_time: data.slot_time,
    slot_datetime_utc: new Date(data.slot_datetime_utc),
    attempt_at: new Date(data.attempt_at),
    result: data.result as BookingAttemptResult,
    error_code: data.error_code,
    error_message: data.error_message,
    dispatcher_run_id: data.dispatcher_run_id,
  };
}

export async function fetchBookingAttemptsByCustomer(
  customerId: string,
  limit?: number
): Promise<BookingAttempt[]> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from('booking_attempts')
    .select('*')
    .eq('customer_id', customerId)
    .order('attempt_at', { ascending: false });

  if (limit !== undefined) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch booking attempts for customer ${customerId}: ${error.message}`);
  }

  return (data || []).map((row) => ({
    id: row.id,
    customer_id: row.customer_id,
    location_id: row.location_id,
    slot_date: row.slot_date,
    slot_time: row.slot_time,
    slot_datetime_utc: new Date(row.slot_datetime_utc),
    attempt_at: new Date(row.attempt_at),
    result: row.result as BookingAttemptResult,
    error_code: row.error_code,
    error_message: row.error_message,
    dispatcher_run_id: row.dispatcher_run_id,
  }));
}
