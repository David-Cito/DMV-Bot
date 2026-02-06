#!/usr/bin/env node
/**
 * DMV Slot Notification Script
 *
 * Sends Discord notifications for:
 * - Slots that just appeared (first_seen = last_seen in latest scan)
 * - Slots that disappeared (last_seen < max(last_seen))
 *
 * Uses the existing slot_states table without any database changes.
 */

const { createClient } = require('@supabase/supabase-js');

// ============================================================================
// CONFIGURATION
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const DISCORD_MENTION_USER_ID = process.env.DISCORD_MENTION_USER_ID || '';
const NOTIFY_TEST = (process.env.DMV_NOTIFY_TEST || '').toLowerCase() === 'true';

const INSTANT_ALERT_DAYS = 14;
const APPT_URL = 'https://alohaq.honolulu.gov/';
const HST_TIMEZONE = 'Pacific/Honolulu';

// Short names for Discord messages
const LOCATION_SHORT_NAMES = {
  'Downtown Satellite City Hall': 'Downtown',
  'Hawaii Kai Satellite City Hall': 'Hawaii Kai',
  'Pearlridge Satellite City Hall': 'Pearlridge',
  'Windward City Satellite City Hall': 'Windward',
};

// ============================================================================
// ENVIRONMENT VALIDATION
// ============================================================================

function validateEnv() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Supabase env vars not set; exiting.');
    process.exit(1);
  }

  if (!DISCORD_WEBHOOK_URL) {
    console.error('DISCORD_WEBHOOK_URL not set; exiting.');
    process.exit(1);
  }
}

// ============================================================================
// DATE UTILITIES
// ============================================================================

function getHstToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: HST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function normalizeDate(date) {
  if (!date) return null;
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function formatPrettyDate(dateStr) {
  const normalized = normalizeDate(dateStr);
  if (!normalized) return String(dateStr || '');
  const d = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatPrettyTime(timeStr) {
  if (!timeStr) return '';
  // Handle HH:mm:ss or HH:mm format
  const parts = timeStr.split(':');
  const hourNum = Number(parts[0]);
  const min = parts[1] || '00';
  if (Number.isNaN(hourNum)) return timeStr;
  const ampm = hourNum >= 12 ? 'PM' : 'AM';
  const hour12 = ((hourNum + 11) % 12) + 1;
  return `${hour12}:${min} ${ampm}`;
}

function daysBetween(date1, date2) {
  const d1Str = normalizeDate(date1);
  const d2Str = normalizeDate(date2);
  if (!d1Str || !d2Str) return 0;
  const d1 = new Date(`${d1Str}T00:00:00Z`);
  const d2 = new Date(`${d2Str}T00:00:00Z`);
  return Math.round((d2.getTime() - d1.getTime()) / (24 * 60 * 60 * 1000));
}

function getShortLocationName(fullName) {
  return LOCATION_SHORT_NAMES[fullName] || fullName || 'Unknown';
}

function formatDuration(firstSeen, lastSeen) {
  const first = new Date(firstSeen);
  const last = new Date(lastSeen);
  const diffMs = last.getTime() - first.getTime();
  const diffMinutes = Math.round(diffMs / (1000 * 60));

  if (diffMinutes < 60) {
    return `~${diffMinutes} min`;
  } else {
    const hours = Math.round(diffMinutes / 60);
    return `~${hours} hr${hours === 1 ? '' : 's'}`;
  }
}

// ============================================================================
// DATABASE QUERIES
// ============================================================================

async function getLatestScanTime(supabase) {
  const { data, error } = await supabase
    .from('slot_states')
    .select('last_seen')
    .order('last_seen', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.last_seen || null;
}

async function getNewSlots(supabase, latestScanTime) {
  // Slots where first_seen = last_seen at the latest scan time
  // These are slots that appeared in this scan
  const { data, error } = await supabase
    .from('slot_states')
    .select(`
      location_id,
      date,
      time,
      first_seen,
      last_seen,
      locations!inner(name)
    `)
    .eq('last_seen', latestScanTime)
    .eq('first_seen', latestScanTime)
    .order('date', { ascending: true })
    .order('time', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getDisappearedSlots(supabase, latestScanTime) {
  // Slots not seen in the latest scan (last_seen is older)
  // We look for slots that were last seen in the previous scan
  const { data, error } = await supabase
    .from('slot_states')
    .select(`
      location_id,
      date,
      time,
      first_seen,
      last_seen,
      locations!inner(name)
    `)
    .lt('last_seen', latestScanTime)
    .gte('date', getHstToday()) // Only future appointments
    .order('date', { ascending: true })
    .order('time', { ascending: true });

  if (error) throw error;
  return data || [];
}

// ============================================================================
// GROUPING HELPERS
// ============================================================================

function groupByLocation(slots) {
  const grouped = {};
  for (const slot of slots) {
    const locationName = slot.locations?.name || 'Unknown';
    if (!grouped[locationName]) {
      grouped[locationName] = [];
    }
    grouped[locationName].push(slot);
  }
  return grouped;
}

// ============================================================================
// DISCORD HELPERS
// ============================================================================

async function sendDiscordMessage(content, ping = false) {
  const body = {
    content,
  };

  if (ping && DISCORD_MENTION_USER_ID) {
    body.allowed_mentions = { users: [DISCORD_MENTION_USER_ID] };
  }

  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Discord webhook failed: ${res.status} ${text}`.trim());
  }
}

// ============================================================================
// NOTIFICATION LOGIC
// ============================================================================

async function sendNotifications(supabase) {
  const today = getHstToday();

  // Get the latest scan time
  const latestScanTime = await getLatestScanTime(supabase);
  if (!latestScanTime) {
    console.log('No scan data found in slot_states table.');
    return { appeared: 0, disappeared: 0 };
  }

  console.log(`Latest scan time: ${latestScanTime}`);

  // Get new and disappeared slots
  const [newSlots, disappearedSlots] = await Promise.all([
    getNewSlots(supabase, latestScanTime),
    getDisappearedSlots(supabase, latestScanTime),
  ]);

  // Filter to slots within INSTANT_ALERT_DAYS
  const nearNewSlots = newSlots.filter(slot => {
    const daysAway = daysBetween(today, slot.date);
    return daysAway >= 0 && daysAway <= INSTANT_ALERT_DAYS;
  });

  const nearDisappearedSlots = disappearedSlots.filter(slot => {
    const daysAway = daysBetween(today, slot.date);
    return daysAway >= 0 && daysAway <= INSTANT_ALERT_DAYS;
  });

  console.log(`Found ${nearNewSlots.length} new slots, ${nearDisappearedSlots.length} disappeared slots within ${INSTANT_ALERT_DAYS} days`);

  // Send APPEARED notification
  if (nearNewSlots.length > 0 || NOTIFY_TEST) {
    const slotsToNotify = nearNewSlots.length > 0 ? nearNewSlots : [{
      locations: { name: 'Test Location' },
      date: today,
      time: '10:00:00',
    }];

    const grouped = groupByLocation(slotsToNotify);
    const lines = [];

    if (DISCORD_MENTION_USER_ID) {
      lines.push(`<@${DISCORD_MENTION_USER_ID}>`);
    }
    lines.push(`**DMV Slots Appeared!**${NOTIFY_TEST && nearNewSlots.length === 0 ? ' (TEST)' : ''}`);
    lines.push('');

    for (const [locationName, slots] of Object.entries(grouped)) {
      const shortName = getShortLocationName(locationName);
      const countLabel = `${slots.length} new`;
      lines.push(`**${shortName}** (${countLabel})`);
      for (const slot of slots) {
        const daysAway = daysBetween(today, slot.date);
        lines.push(`  - ${formatPrettyDate(slot.date)} - ${formatPrettyTime(slot.time)} (${daysAway} days)`);
      }
      lines.push('');
    }

    lines.push(`Book now: ${APPT_URL}`);

    await sendDiscordMessage(lines.join('\n'), true);
    console.log('Sent APPEARED notification');
  }

  // Send GONE notification
  if (nearDisappearedSlots.length > 0) {
    const grouped = groupByLocation(nearDisappearedSlots);
    const lines = [];

    if (DISCORD_MENTION_USER_ID) {
      lines.push(`<@${DISCORD_MENTION_USER_ID}>`);
    }
    lines.push('**DMV Slots Taken!**');
    lines.push('');

    for (const [locationName, slots] of Object.entries(grouped)) {
      const shortName = getShortLocationName(locationName);
      const countLabel = `${slots.length} gone`;
      lines.push(`**${shortName}** (${countLabel})`);
      for (const slot of slots) {
        const duration = formatDuration(slot.first_seen, slot.last_seen);
        lines.push(`  - ${formatPrettyDate(slot.date)} - ${formatPrettyTime(slot.time)} - lasted ${duration}`);
      }
      lines.push('');
    }

    lines.push('These appointments were booked or removed.');

    await sendDiscordMessage(lines.join('\n'), true);
    console.log('Sent GONE notification');
  }

  return {
    appeared: nearNewSlots.length,
    disappeared: nearDisappearedSlots.length,
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  validateEnv();

  console.log('[DMVNotify] Starting notification check...');
  console.log(`[DMVNotify] Test mode: ${NOTIFY_TEST}`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const result = await sendNotifications(supabase);
    console.log(`[DMVNotify] Done. Appeared: ${result.appeared}, Disappeared: ${result.disappeared}`);
  } catch (error) {
    console.error('[DMVNotify] Error:', error.message || error);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

main();
