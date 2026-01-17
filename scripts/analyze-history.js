#!/usr/bin/env node
// Read-only analyzer for DMV history files.
// Outputs text and HTML summaries to stdout and (if GITHUB_OUTPUT set) as step outputs.
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const HISTORY_FILE = path.join(HISTORY_DIR, 'dmv-history.json');
const REPORT_DIR = path.join(HISTORY_DIR, 'reports');

const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const ordinal = (n) => {
  const s = ['th','st','nd','rd']; const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
};
const formatDate = (s) => {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const day = d.getUTCDate();
  const month = monthNames[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return `${month} ${day}${ordinal(day)}, ${year}`;
};
const formatHst = (s) => {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return (
    d.toLocaleString('en-US', {
      timeZone: 'Pacific/Honolulu',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }) + ' HST'
  );
};
const displayLoc = (s) => (s || '').replace(/\s*Satellite City Hall$/i, '').trim() || s || 'Unknown';

function readJsonSafe(p, fallback) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.log(`Warning: failed to read ${p}: ${e && e.message ? e.message : e}`);
  }
  return fallback;
}

function loadPerLocationHistories() {
  if (!fs.existsSync(HISTORY_DIR)) return [];
  const files = fs.readdirSync(HISTORY_DIR).filter((f) => f.startsWith('dmv-month-history-') && f.endsWith('.json'));
  return files.map((f) => {
    const full = path.join(HISTORY_DIR, f);
    const data = readJsonSafe(full, { location: f, months: {} });
    return { file: full, data };
  });
}

function summarizeMonths(byMonth) {
  const monthKeys = Object.keys(byMonth || {}).sort();
  let totalSlots = 0;
  const allDates = [];
  const byDateSlots = {};
  for (const mk of monthKeys) {
    const m = byMonth[mk] || {};
    const byDate = m.byDate || {};
    for (const [date, times] of Object.entries(byDate)) {
      allDates.push(date);
      byDateSlots[date] = (times && times.length) || 0;
      totalSlots += (times && times.length) || 0;
    }
  }
  const datesSorted = allDates.sort();
  const earliestDate = datesSorted[0] || 'n/a';
  const latestDate = datesSorted[datesSorted.length - 1] || 'n/a';
  const daysCount = allDates.length;
  const avgPerDay = daysCount ? totalSlots / daysCount : 0;
  const topDays = Object.entries(byDateSlots)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  return { monthKeys, totalSlots, daysCount, earliestDate, latestDate, avgPerDay, topDays };
}

function histogramHour(byMonth) {
  const counts = {};
  for (const mk of Object.keys(byMonth || {})) {
    const byDate = (byMonth[mk] && byMonth[mk].byDate) || {};
    for (const times of Object.values(byDate)) {
      (times || []).forEach((t) => {
        const hour = t.split(':')[0] || '??';
        counts[hour] = (counts[hour] || 0) + 1;
      });
    }
  }
  const entries = Object.entries(counts).sort((a, b) => Number(a[0]) - Number(b[0]));
  const top = entries.sort((a, b) => b[1] - a[1])[0] || null;
  return { counts: entries, top };
}

function weekdayStats(byMonth) {
  const counts = [0, 0, 0, 0, 0, 0, 0]; // Sun..Sat
  for (const mk of Object.keys(byMonth || {})) {
    const byDate = (byMonth[mk] && byMonth[mk].byDate) || {};
    for (const [date, times] of Object.entries(byDate)) {
      const d = new Date(date + 'T00:00:00Z');
      if (Number.isNaN(d.getTime())) continue;
      counts[d.getUTCDay()] += (times && times.length) || 0;
    }
  }
  const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const entries = counts.map((c, i) => [names[i], c]).sort((a, b) => b[1] - a[1]);
  const top = entries[0] || null;
  return { entries, top };
}

function timeExtremes(byMonth) {
  const times = [];
  for (const mk of Object.keys(byMonth || {})) {
    const byDate = (byMonth[mk] && byMonth[mk].byDate) || {};
    for (const arr of Object.values(byDate)) {
      (arr || []).forEach((t) => times.push(t));
    }
  }
  if (!times.length) return { earliest: 'n/a', latest: 'n/a' };
  const sorted = [...times].sort((a, b) => a.localeCompare(b));
  return { earliest: sorted[0], latest: sorted[sorted.length - 1] };
}

