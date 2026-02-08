# Database - Delta Spec

> **Change:** dmv-service-monitor-system

---

## ADDED Requirements

### Requirement: location_services table

The system SHALL have a `location_services` table as the single source of truth for all location/service combinations.

```sql
CREATE TABLE location_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source identification
  source TEXT NOT NULL DEFAULT 'main',   -- 'main' or 'road_test'

  -- Location identification
  location_code TEXT NOT NULL,           -- e.g., 'KAPA' (main), 'wahiawa' (road_test)
  location_name TEXT NOT NULL,           -- e.g., 'Kapalama Driver License, State ID'
  location_category TEXT NOT NULL,       -- 'driver_license', 'satellite_dl', 'satellite_other', 'road_test'

  -- Service identification (matches discovery bot config)
  service_trans_val TEXT NOT NULL,       -- DMV website's data-trans-val
  service_name TEXT NOT NULL,            -- e.g., 'Out Of State Transfer'

  -- === STATUS FLAGS ===
  is_bookable BOOLEAN DEFAULT FALSE,     -- Is this live for booking? (Booking Tier)
  monitoring_enabled BOOLEAN DEFAULT TRUE, -- Admin toggle to stop/start tracking

  -- === MONITORING TIER ===
  -- Only applies when is_bookable = false
  -- 4 = Frozen (daily), 3 = Cold (6hr), 2 = Warm (30min), 1 = Hot (5min)
  monitoring_tier INTEGER DEFAULT 4,

  -- === SUPPLY METRICS (from discovery scans) ===
  slots_30day INTEGER DEFAULT 0,
  slots_60day INTEGER DEFAULT 0,
  soonest_date DATE,

  -- === VELOCITY METRICS (from tier 1/2 polling) ===
  prev_slots_30day INTEGER,
  slot_velocity INTEGER DEFAULT 0,       -- Change between polls

  -- === PROMOTION TRACKING (day-based windows) ===
  low_supply_start_date DATE,            -- Tier 3 -> 2 promotion
  high_supply_start_date DATE,           -- Tier 3 -> 4 demotion
  high_velocity_start_date DATE,         -- Tier 2 -> 1 promotion
  low_velocity_start_date DATE,          -- Tier 2 -> 3 / Tier 1 -> 2 demotion

  -- === TREND TRACKING (for Tier 4 -> 3) ===
  slots_30day_7d_ago INTEGER,
  slots_30day_30d_ago INTEGER,

  -- === TIMESTAMPS ===
  last_discovery_at TIMESTAMPTZ,         -- Last discovery bot scan
  last_monitored_at TIMESTAMPTZ,         -- Last multi-tier monitor poll
  promoted_at TIMESTAMPTZ,               -- When last promoted
  demoted_at TIMESTAMPTZ,                -- When last demoted
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- === CONSTRAINTS ===
  UNIQUE(source, location_code, service_trans_val)
);

-- Index for finding all bookable services (live booking tier)
CREATE INDEX idx_location_services_bookable ON location_services (is_bookable)
  WHERE is_bookable = TRUE AND monitoring_enabled = TRUE;

-- Index for tier-based monitoring queries
CREATE INDEX idx_location_services_tier ON location_services (monitoring_tier, monitoring_enabled)
  WHERE is_bookable = FALSE AND monitoring_enabled = TRUE;

-- Index for location lookups
CREATE INDEX idx_location_services_location ON location_services (location_code);

-- Index for source-based queries
CREATE INDEX idx_location_services_source ON location_services (source);
```

#### Scenario: Location_services table created
- **WHEN** the migration runs
- **THEN** the `location_services` table SHALL exist with all specified columns

#### Scenario: Unique constraint enforced
- **WHEN** inserting a duplicate source + location_code + service_trans_val combination
- **THEN** the database SHALL reject the insert with a unique constraint violation

#### Scenario: Status flag columns exist
- **WHEN** the migration runs
- **THEN** `location_services` SHALL have `is_bookable` (default FALSE) and `monitoring_enabled` (default TRUE) columns

---

### Requirement: slot_snapshots table

The system SHALL have a `slot_snapshots` table for compressed daily snapshots instead of per-slot rows.

```sql
CREATE TABLE slot_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_service_id UUID REFERENCES location_services(id) NOT NULL,
  scan_date DATE NOT NULL,
  slots_json JSONB,              -- ["09:00","09:15","10:30"]
  slots_count INTEGER DEFAULT 0,
  earliest_slot TIME,
  scanned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(location_service_id, scan_date)
);

CREATE INDEX idx_slot_snapshots_lookup ON slot_snapshots (location_service_id, scan_date);
```

#### Scenario: Daily snapshot stored efficiently
- **WHEN** a tier scanner records available slots for a date
- **THEN** all slot times SHALL be stored in a single `slots_json` array per date

