# DMV Locations and Services - Delta Spec

> **Change:** dmv-service-monitor-system

---

## ADDED Requirements

### Requirement: Unified scanner architecture

All DMV monitoring SHALL be consolidated into a single `apps/dmv-service-monitor/` folder structure, replacing the separate monitoring-bot, forecasting-bot, and discovery-bot.

#### Scenario: Single codebase for all scanning
- **WHEN** scanning any location/service combination
- **THEN** the code SHALL reside in `apps/dmv-service-monitor/`

#### Scenario: Shared browser utilities
- **WHEN** any tier scanner needs to launch a browser
- **THEN** it SHALL use `apps/dmv-service-monitor/shared/browser.ts`

---

### Requirement: Dynamic service lookup from database

The monitoring system SHALL read location/service configurations from the `location_services` database table instead of hardcoded arrays.

#### Scenario: Booking tier reads from database
- **WHEN** the booking tier scanner starts
- **THEN** it SHALL query `SELECT * FROM location_services WHERE is_bookable = true AND monitoring_enabled = true`

#### Scenario: Configuration changes without code deployment
- **WHEN** a new service is added to `location_services` table
- **THEN** the next scanner run SHALL include that service without code changes

---

### Requirement: Discovery scanner seeds location_services

The discovery scanner SHALL populate the `location_services` table with all discovered location/service combinations.

#### Scenario: New combination discovered
- **WHEN** the discovery scanner finds a location/service combo not in `location_services`
- **THEN** it SHALL insert a new row with `monitoring_tier = 4`, `is_bookable = false`, and `monitoring_enabled = true`

#### Scenario: Existing combination updated
- **WHEN** the discovery scanner finds a combination already in `location_services`
- **THEN** it SHALL update `slots_30day`, `slots_60day`, `soonest_date`, and `last_discovery_at`

---

## REMOVED Requirements

### Requirement: Hardcoded LOCATIONS array in monitoring-bot

**Reason:** Replaced by database-driven location_services table lookup

**Migration:** The 4 currently tracked services (FSCH, HKAI, PEAR, WIND DL/ID Renewals) SHALL be seeded into `location_services` with `is_bookable = true` during migration

---

### Requirement: Separate forecasting-bot for days 31-60

**Reason:** Redundant - discovery bot already scans the 60-day window

**Migration:** Delete `apps/forecasting-bot/` folder entirely; discovery bot's `slots_60day` metric provides equivalent data

---

### Requirement: Separate discovery-bot folder

**Reason:** Absorbed into unified `apps/dmv-service-monitor/discovery/` structure

**Migration:** Move discovery logic to `apps/dmv-service-monitor/discovery/scanner.ts` and `tier-sync.ts`
