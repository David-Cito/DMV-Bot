#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { sendDiscordAlert } = require('./discord-notifier');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const NOTIFY_TEST =
  (process.env.ROAD_TEST_NOTIFY_TEST || '').toLowerCase() === 'true' ||
  process.env.ROAD_TEST_NOTIFY_TEST === '1';
const INSTANT_ALERT_DAYS = 21; // Alert if appointment within 3 weeks
const APPT_URL = 'https://www12.honolulu.gov/csdarts/frmApptInt.aspx';
const DISCORD_MENTION_USER_ID = process.env.DISCORD_MENTION_USER_ID || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Supabase env vars not set; exiting.');
  process.exit(1);
}

if (!DISCORD_WEBHOOK_URL) {
  console.error('DISCORD_WEBHOOK_URL not set; exiting.');
  process.exit(1);
}

const RESULTS_PATH = path.join(process.cwd(), 'data', 'results', 'road-test-results.json');
if (!fs.existsSync(RESULTS_PATH)) {
  console.error(`Results file not found: ${RESULTS_PATH}`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function formatHst(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    timeZone: 'Pacific/Honolulu',
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}

function formatPrettyDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', {
    timeZone: 'Pacific/Honolulu',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

async function loadNotificationState(locationKey) {
  const { data, error } = await supabase
    .from('notification_state')
    .select('last_data_val,last_notified_at')
    .eq('subscriber_id', 'road-test-bot')
    .eq('location_name', locationKey)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertNotificationState(locationKey, dataVal) {
  const { error } = await supabase
    .from('notification_state')
    .upsert({
      subscriber_id: 'road-test-bot',
      location_name: locationKey,
      last_data_val: dataVal,
      last_notified_at: new Date().toISOString(),
    }, { onConflict: 'subscriber_id,location_name' });
  if (error) throw error;
}

async function main() {
  const payload = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
  const runAt = payload.scannedAt || new Date().toISOString();

  if (!payload.ok) {
    console.log(`Scan was not successful: ${payload.reason || 'Unknown reason'}`);
    return;
  }

  const totalSlots = payload.summary?.totalSlots || 0;
  const earliestDaysAway = payload.summary?.earliestDaysAway;
  const byLocation = payload.summary?.byLocation || {};
  const days = payload.days || [];

  console.log(`Road Test Scan Results:`);
  console.log(`  Total slots: ${totalSlots}`);
  console.log(`  Earliest days away: ${earliestDaysAway}`);

  // Check if we should send notification
  const shouldNotify = (earliestDaysAway !== null && earliestDaysAway <= INSTANT_ALERT_DAYS) || NOTIFY_TEST;

  if (!shouldNotify) {
    console.log(`No appointments within ${INSTANT_ALERT_DAYS} days. Skipping notification.`);
    return;
  }

  if (totalSlots === 0 && !NOTIFY_TEST) {
    console.log('No slots available. Skipping notification.');
    return;
  }

  // Build a unique key for this set of slots to avoid duplicate notifications
  const slotKey = days
    .flatMap(day => day.slots.map(s => `${day.date}|${s.time}|${s.location}|${s.type}`))
    .sort()
    .join(';');

  // Check if we already notified for these exact slots
  const state = await loadNotificationState('all-slots');
  if (state && state.last_data_val === slotKey && !NOTIFY_TEST) {
    console.log('Already notified for these slots. Skipping.');
    return;
  }

  // Build matches for the notification
  const matches = [];
  for (const day of days) {
    for (const slot of day.slots) {
      matches.push({
        locationName: slot.location,
        dateText: day.date,
        timeText: slot.time,
        daysOut: earliestDaysAway,
        slotType: slot.type,
      });
    }
  }

  if (matches.length === 0 && NOTIFY_TEST) {
    // For test mode, create a dummy match
    matches.push({
      locationName: 'Test Location',
      dateText: new Date().toISOString().slice(0, 10),
      timeText: '10:00 AM',
      daysOut: 0,
      slotType: 'test',
      isTest: true,
    });
  }

  if (matches.length === 0) {
    console.log('No matches to notify about.');
    return;
  }

  // Build notification message
  const testLabel = NOTIFY_TEST ? 'TEST ' : '';
  const subject = `${testLabel}Road Test Alert: ${totalSlots} slot(s) available!`;

  // Format message for Discord
  const lines = [];
  if (DISCORD_MENTION_USER_ID) {
    lines.push(`<@${DISCORD_MENTION_USER_ID}>`);
  }
  lines.push(`**${subject}**`);
  lines.push(`Run: ${formatHst(runAt)}`);
  lines.push('');

  if (earliestDaysAway !== null) {
    lines.push(`Earliest appointment: **${earliestDaysAway} days away**`);
    lines.push('');
  }

  // Group by location
  lines.push('**By Location:**');
  for (const [location, count] of Object.entries(byLocation)) {
    if (count > 0) {
      lines.push(`- ${location}: ${count} slot(s)`);
    }
  }
  lines.push('');

  // List individual slots
  lines.push('**Available Slots:**');
  for (const match of matches.slice(0, 10)) { // Limit to first 10 to avoid message overflow
    const typeLabel = match.slotType === 'standby' ? ' [STANDBY]' : '';
    lines.push(`- ${match.locationName}: ${formatPrettyDate(match.dateText)} ${match.timeText}${typeLabel}`);
  }
  if (matches.length > 10) {
    lines.push(`... and ${matches.length - 10} more`);
  }
  lines.push('');
  lines.push(`Book here: ${APPT_URL}`);

  const message = lines.join('\n');

  // Send Discord notification
  try {
    const res = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: message,
        allowed_mentions: DISCORD_MENTION_USER_ID ? { users: [DISCORD_MENTION_USER_ID] } : undefined,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Discord webhook failed: ${res.status} ${text}`.trim());
    }

    console.log(`Discord notification sent successfully!`);
  } catch (err) {
    console.error('Failed to send Discord notification:', err.message || err);
    throw err;
  }

  // Update notification state to avoid duplicate sends
  await upsertNotificationState('all-slots', slotKey);
  console.log('Notification state updated.');
}

main().catch((err) => {
  console.error('Road test notification failed:', err.message || err);
  process.exit(1);
});
