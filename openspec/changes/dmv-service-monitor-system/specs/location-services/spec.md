# Location Services Spec

> **Last Updated:** February 2026

---

## ADDED Requirements

### Requirement: Central location_services registry table

The system SHALL maintain a `location_services` table as the single source of truth for all location/service combinations (~88 total). This table combines service registry, tier tracking, and booking enablement.

#### Scenario: All discovered combos in single table
- **WHEN** querying for any location/service information
- **THEN** the `location_services` table SHALL contain all ~88 combinations discovered by the discovery scanner

#### Scenario: Single lookup for service metadata
- **WHEN** the booking bot needs location_code and service_trans_val for a bookable service
- **THEN** it SHALL query `location_services` by ID to get all required fields in one query

---

### Requirement: Source identification

Each location_service row SHALL identify which DMV website it belongs to via a `source` column.

| Column | Type | Description |
|--------|------|-------------|
| `source` | TEXT | Which site: 'main' (default) or 'road_test' |

#### Scenario: Scanner selects correct site
- **WHEN** a tier scanner polls a location_service with `source = 'road_test'`
- **THEN** it SHALL use the road test site URL and scraper logic

#### Scenario: Scanner selects main site
- **WHEN** a tier scanner polls a location_service with `source = 'main'`
- **THEN** it SHALL use the main DMV appointment site URL and scraper logic

---

### Requirement: Location identification columns

Each location_service row SHALL store location identification.

| Column | Type | Description |
|--------|------|-------------|
| `location_code` | TEXT | Site-specific code (e.g., 'KAPA' for main, 'wahiawa' for road_test) |
| `location_name` | TEXT | Human-readable full name (e.g., 'Kapalama Driver License, State ID') |
| `location_category` | TEXT | Category ('driver_license', 'satellite_dl', 'satellite_other', 'road_test') |

#### Scenario: Location code matches DMV selector (main site)
- **WHEN** a location_service has `source = 'main'` and `location_code = 'KAPA'`
- **THEN** the scanner SHALL use selector `.location.button-look.next[data-loc-val="KAPA"]`

#### Scenario: Location code used for road test site
- **WHEN** a location_service has `source = 'road_test'` and `location_code = 'wahiawa'`
- **THEN** the scanner SHALL use the road test site's location selection mechanism for Wahiawa

---

### Requirement: Service identification columns

Each location_service row SHALL store service identification matching the DMV website's transaction values.

| Column | Type | Description |
|--------|------|-------------|
| `service_trans_val` | TEXT | DMV's data-trans-val (e.g., '186', '256') |
| `service_name` | TEXT | Human-readable name (e.g., 'Out Of State Transfer') |

#### Scenario: Service trans_val used for selection
- **WHEN** scanning a location_service with `service_trans_val = '256'`
- **THEN** the scanner SHALL use selector `.transaction.button-look[data-trans-val="256"]`

#### Scenario: Unique constraint on source + location + service
- **WHEN** inserting a location_service row
- **THEN** the database SHALL enforce UNIQUE(source, location_code, service_trans_val)

---

### Requirement: Status flags for bookable and monitoring states

Each location_service SHALL have two boolean flags controlling its behavior.

| Column | Default | Description |
|--------|---------|-------------|
| `is_bookable` | FALSE | Is this live for user booking? (Booking tier) |
| `monitoring_enabled` | TRUE | Admin toggle to stop/start tracking |

#### Scenario: Monitoring disabled excludes from scanning
- **WHEN** a location_service has `monitoring_enabled = false`
- **THEN** no tier scanner SHALL attempt to scan that service
- **AND** the service SHALL retain its tier assignment for when re-enabled

#### Scenario: Bookable service enables user queuing
- **WHEN** a location_service has `is_bookable = true`
- **THEN** users SHALL be able to create queue_entries referencing that location_service_id

#### Scenario: Bookable overrides monitoring_tier
- **WHEN** a location_service has `is_bookable = true`
- **THEN** it SHALL be polled by the Booking tier scanner regardless of `monitoring_tier` value

#### Scenario: Monitoring flag checked for scanning eligibility
- **WHEN** any tier scanner queries for services to poll
- **THEN** it SHALL filter by `monitoring_enabled = true`

---

### Requirement: Supply metrics from discovery scans

Each location_service SHALL track supply metrics updated by the discovery scanner.

| Column | Type | Description |
|--------|------|-------------|
| `slots_30day` | INTEGER | Available slots in next 30 days |
| `slots_60day` | INTEGER | Available slots in next 60 days |
| `soonest_date` | DATE | Earliest available appointment date |

#### Scenario: Discovery scan updates supply metrics
- **WHEN** the discovery scanner completes a scan for a location_service
- **THEN** `slots_30day`, `slots_60day`, and `soonest_date` SHALL be updated
- **AND** `last_discovery_at` SHALL be set to current timestamp

