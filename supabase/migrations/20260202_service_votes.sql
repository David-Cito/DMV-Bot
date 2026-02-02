-- Service Votes: Track user interest in services we don't yet support
-- Migration: 20260202_service_votes.sql

CREATE TABLE service_votes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone                 TEXT NOT NULL,
  service_type          TEXT NOT NULL,
  description           TEXT,
  notify_when_available BOOLEAN DEFAULT FALSE,
  notified_at           TIMESTAMP,
  created_at            TIMESTAMP DEFAULT NOW()
);

-- Index for counting votes by service type
CREATE INDEX idx_service_votes_type ON service_votes (service_type);

-- Index for finding users to notify on launch
CREATE INDEX idx_service_votes_notify ON service_votes (service_type, notify_when_available)
  WHERE notify_when_available = TRUE AND notified_at IS NULL;

-- Valid service_type values (enforced in application):
-- 'license_id_duplicate'
-- 'permit_renewal'
-- 'motor_vehicle_services'
-- 'instruction_permit'
-- 'out_of_state_transfer'
-- 'state_id_initial'
-- 'other'
