#!/usr/bin/env node
// Booking-oriented analyzer for DMV history files (read-only).
// Produces text/html summaries and writes latest + log files.
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const HISTORY_FILE = path.join(HISTORY_DIR, 'dmv-history.json');
const REPORT_DIR = path.join(HISTORY_DIR, 'reports');

const dayMs = 24 * 60 * 60 * 1000;
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

function percentiles(arr, ps = [0.1, 0.5, 0.9]) {
  if (!arr.length) return {};
  const sorted = [...arr].sort((a, b) => a - b);
  const out = {};
  for (const p of ps) {
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))));
    out[p] = sorted[idx];
  }
  return out;
}

function leadTimeStats(months) {
  const now = Date.now();
  const leads = [];
  for (const m of Object.values(months || {})) {
    const byDate = m.byDate || {};
    for (const [date, times] of Object.entries(byDate)) {
      const diff = (Date.parse(date) - now) / dayMs;
      const count = (times && times.length) || 0;
      for (let i = 0; i < Math.max(count, 1); i++) {
        if (Number.isFinite(diff)) leads.push(diff);
      }
    }
  }
  if (!leads.length) return null;
  const p = percentiles(leads);
  return {
    min: Math.min(...leads),
    max: Math.max(...leads),
    p10: p[0.1],
    p50: p[0.5],
    p90: p[0.9],
    samples: leads.length,
  };
}

function driftStats(changes) {
  if (!Array.isArray(changes) || changes.length < 2) return null;
  const recent = changes.slice(-15);
  const dirs = { sooner: 0, later: 0, same: 0, new: 0, unknown: 0 };
  let deltaSum = 0;
  let deltaCount = 0;
  for (const c of recent) {
    dirs[c.direction || 'unknown'] = (dirs[c.direction || 'unknown'] || 0) + 1;
    if (Number.isFinite(c.deltaDays)) {
      deltaSum += c.deltaDays;
      deltaCount++;
    }
  }
  const avgDelta = deltaCount ? deltaSum / deltaCount : 0;
  return { dirs, avgDelta, samples: recent.length };
}

function changeCadence(changes) {
  if (!Array.isArray(changes) || changes.length < 2) return null;
  const intervals = [];
  for (let i = 1; i < changes.length; i++) {
    const prev = changes[i - 1];
    const cur = changes[i];
    if (!prev.changedAt || !cur.changedAt) continue;
    const diffH = (Date.parse(cur.changedAt) - Date.parse(prev.changedAt)) / (60 * 60 * 1000);
    if (Number.isFinite(diffH)) intervals.push(diffH);
  }
  if (!intervals.length) return null;
  const p = percentiles(intervals);
  return {
    medianH: p[0.5],
    p10H: p[0.1],
    p90H: p[0.9],
    samples: intervals.length,
  };
}

