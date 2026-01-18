#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Supabase env vars not set; exiting.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const ROOT = path.join(__dirname, '..', '..');
const RESULTS_DIR = path.join(ROOT, 'data', 'results');
const HEALTH_PATH = path.join(RESULTS_DIR, 'supabase-health-check.json');
const CHARTS_PATH = path.join(ROOT, 'data', 'results', 'supabase-charts.json');

async function main() {
  const knownTables = [
    'locations',
    'runs',
    'day_snapshots',
    'slot_states',
    'run_slot_counts',
    'analysis_runs',
    'analysis_rollups_daily',
    'notification_subscribers',
    'notification_state',
  ];

  const knownViews = ['analysis_windows'];

  async function safeCount(table) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    if (error) return { table_name: table, row_count: null, error: error.message };
    return { table_name: table, row_count: count || 0 };
  }

  async function safeLatest(table, column) {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .order(column, { ascending: false })
      .limit(1);
    if (error) return { table_name: table, latest_at: null, error: error.message };
    return { table_name: table, latest_at: data && data.length ? data[0][column] : null };
  }

  async function safeProbe(table, orderColumn) {
    let query = supabase.from(table).select('*');
    if (orderColumn) {
      query = query.order(orderColumn, { ascending: false });
    }
    const { data, error } = await query.limit(1);
    if (error) return { name: table, ok: false, error: error.message };
    return { name: table, ok: true, sample: data && data.length ? data[0] : null };
  }

  const counts = [];
  for (const table of knownTables) {
    counts.push(await safeCount(table));
  }

  const latest = [
    await safeLatest('day_snapshots', 'captured_at'),
    await safeLatest('slot_states', 'last_seen'),
    await safeLatest('run_slot_counts', 'run_at'),
    await safeLatest('analysis_runs', 'run_at'),
  ];

  const { data: recentRuns, error: recentErr } = await supabase
    .from('analysis_runs')
    .select('id,job_type,run_at')
    .order('run_at', { ascending: false })
    .limit(10);
  if (recentErr) throw recentErr;

  const tableOrderMap = {
    locations: 'created_at',
    runs: 'run_at',
    day_snapshots: 'captured_at',
    slot_states: 'last_seen',
    run_slot_counts: 'run_at',
    analysis_runs: 'run_at',
    analysis_rollups_daily: 'updated_at',
    notification_subscribers: 'created_at',
    notification_state: 'last_notified_at',
  };

  const viewOrderMap = {
    analysis_windows: 'run_at',
  };

  const tableChecks = [];
  for (const table of knownTables) {
    tableChecks.push(await safeProbe(table, tableOrderMap[table]));
  }
  const viewChecks = [];
  for (const view of knownViews) {
    viewChecks.push(await safeProbe(view, viewOrderMap[view]));
  }

  const report = {
    tables: tableChecks,
    views: viewChecks,
    counts,
    latest,
    recent_analysis_runs: recentRuns || [],
    charts: [],
  };

  if (fs.existsSync(CHARTS_PATH)) {
    try {
      const raw = fs.readFileSync(CHARTS_PATH, 'utf8');
      report.charts = JSON.parse(raw);
    } catch (err) {
      report.charts = [{ error: `Failed to read ${CHARTS_PATH}: ${err.message || err}` }];
    }
  }

  const payload = {
    run_at: new Date().toISOString(),
    report,
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(HEALTH_PATH, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Wrote health check to ${HEALTH_PATH}`);
}

main().catch((err) => {
  console.error('Health check failed:', err.message || err);
  process.exit(1);
});