function analyzeHistory() {
  const overallHistory = readJsonSafe(HISTORY_FILE, { locations: {}, overall: { changes: [] } });
  const perLocFiles = loadPerLocationHistories();

  const locationSummaries = perLocFiles.map(({ data }) => {
    const loc = data.location || 'Unknown';
    const disp = displayLoc(loc);
    const months = data.months || {};
    const basic = summarizeMonths(months);
    const hourStats = histogramHour(months);
    const weekday = weekdayStats(months);
    const extremes = timeExtremes(months);
    const changes = ((overallHistory.locations || {})[loc] || {}).changes || [];
    const lastChange = changes[changes.length - 1] || null;
    return { loc, disp, months, basic, hourStats, weekday, extremes, changes, lastChange };
  });

  const textLines = [];
  const htmlLines = [];

  textLines.push('DMV Appointment Pattern Analysis');
  htmlLines.push('<h3>DMV Appointment Pattern Analysis</h3>');

  for (const s of locationSummaries) {
    textLines.push(`\n${s.disp}:`);
    const monthList = s.basic.monthKeys.length ? s.basic.monthKeys.join(', ') : 'none';
    textLines.push(`  Months: ${monthList}`);
    textLines.push(`  Total slots: ${s.basic.totalSlots} across ${s.basic.daysCount} day(s)`);
    textLines.push(`  Date range: ${formatDate(s.basic.earliestDate)} - ${formatDate(s.basic.latestDate)}`);
    textLines.push(`  Avg slots/day: ${s.basic.avgPerDay.toFixed(1)}`);
    if (s.basic.topDays.length) {
      const td = s.basic.topDays.map(([d, n]) => `${d}: ${n}`).join(', ');
      textLines.push(`  Top days: ${td}`);
    }
    if (s.weekday.top) {
      textLines.push(`  Busiest weekday: ${s.weekday.top[0]} (${s.weekday.top[1]} slots)`);
    }
    if (s.hourStats.top) {
      textLines.push(`  Busiest hour: ${s.hourStats.top[0]}h (${s.hourStats.top[1]} slots)`);
    }
    textLines.push(`  Earliest slot: ${s.extremes.earliest}, Latest slot: ${s.extremes.latest}`);
    if (s.lastChange) {
      textLines.push(`  Last change: ${s.lastChange.toDataVal || '(unknown)'} @ ${formatHst(s.lastChange.changedAt)}`);
    }

    const parts = [];
    parts.push(`<strong>${s.disp}</strong>`);
    parts.push(`Months: ${monthList}`);
    parts.push(`Total slots: ${s.basic.totalSlots} across ${s.basic.daysCount} day(s)`);
    parts.push(`Date range: ${formatDate(s.basic.earliestDate)} - ${formatDate(s.basic.latestDate)}`);
    parts.push(`Avg slots/day: ${s.basic.avgPerDay.toFixed(1)}`);
    if (s.basic.topDays.length) {
      const td = s.basic.topDays.map(([d, n]) => `${d}: ${n}`).join(', ');
      parts.push(`Top days: ${td}`);
    }
    if (s.weekday.top) {
      parts.push(`Busiest weekday: ${s.weekday.top[0]} (${s.weekday.top[1]} slots)`);
    }
    if (s.hourStats.top) {
      parts.push(`Busiest hour: ${s.hourStats.top[0]}h (${s.hourStats.top[1]} slots)`);
    }
    parts.push(`Earliest slot: ${s.extremes.earliest}, Latest slot: ${s.extremes.latest}`);
    if (s.lastChange) {
      parts.push(`Last change: ${s.lastChange.toDataVal || '(unknown)'} @ ${formatHst(s.lastChange.changedAt)}`);
    }
    htmlLines.push(`<p>${parts.join('<br>')}</p>`);
  }

  const textBody = textLines.join('\n');
  const htmlBody = htmlLines.join('\n');

  // Persist reports (overwrites latest, appends to log).
  try {
    if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(REPORT_DIR, 'generic-latest.txt'), textBody, 'utf8');
    fs.writeFileSync(path.join(REPORT_DIR, 'generic-latest.html'), htmlBody, 'utf8');
    fs.appendFileSync(path.join(REPORT_DIR, 'generic-run-log.txt'), `\n---- ${ts} ----\n${textBody}\n`, 'utf8');
  } catch (e) {
    console.log(`Warning: failed to write report files: ${e && e.message ? e.message : e}`);
  }

  console.log(textBody);

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `text_body<<EOF\n${textBody}\nEOF\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `html_body<<EOF\n${htmlBody}\nEOF\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `subject=DMV pattern analysis report\n`);
  }
}

analyzeHistory();