function newSlotHourHistogram(changes) {
  const counts = {};
  for (const c of changes || []) {
    if (!c.changedAt) continue;
    const h = new Date(c.changedAt).getUTCHours();
    counts[h] = (counts[h] || 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
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

function analyze() {
  const overallHistory = readJsonSafe(HISTORY_FILE, { locations: {}, overall: { changes: [] } });
  const perLocFiles = loadPerLocationHistories();

  const locationSummaries = perLocFiles.map(({ data }) => {
    const loc = data.location || 'Unknown';
    const disp = displayLoc(loc);
    const months = data.months || {};
    const changes = ((overallHistory.locations || {})[loc] || {}).changes || [];
    const lead = leadTimeStats(months);
    const drift = driftStats(changes);
    const cadence = changeCadence(changes);
    const slotHour = newSlotHourHistogram(changes);
    const extremes = timeExtremes(months);
    const lastChange = changes[changes.length - 1] || null;
    return { loc, disp, lead, drift, cadence, slotHour, extremes, lastChange };
  });

  const textLines = [];
  const htmlLines = [];
  textLines.push('DMV Booking-Oriented Insights');
  htmlLines.push('<h3>DMV Booking-Oriented Insights</h3>');
  htmlLines.push('<p><strong>Legend:</strong><br>');
  htmlLines.push('Lead days: how far out the slots are (weighted by slot count).<br>');
  htmlLines.push('Drift: direction of earliest-date changes over recent observations; avg deltaDays is mean change magnitude (positive=later, negative=sooner).<br>');
  htmlLines.push('Change cadence: how many hours between detected changes (p10/median/p90).<br>');
  htmlLines.push('New-slot peak hour (UTC): hour of day when changes most often occur.<br>');
  htmlLines.push('Earliest/Latest slot time: min/max times seen in month data.<br>');
  htmlLines.push('Last change: most recent earliest-slot change and when it happened (HST).</p>');

  for (const s of locationSummaries) {
    textLines.push(`\n${s.disp}:`);
    textLines.push('  - Lead days (weighted by slots): ' + (s.lead
      ? `min ${s.lead.min.toFixed(1)}, p10 ${s.lead.p10.toFixed(1)}, median ${s.lead.p50.toFixed(1)}, p90 ${s.lead.p90.toFixed(1)}, max ${s.lead.max.toFixed(1)}`
      : 'n/a'));
    textLines.push('  - Drift (last changes): ' + (s.drift
      ? `${Object.entries(s.drift.dirs).map(([k,v])=>`${k}:${v}`).join(', ')}; avg deltaDays ${s.drift.avgDelta.toFixed(2)}`
      : 'n/a'));
    textLines.push('  - Change cadence (hrs): ' + (s.cadence
      ? `p10 ${s.cadence.p10H.toFixed(1)}, median ${s.cadence.medianH.toFixed(1)}, p90 ${s.cadence.p90H.toFixed(1)}`
      : 'n/a'));
    textLines.push('  - New-slot peak hour (UTC): ' + (s.slotHour.top
      ? `${s.slotHour.top[0]}h (${s.slotHour.top[1]} changes)`
      : 'n/a'));
    textLines.push(`  - Earliest slot time: ${s.extremes.earliest}, Latest slot time: ${s.extremes.latest}`);
    if (s.lastChange) {
      textLines.push(`  - Last change: ${s.lastChange.toDataVal || '(unknown)'} @ ${formatHst(s.lastChange.changedAt)}`);
    }

    const htmlParts = [];
    htmlParts.push(`<strong>${s.disp}</strong>`);
    htmlParts.push('<ul>');
    htmlParts.push(
      `<li>Lead days (weighted by slots): ${
        s.lead
          ? `min ${s.lead.min.toFixed(1)}, p10 ${s.lead.p10.toFixed(1)}, median ${s.lead.p50.toFixed(
              1
            )}, p90 ${s.lead.p90.toFixed(1)}, max ${s.lead.max.toFixed(1)}`
          : 'n/a'
      }</li>`
    );
    htmlParts.push(
      `<li>Drift (last changes): ${
        s.drift
          ? `${Object.entries(s.drift.dirs)
              .map(([k, v]) => `${k}:${v}`)
              .join(', ')}; avg deltaDays ${s.drift.avgDelta.toFixed(2)}`
          : 'n/a'
      }</li>`
    );
    htmlParts.push(
      `<li>Change cadence (hrs): ${
        s.cadence
          ? `p10 ${s.cadence.p10H.toFixed(1)}, median ${s.cadence.medianH.toFixed(
              1
            )}, p90 ${s.cadence.p90H.toFixed(1)}`
          : 'n/a'
      }</li>`
    );
    htmlParts.push(
      `<li>New-slot peak hour (UTC): ${
        s.slotHour.top ? `${s.slotHour.top[0]}h (${s.slotHour.top[1]} changes)` : 'n/a'
      }</li>`
    );
    htmlParts.push(`<li>Earliest slot time: ${s.extremes.earliest}, Latest slot time: ${s.extremes.latest}</li>`);
    if (s.lastChange) {
      htmlParts.push(
        `<li>Last change: ${s.lastChange.toDataVal || '(unknown)'} @ ${formatHst(s.lastChange.changedAt)}</li>`
      );
    }
    htmlParts.push('</ul>');
    htmlLines.push(`<div>${htmlParts.join('\n')}</div>`);
  }

  const textBody = textLines.join('\n');
  const htmlBody = htmlLines.join('\n');

  try {
    if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(REPORT_DIR, 'booking-latest.txt'), textBody, 'utf8');
    fs.writeFileSync(path.join(REPORT_DIR, 'booking-latest.html'), htmlBody, 'utf8');
    fs.appendFileSync(path.join(REPORT_DIR, 'booking-run-log.txt'), `\n---- ${ts} ----\n${textBody}\n`, 'utf8');
  } catch (e) {
    console.log(`Warning: failed to write booking report files: ${e && e.message ? e.message : e}`);
  }

  console.log(textBody);

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `booking_text_body<<EOF\n${textBody}\nEOF\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `booking_html_body<<EOF\n${htmlBody}\nEOF\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `booking_subject=DMV booking analysis report\n`);
  }
}

analyze();
