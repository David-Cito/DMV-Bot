# Tiered Monitoring Spec

> **Last Updated:** February 2026

---

## ADDED Requirements

### Requirement: Five-tier monitoring system

The system SHALL support five distinct monitoring tiers, each with a specific polling frequency and monitoring goal:

| Tier | Name | Poll Rate | Goal |
|------|------|-----------|------|
| Booking | Live | Every 2 min | Revenue generation for bookable services |
| Tier 1 | Hot | Every 5 min | Demand validation via high-frequency velocity tracking |
| Tier 2 | Warm | Every 30 min | Velocity detection to identify active demand |
| Tier 3 | Cold | Every 6 hr | Baseline supply monitoring via discovery scans |
| Tier 4 | Frozen | Daily | Long-term trend tracking for dormant services |

#### Scenario: Service assigned to correct tier poll rate
- **WHEN** a location_service has `monitoring_tier = 2` and `is_bookable = false`
- **THEN** the warm tier scanner SHALL poll that service every 30 minutes

#### Scenario: Booking tier services polled at highest frequency
- **WHEN** a location_service has `is_bookable = true`
- **THEN** the booking tier scanner SHALL poll that service every 2 minutes regardless of `monitoring_tier` value

---

### Requirement: Per-location-service tier granularity

Each location/service combination SHALL be tiered independently based on its own metrics. The same service type at different locations MAY have different tiers.

#### Scenario: Same service different tiers at different locations
- **WHEN** "Out of State Transfer" at Kapalama has high velocity
- **AND** "Out of State Transfer" at Wahiawa has abundant supply
- **THEN** Kapalama SHALL be at a higher tier (e.g., Tier 1) than Wahiawa (e.g., Tier 3)

#### Scenario: Tier assignment stored per location_service row
- **WHEN** querying location_services for monitoring
- **THEN** each row SHALL have its own `monitoring_tier` value independent of other rows with the same service_trans_val

---

### Requirement: Day-based promotion windows

The system SHALL require 3 consecutive days of consistent signal before promoting a service to a higher tier. This prevents noise-driven tier changes.

#### Scenario: Promotion requires sustained signal
- **WHEN** a Tier 3 service has `slots_30day < 30` for only 2 consecutive days
- **AND** on day 3 the supply increases to 35 slots
- **THEN** the service SHALL remain at Tier 3 and `low_supply_start_date` SHALL be reset to NULL

#### Scenario: Promotion triggers after 3 days
- **WHEN** a Tier 3 service has `slots_30day < 30` for 3 consecutive days
- **THEN** the service SHALL be promoted to Tier 2 and `promoted_at` SHALL be set to current timestamp

---

### Requirement: Longer demotion windows to prevent flapping

Demotion windows SHALL be longer than promotion windows to prevent services bouncing between tiers.

| Demotion Path | Window |
|---------------|--------|
| Tier 3 to Tier 4 | 3 days of high supply |
| Tier 2 to Tier 3 | 5 days of low velocity |
| Tier 1 to Tier 2 | 7 days of low velocity |
| Booking to Tier 1 | Manual decision only |

#### Scenario: Tier 2 demotion requires 5 days
- **WHEN** a Tier 2 service has velocity |delta| < 2 for 4 consecutive days
- **THEN** the service SHALL remain at Tier 2

#### Scenario: Tier 2 demotion triggers after 5 days
- **WHEN** a Tier 2 service has velocity |delta| < 2 for 5 consecutive days
- **THEN** the service SHALL be demoted to Tier 3 and `demoted_at` SHALL be set to current timestamp

---

### Requirement: Tier 4 to Tier 3 promotion (supply threshold or trend)

A Frozen (Tier 4) service SHALL be promoted to Cold (Tier 3) when supply drops below 100 slots OR a downward trend is detected (20+ fewer slots vs 30 days ago).

#### Scenario: Promotion on supply threshold
- **WHEN** a Tier 4 service has `slots_30day < 100`
- **THEN** the service SHALL be promoted to Tier 3

#### Scenario: Promotion on downward trend
- **WHEN** a Tier 4 service has `slots_30day_30d_ago - slots_30day >= 20`
- **THEN** the service SHALL be promoted to Tier 3 even if current supply is >= 100

---

### Requirement: Tier 3 to Tier 2 promotion (low supply threshold)

A Cold (Tier 3) service SHALL be promoted to Warm (Tier 2) when supply remains below 30 slots for 3 consecutive days.

#### Scenario: Low supply triggers promotion tracking
- **WHEN** a Tier 3 service scan returns `slots_30day < 30`
- **AND** `low_supply_start_date` is NULL
- **THEN** `low_supply_start_date` SHALL be set to current date

#### Scenario: Supply recovery resets tracking
- **WHEN** a Tier 3 service has `low_supply_start_date` set
- **AND** a scan returns `slots_30day >= 30`
- **THEN** `low_supply_start_date` SHALL be reset to NULL

---

### Requirement: Tier 2 to Tier 1 promotion (velocity threshold)

