#!/usr/bin/env node
// Uploads DMV bot results to Supabase (location-centric tables).
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const ROOT = process.cwd();
const RESULTS_PATH = path.join(ROOT, 'data', 'results', 'dmv-results.json');
const HISTORY_DIR = path.join(ROOT, 'data', 'history');
const HISTORY_PATH = path.join(HISTORY_DIR, 'dmv-history.json');
const DAY_HISTORY_PATH = path.join(HISTORY_DIR, 'dmv-day-history.json');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.log('Supabase env vars not set; skipping upload.');
  process.exit(0);
}

if (!fs.existsSync(RESULTS_PATH)) {
  console.log(`Results file not found: ${RESULTS_PATH}`);
  process.exit(0);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function parseTimeFromDataVal(dataVal) {
  if (!dataVal) return null;
  const parts = dataVal.split(' ');
  return parts[1] || null; // HH:mm:ss
}

function clearHistoryFiles() {
  if (!fs.existsSync(HISTORY_DIR)) return;
  const monthHistoryFiles = fs
    .readdirSync(HISTORY_DIR)
    .filter((file) => /^dmv-month-history-.*\.json$/i.test(file))
    .map((file) => path.join(HISTORY_DIR, file));
  const filesToClear = [HISTORY_PATH, DAY_HISTORY_PATH, ...monthHistoryFiles];
  for (const filePath of filesToClear) {
    try {
      if (fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '', 'utf8');
      }
    } catch (e) {
      console.log(`Failed to clear history file ${filePath}: ${e?.message || e}`);
    }
  }
  console.log(`Cleared ${filesToClear.length} history file(s) after upload.`);
}

async function getLocationId(name) {
  const { data, error } = await supabase
    .from('locations')
    .upsert({ name }, { onConflict: 'name' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function insertInChunks(table, rows, chunkSize = 500) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    if (!chunk.length) continue;
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw error;
  }
}

async function upsertSlotStatesInChunks(rows, chunkSize = 500) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    if (!chunk.length) continue;
    const { error } = await supabase.rpc('upsert_slot_states', {
      rows: chunk,
    });
    if (error) throw error;
  }
}

async function main() {
  const payload = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
  const runAt = payload.generatedAt || new Date().toISOString();
  const results = Array.isArray(payload.results) ? payload.results : [];

  const { data: runRow, error: runError } = await supabase
    .from('runs')
    .insert({ run_at: runAt, source: 'github-actions' })
    .select('id')
    .single();
  if (runError) throw runError;
  const runId = runRow.id;

  const daySnapshotRows = [];
  const slotStateRows = [];
  const runSlotCounts = [];

  for (const res of results) {
    if (!res || !res.locationName) continue;
    const locationId = await getLocationId(res.locationName);

    if (Array.isArray(res.daySlots) && res.dateText) {
      daySnapshotRows.push({
        location_id: locationId,
        captured_at: runAt,
        date: res.dateText,
        slots: res.daySlots,
      });
    }

    if (Array.isArray(res.monthSlots)) {
      let slotCount = 0;
      for (const day of res.monthSlots) {
        if (!day || !day.date || !Array.isArray(day.slots)) continue;
        for (const slot of day.slots) {
          const time = parseTimeFromDataVal(slot && slot.dataVal);
          if (!time) continue;
          slotCount += 1;
          slotStateRows.push({
            location_id: locationId,
            date: day.date,
            time,
            first_seen: runAt,
            last_seen: runAt,
          });
        }
      }
      runSlotCounts.push({
        run_at: runAt,
        location_id: locationId,
        slots_total: slotCount,
      });
    }
  }

  if (daySnapshotRows.length) {
    await insertInChunks('day_snapshots', daySnapshotRows);
  }

  if (slotStateRows.length) {
    await upsertSlotStatesInChunks(slotStateRows);
  }

  if (runSlotCounts.length) {
    await insertInChunks('run_slot_counts', runSlotCounts);
  }

  console.log(
    `Supabase upload complete. Run ${runId}. day_snapshots=${daySnapshotRows.length}, slot_states=${slotStateRows.length}`
  );
  clearHistoryFiles();
}

main().catch((err) => {
  console.error('Supabase upload failed:', err.message || err);
  process.exit(1);
});
