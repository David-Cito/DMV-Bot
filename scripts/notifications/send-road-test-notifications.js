#!/usr/bin/env node
/**
 * Road Test Notification Script
 *
 * Supports three notification types:
 * - instant: Immediate alerts for slots that appeared/disappeared within 14 days (pings user)
 * - daily: Daily summary of new slots since last daily notification (no ping)
 * - weekly: Weekly overview of all availability (no ping)
 *
 * Usage:
 *   node scripts/notifications/send-road-test-notifications.js --type=instant
 *   node scripts/notifications/send-road-test-notifications.js --type=daily
 *   node scripts/notifications/send-road-test-notifications.js --type=weekly
 */

const { createClient } = require('@supabase/supabase-js');

// ============================================================================
// CONFIGURATION
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const DISCORD_MENTION_USER_ID = process.env.DISCORD_MENTION_USER_ID || '';
const NOTIFY_TEST = (process.env.ROAD_TEST_NOTIFY_TEST || '').toLowerCase() === 'true';

const INSTANT_ALERT_DAYS = 14; // Alert if appointment within 2 weeks
const APPT_URL = 'https://www12.honolulu.gov/csdarts/frmApptInt.aspx';
const HST_TIMEZONE = 'Pacific/Honolulu';

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

// Normalize date to YYYY-MM-DD string
function normalizeDate(date) {
  if (!date) return null;
  // If already YYYY-MM-DD format
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }
  // If ISO string or Date object, extract date part
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

function daysBetween(date1, date2) {
  const d1Str = normalizeDate(date1);
  const d2Str = normalizeDate(date2);
  if (!d1Str || !d2Str) return 0;
  const d1 = new Date(`${d1Str}T00:00:00Z`);
  const d2 = new Date(`${d2Str}T00:00:00Z`);
  return Math.round((d2.getTime() - d1.getTime()) / (24 * 60 * 60 * 1000));
}

function formatDuration(firstSeen, lastSeen) {
  const first = new Date(firstSeen);
  const last = new Date(lastSeen);
  const diffMs = last.getTime() - first.getTime();
  const diffMinutes = Math.round(diffMs / (1000 * 60));

  if (diffMinutes < 60) {
    return `~${diffMinutes} minutes`;
  } else {
    const hours = Math.round(diffMinutes / 60);
    return `~${hours} hour${hours === 1 ? '' : 's'}`;
  }
}

