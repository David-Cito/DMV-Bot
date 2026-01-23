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

  const SAMPLE_LIMIT = 3;

  async function safeProbe(table, orderColumn, limit = SAMPLE_LIMIT) {
    let query = supabase.from(table).select('*');
    if (orderColumn) {
      query = query.order(orderColumn, { ascending: false });
    }
    const { data, error } = await query.limit(limit);
    if (error) return { name: table, ok: false, error: error.message };
    return { name: table, ok: true, samples: data || [] };
  }

  const fallbackTables = [
    'locations',
    'runs',
    'day_snapshots',
    'slot_states',
    'run_slot_counts',
    'analysis_runs',
    'analysis_rollups_daily',
    'notification_subscribers',
    'notification_state',
    'customers',
    'queue_entries',
    'target_window_presets',
    'user_target_window_selections',
    'user_location_preferences',
    'queue_watermarks',
    'booking_attempts',
    'booking_locks',
    'message_log',
  ];

  const fallbackViews = [
    'analysis_windows',
    'analysis_windows_exclusive',
    'analysis_windows_exclusive_hst',
  ];

  async function fetchPublicTables() {
    const { data, error } = await supabase
      .schema('information_schema')
      .from('tables')
      .select('table_name, table_type, table_schema')
      .eq('table_schema', 'public')
      .eq('table_type', 'BASE TABLE')
      .order('table_name', { ascending: true });
    if (error) throw error;
    return (data || []).map((row) => row.table_name);
  }

  async function fetchPublicViews() {
    const { data, error } = await supabase
      .schema('information_schema')
      .from('views')
      .select('table_name, table_schema')
      .eq('table_schema', 'public')
      .order('table_name', { ascending: true });
    if (error) throw error;
    return (data || []).map((row) => row.table_name);
  }

  async function fetchColumns() {
    const { data, error } = await supabase
      .schema('information_schema')
      .from('columns')
      .select('table_name, column_name, data_type, ordinal_position')
      .eq('table_schema', 'public')
      .order('table_name', { ascending: true })
      .order('ordinal_position', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function fetchFunctions() {
    const { data, error } = await supabase
      .schema('information_schema')
      .from('routines')
      .select('routine_name, routine_type, data_type')
      .eq('specific_schema', 'public')
      .order('routine_name', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  function pickLatestColumn(columns) {
    const candidates = [
      'updated_at',
      'created_at',
      'run_at',
      'captured_at',
      'last_seen',
      'sent_at',
      'attempt_at',
      'booked_at',
    ];
    for (const candidate of candidates) {
      if (columns.includes(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  let tables = [];
  let views = [];
  let columns = [];
  let functions = [];
  let schemaSource = 'information_schema';

  try {
    tables = await fetchPublicTables();
    views = await fetchPublicViews();
    columns = await fetchColumns();
    functions = await fetchFunctions();
  } catch (err) {
    schemaSource = 'fallback';
    tables = fallbackTables;
    views = fallbackViews;
  }

  const columnsByTable = new Map();
  for (const column of columns) {
    if (!columnsByTable.has(column.table_name)) {
      columnsByTable.set(column.table_name, []);
    }
    columnsByTable.get(column.table_name).push({
      column_name: column.column_name,
      data_type: column.data_type,
    });
  }

  const counts = [];
  for (const table of tables) {
    counts.push(await safeCount(table));
  }

  const latest = [];
  for (const table of tables) {
    const tableColumns = columnsByTable.get(table) || [];
    const latestColumn = pickLatestColumn(tableColumns.map((col) => col.column_name));
    if (latestColumn) {
      latest.push(await safeLatest(table, latestColumn));
    } else {
      latest.push({ table_name: table, latest_at: null });
    }
  }

  let recentRuns = [];
  if (tables.includes('analysis_runs')) {
    const { data, error } = await supabase
      .from('analysis_runs')
      .select('id,job_type,run_at')
      .order('run_at', { ascending: false })
      .limit(10);
    if (error) throw error;
    recentRuns = data || [];
  }

  const tableChecks = [];
  for (const table of tables) {
    const tableColumns = columnsByTable.get(table) || [];
    const latestColumn = pickLatestColumn(tableColumns.map((col) => col.column_name));
    tableChecks.push(await safeProbe(table, latestColumn));
  }

  const viewChecks = [];
  for (const view of views) {
    const viewColumns = columnsByTable.get(view) || [];
    const latestColumn = pickLatestColumn(viewColumns.map((col) => col.column_name));
    viewChecks.push(await safeProbe(view, latestColumn));
  }

  const report = {
    tables: tableChecks,
    views: viewChecks,
    functions,
    counts,
    latest,
    recent_analysis_runs: recentRuns || [],
    schema: {
      source: schemaSource,
      tables: [...columnsByTable.entries()].map(([table_name, cols]) => ({
        table_name,
        columns: cols,
      })),
    },
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