#### Scenario: One snapshot per service per date
- **WHEN** inserting a slot_snapshot
- **THEN** the UNIQUE(location_service_id, scan_date) constraint SHALL be enforced

---

## MODIFIED Requirements

### Requirement: queue_entries table

User's place in the system (waitlist, pre-queue, or queue).

```sql
CREATE TABLE queue_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) NOT NULL,
  location_id       UUID REFERENCES locations(id),  -- Made nullable
  location_service_id UUID REFERENCES location_services(id) NOT NULL,  -- NEW: Required

  -- User preferences
  tier              TEXT NOT NULL, -- 'priority' or 'flexible'
  time_preference   TEXT, -- 'morning', 'midday', 'afternoon', or NULL (any)

  -- State
  state             TEXT NOT NULL DEFAULT 'waiting',
  -- States: waiting, invited, ready, active, booking, booked,
  --         payment_issue, confirmed, completed, canceled, expired

  -- Booking tracking (when state = 'booking')
  booking_bot_id    UUID,
  booking_started_at TIMESTAMP,
  booking_slot_id   UUID,

  -- Timestamps
  invited_at        TIMESTAMP,
  deposit_paid_at   TIMESTAMP,
  queue_entered_at  TIMESTAMP,
  booked_at         TIMESTAMP,

  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW(),

  UNIQUE (user_id, location_service_id)  -- Updated constraint
);

-- Updated indexes for queue queries
CREATE INDEX idx_queue_active ON queue_entries (location_service_id, state, tier, created_at)
  WHERE state = 'active';
CREATE INDEX idx_queue_waiting ON queue_entries (location_service_id, state, created_at)
  WHERE state = 'waiting';
CREATE INDEX idx_queue_invited ON queue_entries (state, invited_at)
  WHERE state = 'invited';
CREATE INDEX idx_queue_booking ON queue_entries (state, booking_started_at)
  WHERE state = 'booking';
```

#### Scenario: location_service_id added to queue_entries
- **WHEN** the migration runs
- **THEN** `queue_entries` SHALL have a `location_service_id` column referencing `location_services(id)`

#### Scenario: location_id made nullable
- **WHEN** the migration runs
- **THEN** `queue_entries.location_id` SHALL allow NULL values for new entries

#### Scenario: New entries require location_service_id
- **WHEN** inserting a new queue_entry
- **THEN** `location_service_id` SHALL be required (NOT NULL)

---

### Requirement: bookings table

Successful bookings.

```sql
CREATE TABLE bookings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) NOT NULL,
  queue_entry_id    UUID REFERENCES queue_entries(id) NOT NULL,
  location_id       UUID REFERENCES locations(id),  -- Made nullable
  location_service_id UUID REFERENCES location_services(id) NOT NULL,  -- NEW: Required

  -- Appointment details
  appointment_date  DATE NOT NULL,
  appointment_time  TIME NOT NULL,

  -- DMV confirmation
  dmv_confirmation_number TEXT,

  -- Status
  status            TEXT NOT NULL DEFAULT 'booked', -- booked, confirmed, canceled, completed
  cancel_window_ends_at TIMESTAMP,

  -- Payment
  booking_fee_cents INTEGER NOT NULL,
  stripe_charge_id  TEXT,

  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_bookings_user ON bookings (user_id, created_at DESC);
CREATE INDEX idx_bookings_status ON bookings (status, created_at DESC);
CREATE INDEX idx_bookings_location_service ON bookings (location_service_id, created_at DESC);
```

#### Scenario: location_service_id added to bookings
- **WHEN** the migration runs
- **THEN** `bookings` SHALL have a `location_service_id` column referencing `location_services(id)`

#### Scenario: location_id made nullable in bookings
- **WHEN** the migration runs
- **THEN** `bookings.location_id` SHALL allow NULL values for new bookings

---

## ADDED Requirements

### Requirement: Cleanup service prunes old snapshots

The cleanup service SHALL delete slot_snapshots older than 7 days to manage storage.

```sql
DELETE FROM slot_snapshots WHERE scanned_at < NOW() - INTERVAL '7 days';
```

#### Scenario: Old snapshots deleted
- **WHEN** the cleanup job runs
- **THEN** slot_snapshots older than 7 days SHALL be deleted

---

### Requirement: Cleanup service prunes old bot_runs

The cleanup service SHALL delete bot_runs older than 3 days to manage storage.

```sql
DELETE FROM bot_runs WHERE started_at < NOW() - INTERVAL '3 days';
```

#### Scenario: Old bot_runs deleted
- **WHEN** the cleanup job runs
- **THEN** bot_runs older than 3 days SHALL be deleted
