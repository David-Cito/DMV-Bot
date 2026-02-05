-- Migration: Schema Introspection Functions
-- Helper functions for the health check script to dynamically discover schema objects

-- ============================================================================
-- TABLES
-- ============================================================================

CREATE OR REPLACE FUNCTION list_public_tables()
RETURNS TABLE (table_name TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT tablename::TEXT
  FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY tablename;
$$;

-- ============================================================================
-- VIEWS
-- ============================================================================

CREATE OR REPLACE FUNCTION list_public_views()
RETURNS TABLE (view_name TEXT, view_definition TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT viewname::TEXT, definition::TEXT
  FROM pg_views
  WHERE schemaname = 'public'
  ORDER BY viewname;
$$;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION list_public_functions()
RETURNS TABLE (function_name TEXT, return_type TEXT, argument_types TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    p.proname::TEXT,
    pg_get_function_result(p.oid)::TEXT,
    pg_get_function_arguments(p.oid)::TEXT
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
  ORDER BY p.proname;
$$;

-- ============================================================================
-- COLUMNS
-- ============================================================================

CREATE OR REPLACE FUNCTION list_public_columns()
RETURNS TABLE (
  table_name TEXT,
  column_name TEXT,
  data_type TEXT,
  is_nullable TEXT,
  column_default TEXT,
  ordinal_position INT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    table_name::TEXT,
    column_name::TEXT,
    data_type::TEXT,
    is_nullable::TEXT,
    column_default::TEXT,
    ordinal_position::INT
  FROM information_schema.columns
  WHERE table_schema = 'public'
  ORDER BY table_name, ordinal_position;
$$;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE OR REPLACE FUNCTION list_public_indexes()
RETURNS TABLE (table_name TEXT, index_name TEXT, index_definition TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT tablename::TEXT, indexname::TEXT, indexdef::TEXT
  FROM pg_indexes
  WHERE schemaname = 'public'
  ORDER BY tablename, indexname;
$$;

-- ============================================================================
-- CONSTRAINTS (Primary Keys, Foreign Keys, Unique, Check)
-- ============================================================================

CREATE OR REPLACE FUNCTION list_public_constraints()
RETURNS TABLE (
  table_name TEXT,
  constraint_name TEXT,
  constraint_type TEXT,
  constraint_definition TEXT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    tc.table_name::TEXT,
    tc.constraint_name::TEXT,
    tc.constraint_type::TEXT,
    pg_get_constraintdef(pgc.oid)::TEXT
  FROM information_schema.table_constraints tc
  JOIN pg_constraint pgc ON tc.constraint_name = pgc.conname
  WHERE tc.table_schema = 'public'
  ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;
$$;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION list_public_triggers()
RETURNS TABLE (
  table_name TEXT,
  trigger_name TEXT,
  event TEXT,
  timing TEXT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    event_object_table::TEXT,
    trigger_name::TEXT,
    event_manipulation::TEXT,
    action_timing::TEXT
  FROM information_schema.triggers
  WHERE trigger_schema = 'public'
  ORDER BY event_object_table, trigger_name;
$$;
