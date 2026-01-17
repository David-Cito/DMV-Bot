#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANALYSIS_RUN_ID = process.env.ANALYSIS_RUN_ID;
const JOB_TYPE = process.env.JOB_TYPE;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Supabase env vars not set; exiting.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function formatHst(date) {
  return date.toLocaleString('en-US', {
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
    const { data, error } = await supabase
      .from('analysis_runs')
      .select('*')
      .eq('job_type', JOB_TYPE)
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
  const label = run.job_type === 'daily_summary' ? 'Daily Summary' : '6-hour Analysis';
  const subject = `DMV ${label} – ${formatHst(runAt)}`;
  const textBody = run.summary_text || 'No summary text available.';
  const htmlBody = run.summary_html
    ? run.summary_html
    : `<pre>${textBody.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`;

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
