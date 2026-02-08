# Tier Status Reporting Spec

> **Last Updated:** February 2026

---

## ADDED Requirements

### Requirement: Daily Discord status report

The system SHALL send a daily Discord report showing all services by tier with recent changes at 8am HST.

#### Scenario: Report sent at configured time
- **WHEN** the clock reaches 8:00am HST
- **THEN** the status report SHALL be generated and sent to the configured Discord channel

#### Scenario: Report timing configurable
- **WHEN** an admin needs to change report timing
- **THEN** the timing SHALL be adjustable via cron-job.org schedule for `npm run monitor:report`

---

### Requirement: Tier sections with service counts

The status report SHALL display each tier as a distinct section with a count of services.

```
BOOKING TIER (Live - 4 services)
TIER 1 - HOT (2 services)
TIER 2 - WARM (8 services)
TIER 3 - COLD (30 services)
TIER 4 - FROZEN (44 services)
```

#### Scenario: Booking tier listed first
- **WHEN** generating the report
- **THEN** Booking tier services SHALL appear at the top of the report

#### Scenario: Tier count accurate
- **WHEN** the report displays "TIER 2 - WARM (8 services)"
- **THEN** exactly 8 location_service rows SHALL have `monitoring_tier = 2` and `is_bookable = false`

---

### Requirement: Tabular service display per tier

Each tier section SHALL display services in a table format with relevant metrics.

**Booking/Hot tiers (velocity-focused):**
| Location | Service | 30d Slots | Velocity |
|----------|---------|-----------|----------|

**Warm/Cold tiers (supply-focused):**
| Location | Service | 30d Slots | 60d Slots |
|----------|---------|-----------|-----------|

**Frozen tier (trend-focused):**
| Location | Service | 30d Slots | Trend |
|----------|---------|-----------|-------|

#### Scenario: Table columns match tier purpose
- **WHEN** displaying Tier 1 (Hot) services
- **THEN** the Velocity column SHALL be included to show recent slot changes

#### Scenario: Code block formatting for Discord
- **WHEN** the report is sent to Discord
- **THEN** tables SHALL be wrapped in code blocks (```) for monospace alignment

---

### Requirement: Recent tier changes section

The report SHALL include a section showing tier changes from the last 7 days.

#### Scenario: Promotion displayed with up arrow
- **WHEN** a service was promoted in the last 7 days
- **THEN** it SHALL appear as "KAPA - Out Of State: Tier 2 to 1" with promotion indicator

#### Scenario: Demotion displayed with down arrow
- **WHEN** a service was demoted in the last 7 days
- **THEN** it SHALL appear as "WADL - State ID Dup: Tier 2 to 3" with demotion indicator

#### Scenario: Changes ordered by date
- **WHEN** multiple tier changes occurred
- **THEN** they SHALL be listed in reverse chronological order (most recent first)

---

### Requirement: Changes since last report section

The report SHALL highlight what changed since the previous report (last 24 hours).

#### Scenario: New promotions highlighted
- **WHEN** a service was promoted since the last report
- **THEN** it SHALL appear in the "CHANGES SINCE LAST REPORT" section

#### Scenario: No changes message
- **WHEN** no tier changes occurred in the last 24 hours
- **THEN** the section SHALL display "No tier changes in the last 24 hours"

---

### Requirement: Query recent tier changes

The system SHALL query location_services for recent promotions and demotions using timestamps.

```sql
SELECT * FROM location_services
WHERE promoted_at >= NOW() - INTERVAL '7 days'
   OR demoted_at >= NOW() - INTERVAL '7 days'
ORDER BY COALESCE(promoted_at, demoted_at) DESC;
```

#### Scenario: Both promotion and demotion timestamps checked
- **WHEN** querying for recent changes
- **THEN** the query SHALL check both `promoted_at` and `demoted_at` timestamps

---

### Requirement: Discord code block support

The Discord notifier SHALL support code block formatting for tabular data.

#### Scenario: Tables render with monospace font
- **WHEN** the report contains a table
- **THEN** it SHALL be wrapped in triple backticks for monospace rendering in Discord

#### Scenario: Long tables split across messages
- **WHEN** a tier has more than 30 services
- **THEN** the table MAY be truncated or split to fit Discord message limits (2000 chars)

---

### Requirement: Report npm script

The status report SHALL be triggered via `npm run monitor:report`.

#### Scenario: Report script executes standalone
- **WHEN** `npm run monitor:report` is executed
- **THEN** it SHALL generate and send the report without running any scanning

#### Scenario: Report script fails gracefully
- **WHEN** Discord webhook is unavailable
- **THEN** the script SHALL log an error and exit with non-zero status
- **AND** the error SHALL NOT affect other scheduled jobs

---

### Requirement: Visual tier indicators

Each tier section SHALL have a visual indicator emoji for quick recognition.

| Tier | Indicator |
|------|-----------|
| Booking | Green circle (live/revenue) |
| Tier 1 (Hot) | Red circle (high activity) |
| Tier 2 (Warm) | Yellow circle (moderate activity) |
| Tier 3 (Cold) | Blue circle (baseline) |
| Tier 4 (Frozen) | White circle (dormant) |

#### Scenario: Emoji renders in Discord
- **WHEN** the report is sent to Discord
- **THEN** tier indicators SHALL render as the appropriate emoji