A Warm (Tier 2) service SHALL be promoted to Hot (Tier 1) when slot velocity (|delta| >= 2) is detected for 3 consecutive days.

#### Scenario: Velocity calculation
- **WHEN** a Tier 2 service is scanned
- **THEN** `slot_velocity` SHALL be calculated as `current_slots_30day - prev_slots_30day`

#### Scenario: High velocity triggers promotion tracking
- **WHEN** a Tier 2 service has |slot_velocity| >= 2
- **AND** `high_velocity_start_date` is NULL
- **THEN** `high_velocity_start_date` SHALL be set to current date

#### Scenario: Low velocity resets tracking
- **WHEN** a Tier 2 service has `high_velocity_start_date` set
- **AND** |slot_velocity| < 2
- **THEN** `high_velocity_start_date` SHALL be reset to NULL and `low_velocity_start_date` SHALL be set

---

### Requirement: Tier 1 to Booking promotion is manual

Promotion from Hot (Tier 1) to Booking tier SHALL require manual admin decision. The system SHALL NOT automatically promote services to Booking tier.

#### Scenario: Manual promotion via database flag
- **WHEN** an admin sets `is_bookable = true` on a location_service row
- **THEN** that service SHALL be included in the Booking tier scanner
- **AND** users SHALL be able to queue for that service

#### Scenario: Automated promotion blocked
- **WHEN** a Tier 1 service has sustained high velocity for any duration
- **THEN** the system SHALL NOT automatically set `is_bookable = true`

---

### Requirement: Manual monitoring control

Each location_service SHALL have a `monitoring_enabled` flag that allows admins to manually stop or start tracking a service.

#### Scenario: Admin disables monitoring
- **WHEN** an admin sets `monitoring_enabled = false` on a location_service
- **THEN** no tier scanner SHALL poll that service
- **AND** the service SHALL retain its current `monitoring_tier` value

#### Scenario: Admin re-enables monitoring
- **WHEN** an admin sets `monitoring_enabled = true` on a previously disabled service
- **THEN** the service SHALL resume being polled at its assigned tier rate
- **AND** promotion/demotion tracking dates SHALL be reset to NULL

#### Scenario: Flag checked for scanning
- **WHEN** a tier scanner queries for services to poll
- **THEN** it SHALL filter by `monitoring_enabled = true`

---

### Requirement: Initial tier assignment for new services

All services discovered by the discovery scanner SHALL start at Tier 4 (Frozen) EXCEPT the 4 currently tracked DL/ID Renewal services at satellite city halls which SHALL start with `is_bookable = true`.

#### Scenario: New service discovered
- **WHEN** the discovery scanner finds a location/service combination not in `location_services`
- **THEN** a new row SHALL be inserted with `monitoring_tier = 4`, `is_bookable = false`, and `monitoring_enabled = true`

#### Scenario: Existing booking services preserved
- **WHEN** the system is initialized
- **THEN** FSCH/HKAI/PEAR/WIND with "DRIVER LICENSE & STATE ID Renewals" SHALL have `is_bookable = true`

---

### Requirement: CLI-based tier runners

Each monitoring tier SHALL have its own npm script, triggered by external cron (cron-job.org).

| Script | Frequency | Tier |
|--------|-----------|------|
| `npm run monitor:booking` | Every 2 min | Booking |
| `npm run monitor:hot` | Every 5 min | Tier 1 |
| `npm run monitor:warm` | Every 30 min | Tier 2 |
| `npm run monitor:discovery` | Every 6 hr | Tier 3 (Cold) |
| `npm run monitor:frozen` | Daily | Tier 4 |

#### Scenario: Tier runner queries correct services
- **WHEN** `npm run monitor:warm` is executed
- **THEN** it SHALL query `location_services WHERE monitoring_tier = 2 AND is_bookable = false AND monitoring_enabled = true`

#### Scenario: Tier runner updates metrics after scan
- **WHEN** a tier runner completes scanning a service
- **THEN** it SHALL update `last_monitored_at`, `slots_30day`, `prev_slots_30day`, and `slot_velocity` on that location_service row

---

### Requirement: Unified folder structure

All monitoring code SHALL be consolidated into `apps/dmv-service-monitor/` with clear submodule organization.

```
apps/dmv-service-monitor/
  tiers/booking.ts, hot.ts, warm.ts, cold.ts, frozen.ts
  discovery/scanner.ts, tier-sync.ts
  shared/browser.ts, slot-parser.ts, promotion.ts
  reports/discord-status.ts
  run.ts
```

#### Scenario: Shared utilities across tiers
- **WHEN** any tier scanner needs to parse slot data from DMV website
- **THEN** it SHALL use `shared/slot-parser.ts` functions

#### Scenario: Entry point routes to correct tier
- **WHEN** `npm run monitor:hot` executes `run.ts --tier=hot`
- **THEN** `run.ts` SHALL invoke `tiers/hot.ts` scanner logic

#### Scenario: Scanner handles multiple sources
- **WHEN** a tier scanner polls services from different sources (main, road_test)
- **THEN** it SHALL use the appropriate scraper logic based on the `source` column
