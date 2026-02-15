#!/usr/bin/env node
/**
 * DMV Slot Notification Script
 *
 * Supports three notification types:
 * - instant: Immediate alerts for slots that appeared/disappeared within 14 days (pings user)
 * - daily: Daily summary of new slots since last daily notification + supply outlook (no ping)
 * - weekly: Weekly overview of all availability + supply outlook (no ping)
 *
 * Usage:
 *   node scripts/notifications/send-dmv-notifications.js --type=instant
 *   node scripts/notifications/send-dmv-notifications.js --type=daily
 *   node scripts/notifications/send-dmv-notifications.js --type=weekly
 */

const { createClient } = require('@supabase/supabase-js');

// ============================================================================
// CONFIGURATION
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_DRIVER_LICENSE_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;
const DISCORD_MENTION_USER_ID = process.env.DISCORD_MENTION_USER_ID || '';
const NOTIFY_TEST = (process.env.DMV_NOTIFY_TEST || '').toLowerCase() === 'true';

const DISCORD_MAX_LENGTH = 1900; // Discord limit is 2000, use 1900 for safety buffer

const INSTANT_ALERT_DAYS = 14;
const APPT_URL = 'https://alohaq.honolulu.gov/';
const HST_TIMEZONE = 'Pacific/Honolulu';

// Supply outlook thresholds
const SUPPLY_THRESHOLD_SLOTS = 20;        // 20 slots/week = open availability
const PERSISTENCE_THRESHOLD_MINUTES = 15; // 15 minutes minimum persistence

// Known locations for ordering
const DMV_LOCATIONS = ['Downtown', 'Hawaii Kai', 'Pearlridge', 'Windward'];

// Short names for Discord messages
const LOCATION_SHORT_NAMES = {
  'Downtown Satellite City Hall': 'Downtown',
  'Hawaii Kai Satellite City Hall': 'Hawaii Kai',
  'Pearlridge Satellite City Hall': 'Pearlridge',
  'Windward City Satellite City Hall': 'Windward',
};

// ============================================================================
// ARGUMENT PARSING
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  let type = 'instant'; // default

  for (const arg of args) {
    if (arg.startsWith('--type=')) {
      type = arg.split('=')[1];
    } else if (arg === '--type' && args[args.indexOf(arg) + 1]) {
      type = args[args.indexOf(arg) + 1];
    }
  }

  if (!['instant', 'daily', 'weekly'].includes(type)) {
    console.error(`Invalid notification type: ${type}`);
    console.log('Valid types: instant, daily, weekly');
    process.exit(1);
  }

  return { type };
}

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

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function getWeekStart(dateStr) {
  // Return Monday of the week containing dateStr
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
  d.setUTCDate(diff);
  return d.toISOString().slice(0, 10);
}

function formatWeekRange(weekStart) {
  const startDate = new Date(`${weekStart}T00:00:00Z`);
  const endDate = new Date(startDate);
  endDate.setUTCDate(startDate.getUTCDate() + 6);

  const format = (d) => d.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  });

  return `${format(startDate)}-${format(endDate)}`;
}

