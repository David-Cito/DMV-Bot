// Database operations for queue_watermarks
// See IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md Section 6.1

import type { QueueWatermark } from '../core/types';
import { getSupabaseClient } from './supabase_client';

export async function fetchWatermark(key: string): Promise<QueueWatermark | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('queue_watermarks')
    .select('*')
    .eq('key', key)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch watermark ${key}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return {
    key: data.key,
    last_processed_at: new Date(data.last_processed_at),
  };
}

export async function updateWatermark(key: string, lastProcessedAt: Date): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('queue_watermarks')
    .upsert({
      key,
      last_processed_at: lastProcessedAt.toISOString(),
    })
    .eq('key', key);

  if (error) {
    throw new Error(`Failed to update watermark ${key}: ${error.message}`);
  }
}

