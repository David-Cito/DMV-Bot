-- Migration: Add code column to locations table
-- Provides a stable, snake_case identifier for each location
-- See openspec/specs/database/spec.md

-- ============================================================================
-- ADD CODE COLUMN TO LOCATIONS
-- ============================================================================

-- Add the code column (nullable initially for existing rows)
ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS code TEXT;

-- Populate codes for existing locations based on name patterns
UPDATE locations SET code = 'downtown'
  WHERE name ILIKE '%downtown%' AND code IS NULL;

UPDATE locations SET code = 'hawaii_kai'
  WHERE name ILIKE '%hawaii kai%' AND code IS NULL;

UPDATE locations SET code = 'pearlridge'
  WHERE name ILIKE '%pearlridge%' AND code IS NULL;

UPDATE locations SET code = 'windward'
  WHERE name ILIKE '%windward%' AND code IS NULL;

-- Now make code NOT NULL and UNIQUE
ALTER TABLE locations
  ALTER COLUMN code SET NOT NULL;

ALTER TABLE locations
  ADD CONSTRAINT locations_code_unique UNIQUE (code);

-- Create index for lookups by code
CREATE INDEX IF NOT EXISTS idx_locations_code ON locations (code);

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