function getWeekRangeForDisplay() {
  const today = new Date();
  const dayOfWeek = today.getUTCDay();
  const startOfWeek = new Date(today);
  startOfWeek.setUTCDate(today.getUTCDate() - dayOfWeek);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setUTCDate(startOfWeek.getUTCDate() + 6);

  const format = (d) => d.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return `${format(startOfWeek)} - ${format(endOfWeek)}`;
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
// SUPPLY OUTLOOK CALCULATION
// ============================================================================

async function calculateSupplyOutlook(supabase) {
  const today = getHstToday();
  const now = new Date();
  const cutoffTime = new Date(now.getTime() - PERSISTENCE_THRESHOLD_MINUTES * 60 * 1000);

  // Query active slots that have persisted for 15+ minutes (first_seen at least 15 min ago)
  const { data: slots, error } = await supabase
    .from('slot_states')
    .select('date, time, location_id, first_seen, last_seen, locations!inner(name)')
    .gte('date', today)
    .eq('is_active', true) // Only active slots
    .lte('first_seen', cutoffTime.toISOString()) // First seen 15+ min ago
    .order('date', { ascending: true });

  if (error) {
    console.error('[SupplyOutlook] Error querying slots:', error.message);
    return null;
  }

  if (!slots || slots.length === 0) {
    return null;
  }

  // Aggregate by week AND location
  // Structure: { locationName: { weekStart: slotCount } }
  const locationWeeklyData = {};

  for (const slot of slots) {
    const weekStart = getWeekStart(slot.date);
    const locationName = getShortLocationName(slot.locations?.name || 'Unknown');

    if (!locationWeeklyData[locationName]) {
      locationWeeklyData[locationName] = {};
    }
    locationWeeklyData[locationName][weekStart] =
      (locationWeeklyData[locationName][weekStart] || 0) + 1;
  }

  // For each location, find the first week with 20+ slots
  const result = {};

  for (const locationName of DMV_LOCATIONS) {
    const weeklyData = locationWeeklyData[locationName] || {};
    const sortedWeeks = Object.entries(weeklyData).sort((a, b) => a[0].localeCompare(b[0]));

    let foundWeek = null;
    for (const [weekStart, slotCount] of sortedWeeks) {
      if (slotCount >= SUPPLY_THRESHOLD_SLOTS) {
        foundWeek = { weekStart, slots: slotCount };
        break;
      }
    }

    result[locationName] = foundWeek; // null if no open week found
  }

  return result;
}

function formatSupplyOutlookSection(outlook) {
  const today = getHstToday();
  const lines = [];
  lines.push('**Supply Outlook**');

  if (!outlook) {
    lines.push(`No weeks with ${SUPPLY_THRESHOLD_SLOTS}+ slots in scan window`);
    return lines.join('\n');
  }

  // Build list of locations with their outlook data
  const locationEntries = [];
  for (const locationName of DMV_LOCATIONS) {
    const data = outlook[locationName];
    if (data) {
      const daysOut = daysBetween(today, data.weekStart);
      locationEntries.push({
        location: locationName,
        daysOut,
        slots: data.slots,
        weekStart: data.weekStart,
      });
    } else {
      locationEntries.push({
        location: locationName,
        daysOut: null,
        slots: null,
        weekStart: null,
      });
    }
  }

  // Sort by daysOut ascending (locations with no open week go last)
  locationEntries.sort((a, b) => {
    if (a.daysOut === null && b.daysOut === null) return 0;
    if (a.daysOut === null) return 1;
    if (b.daysOut === null) return -1;
    return a.daysOut - b.daysOut;
  });

  // Format each location
  for (const entry of locationEntries) {
    if (entry.daysOut === null) {
      lines.push(`  ${entry.location} — no open weeks in window`);
    } else {
      const weekRange = formatWeekRange(entry.weekStart);
      const daysLabel = entry.daysOut === 1 ? '1 day out' : `${entry.daysOut} days out`;
      lines.push(`  ${entry.location} — ${daysLabel} (${entry.slots} slots that week, ${weekRange})`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// DATABASE QUERIES
// ============================================================================

async function getUnnotifiedAppearedSlots(supabase) {
  // Get slots that are active but haven't been notified about yet
  // This is the flag-based approach that prevents duplicate notifications
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
    .eq('is_active', true)
    .eq('notified_appeared', false)
    .order('first_seen', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getUnnotifiedDisappearedSlots(supabase) {
  // Get slots that disappeared but haven't been notified about yet
  const { data, error } = await supabase
    .from('slot_states')
    .select(`
      location_id,
      date,
      time,
      first_seen,
      last_seen,
      disappeared_at,
      locations!inner(name)
    `)
    .eq('is_active', false)
    .eq('notified_disappeared', false)
    .gte('date', getHstToday()) // Only future appointments
    .order('disappeared_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function markSlotsNotifiedAppeared(supabase, slots) {
  if (!slots || slots.length === 0) return;

  // Build composite keys for the slots to update
  for (const slot of slots) {
    const { error } = await supabase
      .from('slot_states')
      .update({ notified_appeared: true })
      .eq('location_id', slot.location_id)
      .eq('date', slot.date)
      .eq('time', slot.time);

    if (error) throw error;
  }
}

async function markSlotsNotifiedDisappeared(supabase, slots) {
  if (!slots || slots.length === 0) return;

  // Build composite keys for the slots to update
  for (const slot of slots) {
    const { error } = await supabase
      .from('slot_states')
      .update({ notified_disappeared: true })
      .eq('location_id', slot.location_id)
      .eq('date', slot.date)
      .eq('time', slot.time);

    if (error) throw error;
  }
}

async function getActiveSlots(supabase) {
  // Get all active slots using the is_active flag
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
    .eq('is_active', true)
    .gte('date', getHstToday())
    .order('date', { ascending: true })
    .order('time', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getSlotsAppearedSince(supabase, since) {
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
    .gte('first_seen', since.toISOString())
    .gte('date', getHstToday())
    .order('first_seen', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getSlotsDisappearedSince(supabase, since) {
  // Get slots that disappeared after `since` using the disappeared_at timestamp
  const { data, error } = await supabase
    .from('slot_states')
    .select(`
      location_id,
      date,
      time,
      first_seen,
      last_seen,
      disappeared_at,
      locations!inner(name)
    `)
    .eq('is_active', false)
    .gte('disappeared_at', since.toISOString())
    .gte('date', getHstToday())
    .order('disappeared_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getLastNotification(supabase, type) {
  const { data, error } = await supabase
    .from('dmv_notification_log')
    .select('id, sent_at, slots_notified')
    .eq('notification_type', type)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // Table may not exist yet - that's okay
    if (error.code === '42P01') return null;
    throw error;
  }
  return data;
}

async function recordNotification(supabase, type, slotsNotified) {
  const { error } = await supabase
    .from('dmv_notification_log')
    .insert({
      notification_type: type,
      sent_at: new Date().toISOString(),
      slots_notified: slotsNotified,
    });

  if (error) {
    // Table may not exist yet - log warning but don't fail
    if (error.code === '42P01') {
      console.warn('[DMVNotify] dmv_notification_log table does not exist, skipping log');
      return;
    }
    throw error;
  }
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function splitIntoChunks(content, maxLength) {
  if (content.length <= maxLength) {
    return [content];
  }

  const chunks = [];
  const lines = content.split('\n');
  let currentChunk = '';

  for (const line of lines) {
    // If adding this line would exceed the limit
    if (currentChunk.length + line.length + 1 > maxLength) {
      // If current chunk has content, save it
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.trimEnd());
        currentChunk = '';
      }
      // If a single line is too long, split it
      if (line.length > maxLength) {
        let remaining = line;
        while (remaining.length > maxLength) {
          chunks.push(remaining.slice(0, maxLength));
          remaining = remaining.slice(maxLength);
        }
        if (remaining.length > 0) {
          currentChunk = remaining;
        }
      } else {
        currentChunk = line;
      }
    } else {
      currentChunk += (currentChunk.length > 0 ? '\n' : '') + line;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.trimEnd());
  }

  return chunks;
}

async function sendSingleMessage(content, ping = false) {
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

async function sendDiscordMessage(content, ping = false) {
  if (content.length <= DISCORD_MAX_LENGTH) {
    return sendSingleMessage(content, ping);
  }

  // Split into chunks at line breaks
  const chunks = splitIntoChunks(content, DISCORD_MAX_LENGTH);
  console.log(`[Discord] Message too long (${content.length} chars), splitting into ${chunks.length} chunks`);

  for (let i = 0; i < chunks.length; i++) {
    // Only ping on first message
    await sendSingleMessage(chunks[i], ping && i === 0);
    if (i < chunks.length - 1) {
      await sleep(500); // Rate limit buffer
    }
  }
}

// ============================================================================
// INSTANT NOTIFICATIONS
// ============================================================================

async function sendInstantNotifications(supabase) {
  const today = getHstToday();

  // Get unnotified appeared and disappeared slots (flag-based detection)
  const [appearedSlots, disappearedSlots] = await Promise.all([
    getUnnotifiedAppearedSlots(supabase),
    getUnnotifiedDisappearedSlots(supabase),
  ]);

  // Filter to slots within INSTANT_ALERT_DAYS
  const nearAppearedSlots = appearedSlots.filter(slot => {
    const daysAway = daysBetween(today, slot.date);
    return daysAway >= 0 && daysAway <= INSTANT_ALERT_DAYS;
  });

  const nearDisappearedSlots = disappearedSlots.filter(slot => {
    const daysAway = daysBetween(today, slot.date);
    return daysAway >= 0 && daysAway <= INSTANT_ALERT_DAYS;
  });

  console.log(`[Instant] Found ${nearAppearedSlots.length} new slots, ${nearDisappearedSlots.length} disappeared slots within ${INSTANT_ALERT_DAYS} days`);

  // Send APPEARED notification
  if (nearAppearedSlots.length > 0 || NOTIFY_TEST) {
    const slotsToNotify = nearAppearedSlots.length > 0 ? nearAppearedSlots : [{
      locations: { name: 'Test Location' },
      date: today,
      time: '10:00:00',
    }];

    const grouped = groupByLocation(slotsToNotify);
    const lines = [];

    if (DISCORD_MENTION_USER_ID) {
      lines.push(`<@${DISCORD_MENTION_USER_ID}>`);
    }
    const testLabel = NOTIFY_TEST && nearAppearedSlots.length === 0 ? ' (TEST)' : '';
    lines.push(`**DMV Slots Appeared!**${testLabel}`);
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
    console.log('[Instant] Sent APPEARED notification');

    // Mark as notified (skip in test mode with no real slots)
    if (nearAppearedSlots.length > 0) {
      await markSlotsNotifiedAppeared(supabase, nearAppearedSlots);
    }
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
    console.log('[Instant] Sent GONE notification');

    // Mark as notified
    await markSlotsNotifiedDisappeared(supabase, nearDisappearedSlots);
  }

  return {
    appeared: nearAppearedSlots.length,
    disappeared: nearDisappearedSlots.length,
  };
}

// ============================================================================
// DAILY SUMMARY
// ============================================================================

async function sendDailySummary(supabase) {
  // Get last daily notification
  const lastDaily = await getLastNotification(supabase, 'daily');
  const since = lastDaily ? new Date(lastDaily.sent_at) : new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Get slots that appeared/disappeared since last daily
  const [newSlots, disappearedSlots, supplyOutlook] = await Promise.all([
    getSlotsAppearedSince(supabase, since),
    getSlotsDisappearedSince(supabase, since),
    calculateSupplyOutlook(supabase),
  ]);

  console.log(`[Daily] Since ${since.toISOString()}: ${newSlots.length} new, ${disappearedSlots.length} disappeared`);

  if (newSlots.length === 0 && disappearedSlots.length === 0 && !NOTIFY_TEST) {
    console.log('[Daily] No changes to report. Skipping notification.');
    return { newSlots: 0, disappeared: 0 };
  }

  const today = getHstToday();
  const lines = [];

  const testLabel = NOTIFY_TEST && newSlots.length === 0 && disappearedSlots.length === 0 ? ' (TEST)' : '';
  lines.push(`**DMV Daily Summary**${testLabel}`);
  lines.push(`Since last update: ${newSlots.length} new slots, ${disappearedSlots.length} disappeared`);
  lines.push('');

  if (newSlots.length > 0) {
    lines.push('**New Slots by Location:**');
    lines.push('');

    const grouped = groupByLocation(newSlots);
    for (const [locationName, slots] of Object.entries(grouped)) {
      const shortName = getShortLocationName(locationName);
      const countLabel = slots.length === 1 ? '1 new' : `${slots.length} new`;
      lines.push(`**${shortName}** (${countLabel})`);
      for (const slot of slots.slice(0, 10)) {
        const daysAway = daysBetween(today, slot.date);
        lines.push(`  - ${formatPrettyDate(slot.date)} - ${formatPrettyTime(slot.time)} (${daysAway} days)`);
      }
      if (slots.length > 10) {
        lines.push(`  ... and ${slots.length - 10} more`);
      }
      lines.push('');
    }
  }

  if (disappearedSlots.length > 0) {
    lines.push('**Disappeared:**');
    const grouped = groupByLocation(disappearedSlots);
    for (const [locationName, slots] of Object.entries(grouped)) {
      const shortName = getShortLocationName(locationName);
      for (const slot of slots.slice(0, 5)) {
        lines.push(`  - ${shortName}: ${formatPrettyDate(slot.date)} - ${formatPrettyTime(slot.time)}`);
      }
      if (slots.length > 5) {
        lines.push(`  ... and ${slots.length - 5} more from ${shortName}`);
      }
    }
    lines.push('');
  }

  // Add supply outlook section
  lines.push(formatSupplyOutlookSection(supplyOutlook));
  lines.push('');

  lines.push(`Book: ${APPT_URL}`);

  await sendDiscordMessage(lines.join('\n'), false);
  console.log('[Daily] Sent daily summary');

  // Record notification
  const allIds = [
    ...newSlots.map(s => `${s.location_id}-${s.date}-${s.time}`),
    ...disappearedSlots.map(s => `${s.location_id}-${s.date}-${s.time}`),
  ];
  await recordNotification(supabase, 'daily', allIds);

  return { newSlots: newSlots.length, disappeared: disappearedSlots.length };
}

// ============================================================================
// WEEKLY SUMMARY
// ============================================================================

async function sendWeeklySummary(supabase) {
  const today = getHstToday();
  const weekRange = getWeekRangeForDisplay();

  // Get all active slots and supply outlook
  const [activeSlots, supplyOutlook] = await Promise.all([
    getActiveSlots(supabase),
    calculateSupplyOutlook(supabase),
  ]);

  // Get last weekly notification to calculate activity
  const lastWeekly = await getLastNotification(supabase, 'weekly');
  const since = lastWeekly ? new Date(lastWeekly.sent_at) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [newThisWeek, disappearedThisWeek] = await Promise.all([
    getSlotsAppearedSince(supabase, since),
    getSlotsDisappearedSince(supabase, since),
  ]);

  console.log(`[Weekly] Active slots: ${activeSlots.length}, This week: ${newThisWeek.length} new, ${disappearedThisWeek.length} disappeared`);

  const lines = [];

  lines.push('**DMV Weekly Summary**');
  lines.push(`Week of ${weekRange}`);
  lines.push('');
  lines.push('**Current Availability by Location:**');
  lines.push('');

  // Group by location
  const grouped = groupByLocation(activeSlots);

  for (const location of DMV_LOCATIONS) {
    // Find slots for this location (need to find matching full name)
    const fullName = Object.keys(LOCATION_SHORT_NAMES).find(
      key => LOCATION_SHORT_NAMES[key] === location
    );
    const slots = grouped[fullName] || [];

    if (slots.length === 0) {
      lines.push(`**${location}** - 0 slots`);
    } else {
      lines.push(`**${location}** - ${slots.length} slot${slots.length === 1 ? '' : 's'} available`);
      // Find earliest
      const sorted = slots.sort((a, b) => a.date.localeCompare(b.date));
      const earliest = sorted[0];
      const daysAway = daysBetween(today, earliest.date);
      lines.push(`  Earliest: ${formatPrettyDate(earliest.date)} (${daysAway} days)`);
    }
  }

  lines.push('');
  lines.push("**This Week's Activity:**");
  lines.push(`  - New slots found: ${newThisWeek.length}`);
  lines.push(`  - Slots that disappeared: ${disappearedThisWeek.length}`);
  lines.push('');

  // Add supply outlook section
  lines.push(formatSupplyOutlookSection(supplyOutlook));
  lines.push('');

  lines.push(`Book: ${APPT_URL}`);

  await sendDiscordMessage(lines.join('\n'), false);
  console.log('[Weekly] Sent weekly summary');

  // Record notification
  await recordNotification(supabase, 'weekly', activeSlots.map(s => `${s.location_id}-${s.date}-${s.time}`));

  return {
    activeSlots: activeSlots.length,
    newThisWeek: newThisWeek.length,
    disappearedThisWeek: disappearedThisWeek.length,
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const { type } = parseArgs();
  validateEnv();

  console.log(`[DMVNotify] Type: ${type}`);
  console.log(`[DMVNotify] Test mode: ${NOTIFY_TEST}`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    let result;

    switch (type) {
      case 'instant':
        result = await sendInstantNotifications(supabase);
        console.log(`[DMVNotify] Done. Appeared: ${result.appeared}, Disappeared: ${result.disappeared}`);
        break;

      case 'daily':
        result = await sendDailySummary(supabase);
        console.log(`[DMVNotify] Done. New: ${result.newSlots}, Disappeared: ${result.disappeared}`);
        break;

      case 'weekly':
        result = await sendWeeklySummary(supabase);
        console.log(`[DMVNotify] Done. Active: ${result.activeSlots}, New this week: ${result.newThisWeek}`);
        break;
    }
  } catch (error) {
    console.error('[DMVNotify] Error:', error.message || error);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

main();
