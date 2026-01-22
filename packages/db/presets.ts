// Database operations for target_window_presets
// See CLAUDE_IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md Section 4

import type { PresetType, TargetWindowPreset } from '../core/types';
import { getSupabaseClient } from './supabase_client';

export async function fetchActivePresetsByType(
  presetType: PresetType
): Promise<TargetWindowPreset[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('target_window_presets')
    .select('*')
    .eq('preset_type', presetType)
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch presets for type ${presetType}: ${error.message}`);
  }

  return (data || []).map(mapRowToPreset);
}

export async function fetchPresetByKey(
  presetType: PresetType,
  key: string
): Promise<TargetWindowPreset | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('target_window_presets')
    .select('*')
    .eq('preset_type', presetType)
    .eq('key', key)
    .eq('active', true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch preset ${presetType}/${key}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapRowToPreset(data);
}

function mapRowToPreset(row: Record<string, unknown>): TargetWindowPreset {
  const base = {
    id: row.id as string,
    preset_type: row.preset_type as PresetType,
    key: row.key as string,
    label: row.label as string,
    active: row.active as boolean,
    sort_order: row.sort_order as number,
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
    rules_json: row.rules_json as Record<string, unknown>,
  };

  // Return with proper typing based on preset_type
  return base as TargetWindowPreset;
}
