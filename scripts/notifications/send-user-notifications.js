#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SMTP_SERVER = process.env.SMTP_SERVER;
const SMTP_PORT = Number(process.env.SMTP_PORT || 0);
const SMTP_USERNAME = process.env.SMTP_USERNAME;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const EMAIL_FROM = process.env.DMV_EMAIL_FROM;
const NOTIFY_TEST =
  (process.env.DMV_NOTIFY_TEST || '').toLowerCase() === 'true' ||
  process.env.DMV_NOTIFY_TEST === '1';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Supabase env vars not set; exiting.');
  process.exit(1);
}

if (!SMTP_SERVER || !SMTP_PORT || !SMTP_USERNAME || !SMTP_PASSWORD || !EMAIL_FROM) {
  console.error('SMTP env vars not set; exiting.');
  process.exit(1);
}

const RESULTS_PATH = path.join(process.cwd(), 'data', 'results', 'dmv-results.json');
if (!fs.existsSync(RESULTS_PATH)) {
  console.error(`Results file not found: ${RESULTS_PATH}`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function daysBetween(fromIso, toDateStr) {
  if (!fromIso || !toDateStr) return null;
  const fromDate = new Date(fromIso);
  if (Number.isNaN(fromDate.getTime())) return null;
  const toDate = new Date(`${toDateStr}T00:00:00Z`);
  if (Number.isNaN(toDate.getTime())) return null;
  const diffMs = toDate.getTime() - fromDate.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

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

function trimLocation(name) {
  return (name || '').replace(/\s*Satellite City Hall$/i, '').trim() || name || 'Unknown';
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

function formatMonthDay(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', {
    timeZone: 'Pacific/Honolulu',
    month: 'short',
    day: 'numeric',
  });
}

function formatPrettyTime(timeText, dataVal) {
  const raw = timeText || (dataVal ? (dataVal.split(' ')[1] || '') : '');
  if (!raw) return '';
  if (/am|pm/i.test(raw)) return raw;
  const [hh = '', mm = '00'] = raw.split(':');
  const hourNum = Number(hh);
  if (Number.isNaN(hourNum)) return raw;
  const ampm = hourNum >= 12 ? 'PM' : 'AM';
  const hour12 = ((hourNum + 11) % 12) + 1;
  return `${hour12}:${mm.padStart(2, '0')} ${ampm}`;
}

async function loadSubscribers() {
  const { data, error } = await supabase
    .from('notification_subscribers')
    .select('id,email,locations,active')
    .eq('active', true);
  if (error) throw error;
  return data || [];
}

async function loadNotificationState(subscriberId, locationName) {
  const { data, error } = await supabase
    .from('notification_state')
    .select('last_data_val,last_notified_at')
    .eq('subscriber_id', subscriberId)
    .eq('location_name', locationName)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertNotificationState(subscriberId, locationName, dataVal) {
  const { error } = await supabase
    .from('notification_state')
    .upsert({
      subscriber_id: subscriberId,
      location_name: locationName,
      last_data_val: dataVal,
      last_notified_at: new Date().toISOString(),
    }, { onConflict: 'subscriber_id,location_name' });
  if (error) throw error;
}

async function main() {
  const payload = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
  const runAt = payload.generatedAt || new Date().toISOString();
  const results = Array.isArray(payload.results) ? payload.results : [];

  const byLocation = new Map();
  results.forEach((r) => {
    if (r && r.locationName) byLocation.set(r.locationName, r);
  });

  const subscribers = await loadSubscribers();
  if (!subscribers.length) {
    console.log('No active subscribers found.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_SERVER,
    port: SMTP_PORT,
    secure: true,
    auth: {
      user: SMTP_USERNAME,
      pass: SMTP_PASSWORD,
    },
  });

  for (const sub of subscribers) {
    const requestedLocations = Array.isArray(sub.locations) && sub.locations.length
      ? sub.locations
      : Array.from(byLocation.keys());

    const matches = [];
    for (const locName of requestedLocations) {
      const result = byLocation.get(locName);
      if (!result || !result.ok || !result.dataVal) continue;
      const dateStr = result.dataVal.split(' ')[0];
      const daysOut = daysBetween(runAt, dateStr);
      if (daysOut == null || daysOut < 0 || daysOut > 7) continue;

      const state = await loadNotificationState(sub.id, locName);
      if (state && state.last_data_val === result.dataVal) {
        continue; // Already notified for this slot.
      }

      matches.push({
        locationName: locName,
        dataVal: result.dataVal,
        dateText: result.dateText || dateStr,
        timeText: result.timeText || '',
        daysOut,
      });
    }

    if (!matches.length && NOTIFY_TEST) {
      const fallback = requestedLocations
        .map((name) => byLocation.get(name))
        .find((r) => r && r.ok && r.dataVal);
      if (fallback) {
        const dateStr = fallback.dataVal.split(' ')[0];
        matches.push({
          locationName: fallback.locationName,
          dataVal: fallback.dataVal,
          dateText: fallback.dateText || dateStr,
          timeText: fallback.timeText || '',
          daysOut: daysBetween(runAt, dateStr),
          isTest: true,
        });
      }
    }

    if (!matches.length) continue;

    const soonest = [...matches].sort((a, b) => (a.dateText || '').localeCompare(b.dateText || ''))[0];
    const monthDay = soonest ? formatMonthDay(soonest.dateText) : '';
    const subjectPrefix = monthDay ? `${monthDay} — ` : '';
    const testLabel = matches.some((m) => m.isTest) ? 'TEST ' : '';
    const subject = `${subjectPrefix}${testLabel}DMV Alert: ${matches.length} within 7 days`;
    const lines = matches.map((m) => {
      const loc = trimLocation(m.locationName);
      const dateText = formatPrettyDate(m.dateText);
      const timeText = formatPrettyTime(m.timeText, m.dataVal);
      return `- ${loc}: ${dateText} ${timeText} (${m.daysOut}d out)`;
    });
    const textBody = [
      `DMV Appointment Alert${matches.some((m) => m.isTest) ? ' (TEST)' : ''}`,
      `Run: ${formatHst(runAt)}`,
      '',
      'Appointments within 7 days:',
      ...lines,
    ].join('\n');

    const htmlBody = [
      `<h2>DMV Appointment Alert</h2>`,
      `<p><strong>Run:</strong> ${formatHst(runAt)}</p>`,
      `<p><strong>Appointments within 7 days:</strong></p>`,
      `<ul>`,
      ...matches.map((m) => {
        const loc = trimLocation(m.locationName);
        const dateText = formatPrettyDate(m.dateText);
        const timeText = formatPrettyTime(m.timeText, m.dataVal);
        return `<li><strong>${loc}</strong>: ${dateText} ${timeText} <em>(${m.daysOut}d out)</em></li>`;
      }),
      `</ul>`,
    ].join('\n');

    await transporter.sendMail({
      from: EMAIL_FROM,
      to: sub.email,
      subject,
      text: textBody,
      html: htmlBody,
    });

    for (const match of matches) {
      await upsertNotificationState(sub.id, match.locationName, match.dataVal);
    }

    console.log(`Notified ${sub.email} (${matches.length} matches).`);
  }
}

main().catch((err) => {
  console.error('User notification failed:', err.message || err);
  process.exit(1);
});
