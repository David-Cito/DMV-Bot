-- Supabase backend health check for DMV Bot
-- Run this in Supabase SQL Editor to verify schema + recent data.

-- 1) Tables + columns (public)
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

-- 2) Views (public)
select table_name as view_name
from information_schema.views
where table_schema = 'public'
order by table_name;

-- 3) Functions (public)
select routine_name, routine_type, data_type
from information_schema.routines
where specific_schema = 'public'
order by routine_name;

-- 4) Row counts (all public tables)
select relname as table_name, n_live_tup as row_count
from pg_stat_user_tables
order by relname;

-- 5) Latest run timestamps (core tables)
select 'day_snapshots' as table_name, max(captured_at) as latest_at
from public.day_snapshots
union all
select 'slot_states', max(last_seen) from public.slot_states
union all
select 'run_slot_counts', max(run_at) from public.run_slot_counts
union all
select 'analysis_runs', max(run_at) from public.analysis_runs;

-- 6) Latest analysis runs
select id, job_type, run_at
from public.analysis_runs
order by run_at desc
limit 10;

-- 7) Single JSON report (easy to copy/paste)
with
  tables as (
    select
      table_name,
      jsonb_agg(
        jsonb_build_object('column_name', column_name, 'data_type', data_type)
        order by ordinal_position
      ) as columns
    from information_schema.columns
    where table_schema = 'public'
    group by table_name
    order by table_name
  ),
  views as (
    select jsonb_agg(table_name order by table_name) as view_names
    from information_schema.views
    where table_schema = 'public'
  ),
  functions as (
    select jsonb_agg(
      jsonb_build_object(
        'routine_name', routine_name,
        'routine_type', routine_type,
        'data_type', data_type
      ) order by routine_name
    ) as rows
    from information_schema.routines
    where specific_schema = 'public'
  ),
  counts as (
    select relname as table_name, n_live_tup as row_count
    from pg_stat_user_tables
    order by relname
  ),
  latest as (
    select 'day_snapshots' as table_name, max(captured_at) as latest_at
    from public.day_snapshots
    union all
    select 'slot_states', max(last_seen) from public.slot_states
    union all
    select 'run_slot_counts', max(run_at) from public.run_slot_counts
    union all
    select 'analysis_runs', max(run_at) from public.analysis_runs
  ),
  recent_analysis as (
    select jsonb_agg(
      jsonb_build_object('id', id, 'job_type', job_type, 'run_at', run_at)
      order by run_at desc
    ) as rows
    from (
      select id, job_type, run_at
      from public.analysis_runs
      order by run_at desc
      limit 10
    ) r
  )
select jsonb_pretty(
  jsonb_build_object(
    'tables', (select jsonb_agg(jsonb_build_object('table_name', table_name, 'columns', columns)) from tables),
    'views', (select coalesce(view_names, '[]'::jsonb) from views),
    'functions', (select coalesce(rows, '[]'::jsonb) from functions),
    'counts', (select jsonb_agg(jsonb_build_object('table_name', table_name, 'row_count', row_count)) from counts),
    'latest', (select jsonb_agg(jsonb_build_object('table_name', table_name, 'latest_at', latest_at)) from latest),
    'recent_analysis_runs', (select coalesce(rows, '[]'::jsonb) from recent_analysis)
  )
) as report;
