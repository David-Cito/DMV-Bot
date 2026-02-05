-- Migration: Schema Introspection Functions
-- Helper functions for the health check script to dynamically discover tables and functions

-- Function to list all public tables
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

-- Function to list all public views
CREATE OR REPLACE FUNCTION list_public_views()
RETURNS TABLE (view_name TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT viewname::TEXT
  FROM pg_views
  WHERE schemaname = 'public'
  ORDER BY viewname;
$$;

-- Function to list all public functions
CREATE OR REPLACE FUNCTION list_public_functions()
RETURNS TABLE (function_name TEXT, return_type TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT p.proname::TEXT, pg_get_function_result(p.oid)::TEXT
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
  ORDER BY p.proname;
$$;
