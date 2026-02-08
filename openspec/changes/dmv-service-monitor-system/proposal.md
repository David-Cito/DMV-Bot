## Why

We currently track only 4 location/service combinations (DL/ID Renewals at 4 satellite city halls) with a single polling rate. The discovery bot scans ~88 location/service combos every 6 hours but this data isn't used for adaptive monitoring. We want to track ALL services at rates that match their scarcity, and enable any service to become bookable by simply flipping a database flag—no code changes required.

## What Changes

- **Unified monitoring system**: Replace `monitoring-bot`, `forecasting-bot`, and `discovery-bot` with single `apps/dmv-service-monitor/` structure
- **5-tier adaptive monitoring**: Frozen (daily) → Cold (6hr) → Warm (30min) → Hot (5min) → Booking (2min) with automatic promotion/demotion based on scarcity and velocity
- **Central service registry**: New `location_services` table as single source of truth for all ~88 location/service combinations
- **Dynamic booking enablement**: Flip `is_bookable = true` on any service to enable user queuing—no code changes
- **BREAKING**: `queue_entries` and `bookings` tables change from `location_id` to `location_service_id`
- **Delete**: `forecasting-bot` (redundant—discovery already covers 60-day window)
- **Daily status reporting**: Discord notification with visual tier status table

## Capabilities

### New Capabilities
- `tiered-monitoring`: 5-tier adaptive monitoring system with day-based promotion/demotion rules
- `location-services`: Central registry of all location/service combinations with tier tracking
- `tier-status-reporting`: Daily Discord reports showing all services by tier with recent changes

### Modified Capabilities
- `dmv-locations-and-services`: Unified scanner architecture, location_services table replaces hardcoded configs
- `queue-mechanics`: Queue entries reference specific location/service combo instead of just location
- `booking-flow`: Booking bot dynamically reads bookable services from database
- `database`: New tables (location_services, slot_snapshots), modified schemas (queue_entries, bookings)

## Impact

**Code deleted:**
- `apps/monitoring-bot/` - absorbed into dmv-service-monitor
- `apps/forecasting-bot/` - redundant
- `apps/discovery-bot/` - absorbed into dmv-service-monitor

**Code created:**
- `apps/dmv-service-monitor/` - unified monitoring with tiers/, discovery/, shared/, reports/

**Code modified:**
- `apps/booking-bot/` - read from location_services instead of hardcoded locations
- `packages/queue/queue_service.ts` - use location_service_id
- `packages/queue/location_service.ts` - new methods for location_services table
- `scripts/notifications/discord-notifier.js` - code block support for tables
- `.github/workflows/` - update to use new npm scripts

**Database:**
- New: `location_services` table
- New: `slot_snapshots` table
- Modified: `queue_entries` - add `location_service_id`, make `location_id` nullable
- Modified: `bookings` - add `location_service_id`, make `location_id` nullable
