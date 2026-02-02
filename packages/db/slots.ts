// Database operations for slot_states (from monitoring bot)
// Queue System V2 - See openspec/specs/ for documentation

import type { SlotState } from '../core/types';
import { getSupabaseClient } from './supabase_client';

/**
 * Fetches recent open slots from the monitoring bot's slot_states table.
 * Used by the booking bot to find available appointments.
 */
export async function fetchRecentOpenSlots(
  locationId: string,
  lookbackMinutes: number = 5
): Promise<SlotState[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('slot_states')
    .select('*')
    .eq('location_id', locationId)
    .gte('last_seen', new Date(Date.now() - lookbackMinutes * 60 * 1000).toISOString())
    .order('first_seen', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch recent open slots: ${error.message}`);
  }

  return (data || [])
    .filter((row: any) => row.date && row.time)
    .map((row: any) => ({
      location_id: row.location_id,
      slot_date: row.date,
      slot_time: normalizeTimeToHHMMSS(row.time),
      first_seen: new Date(row.first_seen),
      last_seen: new Date(row.last_seen),
    }));
}

/**
 * Normalizes a time string to HH:MM:SS format.
 */
function normalizeTimeToHHMMSS(time: string): string {
  if (!time) return '00:00:00';

  if (/^\d{2}:\d{2}:\d{2}$/.test(time)) {
    return time;
  }

  if (/^\d{2}:\d{2}$/.test(time)) {
    return `${time}:00`;
  }

  const parts = time.split(':');
  const hours = (parts[0] || '00').padStart(2, '0');
  const minutes = (parts[1] || '00').padStart(2, '0');
  const seconds = (parts[2] || '00').padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}