function getWeekRange() {
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

// ============================================================================
// DATABASE HELPERS
// ============================================================================

async function getUnnotifiedAppearedSlots(supabase) {
  const { data, error } = await supabase
    .from('road_test_slots')
    .select('*')
    .eq('is_active', true)
    .eq('notified_appeared', false)
    .order('first_seen', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getUnnotifiedDisappearedSlots(supabase) {
  const { data, error } = await supabase
    .from('road_test_slots')
    .select('*')
    .eq('is_active', false)
    .eq('notified_disappeared', false)
    .order('disappeared_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getActiveSlots(supabase) {
  const { data, error } = await supabase
    .from('road_test_slots')
    .select('*')
    .eq('is_active', true)
    .order('date', { ascending: true })
    .order('time', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getSlotsAppearedSince(supabase, since) {
  const { data, error } = await supabase
    .from('road_test_slots')
    .select('*')
    .gte('first_seen', since.toISOString())
    .order('first_seen', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getSlotsDisappearedSince(supabase, since) {
  const { data, error } = await supabase
    .from('road_test_slots')
    .select('*')
    .eq('is_active', false)
    .gte('disappeared_at', since.toISOString())
    .order('disappeared_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function markSlotsNotifiedAppeared(supabase, slotIds) {
  if (slotIds.length === 0) return;

  const { error } = await supabase
    .from('road_test_slots')
    .update({ notified_appeared: true })
    .in('id', slotIds);

  if (error) throw error;
}

async function markSlotsNotifiedDisappeared(supabase, slotIds) {
  if (slotIds.length === 0) return;

  const { error } = await supabase
    .from('road_test_slots')
    .update({ notified_disappeared: true })
    .in('id', slotIds);

  if (error) throw error;
}

async function getLastNotification(supabase, type) {
  const { data, error } = await supabase
    .from('road_test_notification_log')
    .select('id, sent_at, slots_notified')
    .eq('notification_type', type)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function recordNotification(supabase, type, slotsNotified) {
  const { error } = await supabase
    .from('road_test_notification_log')
    .insert({
      notification_type: type,
      sent_at: new Date().toISOString(),
      slots_notified: slotsNotified,
    });

  if (error) throw error;
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
// GROUPING HELPERS
// ============================================================================

function groupByLocation(slots) {
  const grouped = {};
  for (const slot of slots) {
    if (!grouped[slot.location]) {
      grouped[slot.location] = [];
    }
    grouped[slot.location].push(slot);
  }
  return grouped;
}

// ============================================================================
// INSTANT NOTIFICATIONS
// ============================================================================

async function sendInstantNotifications(supabase) {
  const today = getHstToday();

  // Get unnotified appeared and disappeared slots
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
      location: 'Test Location',
      date: today,
      time: '10:00 AM',
      slot_type: 'regular',
      id: 'test-id',
    }];

    const grouped = groupByLocation(slotsToNotify);
    const lines = [];

    if (DISCORD_MENTION_USER_ID) {
      lines.push(`<@${DISCORD_MENTION_USER_ID}>`);
    }
    lines.push(`**Road Test Slots Appeared!** (within ${INSTANT_ALERT_DAYS} days)`);
    lines.push('');

    for (const [location, slots] of Object.entries(grouped)) {
      const countLabel = slots.length === 1 ? '1 new slot' : `${slots.length} new slots`;
      lines.push(`**${location}** (${countLabel})`);
      for (const slot of slots) {
        const daysAway = daysBetween(today, slot.date);
        const typeLabel = slot.slot_type === 'standby' ? ' [STANDBY]' : '';
        lines.push(`  - ${formatPrettyDate(slot.date)} - ${slot.time}${typeLabel} (${daysAway} days away)`);
      }
      lines.push('');
    }

    lines.push(`Book now: ${APPT_URL}`);

    await sendDiscordMessage(lines.join('\n'), true);
    console.log('[Instant] Sent APPEARED notification');

    // Mark as notified
    if (!NOTIFY_TEST) {
      await markSlotsNotifiedAppeared(supabase, nearAppearedSlots.map(s => s.id));
    }
  }

  // Send GONE notification
  if (nearDisappearedSlots.length > 0) {
    const grouped = groupByLocation(nearDisappearedSlots);
    const lines = [];

    if (DISCORD_MENTION_USER_ID) {
      lines.push(`<@${DISCORD_MENTION_USER_ID}>`);
    }
    lines.push(`**Road Test Slots Gone!** (were within ${INSTANT_ALERT_DAYS} days)`);
    lines.push('');

    for (const [location, slots] of Object.entries(grouped)) {
      const countLabel = slots.length === 1 ? '1 slot no longer available' : `${slots.length} slots no longer available`;
      lines.push(`**${location}** (${countLabel})`);
      for (const slot of slots) {
        const duration = formatDuration(slot.first_seen, slot.last_seen);
        const typeLabel = slot.slot_type === 'standby' ? ' [STANDBY]' : '';
        lines.push(`  - ${formatPrettyDate(slot.date)} - ${slot.time}${typeLabel} - lasted ${duration}`);
      }
      lines.push('');
    }

    lines.push('These slots were booked or removed.');

    await sendDiscordMessage(lines.join('\n'), true);
    console.log('[Instant] Sent GONE notification');

    // Mark as notified
    await markSlotsNotifiedDisappeared(supabase, nearDisappearedSlots.map(s => s.id));
  }

  // Record notification
  const allNotifiedIds = [
    ...nearAppearedSlots.map(s => s.id),
    ...nearDisappearedSlots.map(s => s.id),
  ];
  if (allNotifiedIds.length > 0) {
    await recordNotification(supabase, 'instant', allNotifiedIds);
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
  const [newSlots, disappearedSlots] = await Promise.all([
    getSlotsAppearedSince(supabase, since),
    getSlotsDisappearedSince(supabase, since),
  ]);

  console.log(`[Daily] Since ${since.toISOString()}: ${newSlots.length} new, ${disappearedSlots.length} disappeared`);

  if (newSlots.length === 0 && disappearedSlots.length === 0 && !NOTIFY_TEST) {
    console.log('[Daily] No changes to report. Skipping notification.');
    return { newSlots: 0, disappeared: 0 };
  }

  const today = getHstToday();
  const lines = [];

  lines.push('**Road Test Daily Summary**');
  lines.push(`Since last update: ${newSlots.length} new slots, ${disappearedSlots.length} disappeared`);
  lines.push('');

  if (newSlots.length > 0) {
    lines.push('**New Slots by Location:**');
    lines.push('');

    const grouped = groupByLocation(newSlots);
    for (const [location, slots] of Object.entries(grouped)) {
      const countLabel = slots.length === 1 ? '1 new' : `${slots.length} new`;
      lines.push(`**${location}** (${countLabel})`);
      for (const slot of slots.slice(0, 10)) {
        const daysAway = daysBetween(today, slot.date);
        const typeLabel = slot.slot_type === 'standby' ? ' [STANDBY]' : '';
        lines.push(`  - ${formatPrettyDate(slot.date)} - ${slot.time}${typeLabel} (${daysAway} days away)`);
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
    for (const [location, slots] of Object.entries(grouped)) {
      for (const slot of slots.slice(0, 5)) {
        const typeLabel = slot.slot_type === 'standby' ? ' [STANDBY]' : '';
        lines.push(`  - ${location}: ${formatPrettyDate(slot.date)} - ${slot.time}${typeLabel}`);
      }
      if (slots.length > 5) {
        lines.push(`  ... and ${slots.length - 5} more from ${location}`);
      }
    }
    lines.push('');
  }

  lines.push(`Book: ${APPT_URL}`);

  await sendDiscordMessage(lines.join('\n'), false);
  console.log('[Daily] Sent daily summary');

  // Record notification
  const allIds = [...newSlots.map(s => s.id), ...disappearedSlots.map(s => s.id)];
  await recordNotification(supabase, 'daily', allIds);

  return { newSlots: newSlots.length, disappeared: disappearedSlots.length };
}

// ============================================================================
// WEEKLY SUMMARY
// ============================================================================

async function sendWeeklySummary(supabase) {
  const today = getHstToday();
  const weekRange = getWeekRange();

  // Get all active slots
  const activeSlots = await getActiveSlots(supabase);

  // Get last weekly notification to calculate activity
  const lastWeekly = await getLastNotification(supabase, 'weekly');
  const since = lastWeekly ? new Date(lastWeekly.sent_at) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [newThisWeek, disappearedThisWeek] = await Promise.all([
    getSlotsAppearedSince(supabase, since),
    getSlotsDisappearedSince(supabase, since),
  ]);

  console.log(`[Weekly] Active slots: ${activeSlots.length}, This week: ${newThisWeek.length} new, ${disappearedThisWeek.length} disappeared`);

  const lines = [];

  lines.push('**Road Test Weekly Summary**');
  lines.push(`Week of ${weekRange}`);
  lines.push('');
  lines.push('**Current Availability by Location:**');
  lines.push('');

  // Group by location
  const grouped = groupByLocation(activeSlots);
  const locations = ['Kapahulu', 'Kapolei', 'Koolau', 'Wahiawa', 'Waianae'];

  for (const location of locations) {
    const slots = grouped[location] || [];
    if (slots.length === 0) {
      lines.push(`**${location}** - 0 slots`);
    } else {
      lines.push(`**${location}** - ${slots.length} slot${slots.length === 1 ? '' : 's'} available`);
      // Find earliest
      const sorted = slots.sort((a, b) => a.date.localeCompare(b.date));
      const earliest = sorted[0];
      const daysAway = daysBetween(today, earliest.date);
      const standbyCount = slots.filter(s => s.slot_type === 'standby').length;
      if (standbyCount === slots.length) {
        lines.push(`  Earliest: ${formatPrettyDate(earliest.date)} (${daysAway} days, standby only)`);
      } else {
        lines.push(`  Earliest: ${formatPrettyDate(earliest.date)} (${daysAway} days)`);
      }
    }
  }

  lines.push('');
  lines.push("**This Week's Activity:**");
  lines.push(`  - New slots found: ${newThisWeek.length}`);
  lines.push(`  - Slots that disappeared: ${disappearedThisWeek.length}`);
  lines.push('');
  lines.push(`Book: ${APPT_URL}`);

  await sendDiscordMessage(lines.join('\n'), false);
  console.log('[Weekly] Sent weekly summary');

  // Record notification
  await recordNotification(supabase, 'weekly', activeSlots.map(s => s.id));

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

  console.log(`[RoadTestNotify] Type: ${type}`);
  console.log(`[RoadTestNotify] Test mode: ${NOTIFY_TEST}`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    let result;

    switch (type) {
      case 'instant':
        result = await sendInstantNotifications(supabase);
        console.log(`[RoadTestNotify] Done. Appeared: ${result.appeared}, Disappeared: ${result.disappeared}`);
        break;

      case 'daily':
        result = await sendDailySummary(supabase);
        console.log(`[RoadTestNotify] Done. New: ${result.newSlots}, Disappeared: ${result.disappeared}`);
        break;

      case 'weekly':
        result = await sendWeeklySummary(supabase);
        console.log(`[RoadTestNotify] Done. Active: ${result.activeSlots}, New this week: ${result.newThisWeek}`);
        break;
    }
  } catch (error) {
    console.error('[RoadTestNotify] Error:', error.message || error);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

main();