---

### Requirement: Velocity metrics from tier polling

Each location_service SHALL track velocity metrics for promotion/demotion logic.

| Column | Type | Description |
|--------|------|-------------|
| `prev_slots_30day` | INTEGER | Previous scan's slots_30day value |
| `slot_velocity` | INTEGER | Change between polls (current - previous) |

#### Scenario: Velocity calculated on each poll
- **WHEN** a tier scanner polls a location_service
- **THEN** `slot_velocity` SHALL be set to `new_slots_30day - prev_slots_30day`
- **AND** `prev_slots_30day` SHALL be set to the previous `slots_30day` value

---

### Requirement: Promotion tracking with date-based windows

Each location_service SHALL track promotion/demotion window start dates.

| Column | Type | Description |
|--------|------|-------------|
| `low_supply_start_date` | DATE | Start of low supply window (Tier 3 to 2) |
| `high_supply_start_date` | DATE | Start of high supply window (Tier 3 to 4) |
| `high_velocity_start_date` | DATE | Start of high velocity window (Tier 2 to 1) |
| `low_velocity_start_date` | DATE | Start of low velocity window (demotion) |

#### Scenario: Promotion date tracking starts on signal
- **WHEN** a Tier 3 service first detects `slots_30day < 30`
- **AND** `low_supply_start_date` is NULL
- **THEN** `low_supply_start_date` SHALL be set to current date

#### Scenario: Signal loss resets tracking
- **WHEN** a Tier 3 service with `low_supply_start_date` set
- **AND** `slots_30day >= 30` is detected
- **THEN** `low_supply_start_date` SHALL be set to NULL

---

### Requirement: Trend tracking for frozen tier

Each location_service SHALL track historical supply values for trend detection.

| Column | Type | Description |
|--------|------|-------------|
| `slots_30day_7d_ago` | INTEGER | Supply snapshot from 7 days ago |
| `slots_30day_30d_ago` | INTEGER | Supply snapshot from 30 days ago |

#### Scenario: Trend values updated periodically
- **WHEN** the frozen tier scanner runs daily
- **THEN** `slots_30day_7d_ago` SHALL be updated with the value from 7 days ago (from slot_snapshots)

#### Scenario: Downward trend calculation
- **WHEN** evaluating Tier 4 promotion
- **THEN** downward trend SHALL be calculated as `slots_30day_30d_ago - slots_30day`

---

### Requirement: Timestamps for monitoring and tier changes

Each location_service SHALL track key timestamps.

| Column | Type | Description |
|--------|------|-------------|
| `last_discovery_at` | TIMESTAMPTZ | Last discovery bot scan |
| `last_monitored_at` | TIMESTAMPTZ | Last tier monitor poll |
| `promoted_at` | TIMESTAMPTZ | When last promoted |
| `demoted_at` | TIMESTAMPTZ | When last demoted |
| `created_at` | TIMESTAMPTZ | Row creation time |
| `updated_at` | TIMESTAMPTZ | Last modification time |

#### Scenario: Promotion timestamp updated
- **WHEN** a service is promoted to a higher tier
- **THEN** `promoted_at` SHALL be set to current timestamp

#### Scenario: Stale service detection
- **WHEN** `last_discovery_at` is more than 24 hours ago
- **AND** discovery scanner is expected to run every 6 hours
- **THEN** the service MAY be flagged as stale for investigation

---

### Requirement: Database indexes for efficient queries

The `location_services` table SHALL have indexes optimized for common query patterns.

#### Scenario: Bookable services query
- **WHEN** the booking tier queries for bookable services
- **THEN** an index on `(is_bookable) WHERE is_bookable = TRUE` SHALL enable efficient lookup

#### Scenario: Tier-based monitoring queries
- **WHEN** a tier scanner queries for its assigned services
- **THEN** an index on `(monitoring_tier, monitoring_enabled) WHERE is_bookable = FALSE AND monitoring_enabled = TRUE` SHALL enable efficient lookup

#### Scenario: Location lookups
- **WHEN** querying by location_code
- **THEN** an index on `(location_code)` SHALL enable efficient lookup

---

### Requirement: Dynamic booking enablement workflow

Enabling a new service for booking SHALL require only database changes, no code modifications.

#### Scenario: Enable service for booking
- **WHEN** an admin sets `is_bookable = true` on a location_service row
- **THEN** the next booking tier scan SHALL include that service
- **AND** users SHALL be able to queue for that service

#### Scenario: Disable service for booking
- **WHEN** an admin sets `is_bookable = false` on a location_service row
- **THEN** the booking tier scanner SHALL no longer poll that service
- **AND** the service SHALL fall back to its `monitoring_tier` for scanning
- **AND** existing queue_entries SHALL remain but no new entries allowed
