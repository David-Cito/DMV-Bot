#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANALYSIS_RUN_ID = process.env.ANALYSIS_RUN_ID;
const JOB_TYPE = process.env.JOB_TYPE;
const DASHBOARD_6H =
  'https://lookerstudio.google.com/reporting/771b7dc5-a778-46ec-ac39-4b9754daf63c';
const DASHBOARD_DAILY =
  'https://lookerstudio.google.com/reporting/d1d70d53-d262-4262-967d-c2081277bfff';
const DASHBOARD_WEEKLY =
  'https://lookerstudio.google.com/reporting/aef15ec3-6107-4849-9e52-6a9eed0d5531';

const HST_TIMEZONE = 'Pacific/Honolulu';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Supabase env vars not set; exiting.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function formatHst(date) {
  return date.toLocaleString('en-US', {
    timeZone: HST_TIMEZONE,
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return 'n/a';
  return `${(value * 100).toFixed(1)}%`;
}

function formatMinutes(value) {
  if (value == null || Number.isNaN(value)) return 'n/a';
  return `${Number(value).toFixed(1)}m`;
}

function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return 'n/a';
  return Number(value).toFixed(1);
}

function avg(values) {
  const filtered = values.filter((v) => v != null && !Number.isNaN(v));
  if (!filtered.length) return null;
  return filtered.reduce((sum, v) => sum + v, 0) / filtered.length;
}

function buildDashboardLinks() {
  const links = [];
  if (DASHBOARD_6H) links.push({ label: 'Six-Hour Report', url: DASHBOARD_6H });
  if (DASHBOARD_DAILY) links.push({ label: 'Daily Report', url: DASHBOARD_DAILY });
  if (DASHBOARD_WEEKLY) links.push({ label: 'Weekly Report', url: DASHBOARD_WEEKLY });
  return links;
}

function buildCondensedSummary(run, title) {
  const metrics = run.metrics_json || {};
  const windowStart = run.window_start ? formatHst(new Date(run.window_start)) : null;
  const windowEnd = run.window_end ? formatHst(new Date(run.window_end)) : null;
  const windowLabel = windowStart && windowEnd ? `${windowStart} - ${windowEnd}` : null;
  const windows = [1, 7, 30, 60];
  const exclusiveBuckets = ['0-7', '8-14', '15-30', '31-60'];

  if (run.job_type === 'six_hour') {
    const exclusiveTotals = metrics.totals_by_exclusive || {};
    const lines = [];
    lines.push('6-Hour Summary');
    if (windowLabel) lines.push(`Win: ${windowLabel}`);
    exclusiveBuckets.forEach((key) => {
      const w = exclusiveTotals[key] || {};
      lines.push(
        `${key}d: n=${w.new_count ?? 0} avg=${formatMinutes(w.avg_duration_min)} med=${formatMinutes(
          w.median_duration_min
        )}`
      );
    });
    return lines.join('\n');
  }

  const perLocation = Array.isArray(metrics.per_location) ? metrics.per_location : [];
  const lines = [];
  lines.push(title);
  if (windowLabel) lines.push(`Win: ${windowLabel}`);
  exclusiveBuckets.forEach((key) => {
    const values = perLocation.map((loc) => loc.exclusive_windows && loc.exclusive_windows[key]);
    const avgNew = avg(values.map((v) => v && v.avg_new_per_day));
    const medDur = avg(values.map((v) => v && v.median_duration_min));
    const hit = avg(values.map((v) => v && v.hit_rate));
    const burst = avg(values.map((v) => v && v.burstiness_ratio));
    lines.push(
      `${key}d: new/d=${formatNumber(avgNew)} med=${formatMinutes(
        medDur
      )} hit=${formatPercent(hit)} burst=${formatNumber(burst)}`
    );
  });

  return lines.join('\n');
}

function buildCondensedHtml(text) {
  return `<pre style="white-space:pre-wrap;font-family:Arial, sans-serif;">${text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')}</pre>`;
}

async function fetchRun() {
  if (ANALYSIS_RUN_ID) {
    const { data, error } = await supabase
      .from('analysis_runs')
      .select('*')
      .eq('id', ANALYSIS_RUN_ID)
      .single();
    if (error) throw error;
    return data;
  }

  if (JOB_TYPE) {
    const resolvedJobType = JOB_TYPE === 'weekly_summary' ? 'daily_summary' : JOB_TYPE;
    const { data, error } = await supabase
      .from('analysis_runs')
      .select('*')
      .eq('job_type', resolvedJobType)
      .order('run_at', { ascending: false })
      .limit(1)
      .single();
    if (error) throw error;
    return data;
  }

  throw new Error('ANALYSIS_RUN_ID or JOB_TYPE is required.');
}

async function main() {
  const run = await fetchRun();
  const runAt = run.run_at ? new Date(run.run_at) : new Date();
  const label =
    JOB_TYPE === 'weekly_summary'
      ? 'Weekly Summary'
      : run.job_type === 'daily_summary'
      ? 'Daily Summary'
      : '6-hour Analysis';
  const subject = `DMV ${label} – ${formatHst(runAt)}`;
  const condensedText = buildCondensedSummary(run, label);
  const textBody = condensedText || 'No summary text available.';
  const condensedHtml = buildCondensedHtml(textBody);
  const dashboardLinks = buildDashboardLinks();
  const dashboardHtml = dashboardLinks.length
    ? `<p>${dashboardLinks
        .map(
          (link) =>
            `<a href="${link.url}" target="_blank" rel="noopener noreferrer">${link.label}</a>`
        )
        .join(' | ')}</p>`
    : '';
  const htmlBody = `${dashboardHtml}${condensedHtml}`;

  const outFile = process.env.GITHUB_OUTPUT;
  if (outFile) {
    const fs = require('fs');
    fs.appendFileSync(outFile, `subject=${subject}\n`);
    fs.appendFileSync(outFile, `text_body<<EOF\n${textBody}\nEOF\n`);
    fs.appendFileSync(outFile, `html_body<<EOF\n${htmlBody}\nEOF\n`);
  }

  console.log(`Prepared email for analysis_run_id=${run.id}`);
}

main().catch((err) => {
  console.error('Failed to prepare analysis email:', err.message || err);
  process.exit(1);
});
