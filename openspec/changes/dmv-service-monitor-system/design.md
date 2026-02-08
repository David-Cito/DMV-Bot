## Context

Currently, three separate bots handle DMV monitoring:
- `monitoring-bot`: Scans 4 satellite city hall locations for DL/ID Renewals every 2 minutes
- `forecasting-bot`: Scans the same 4 locations for days 31-60 (redundant)
- `discovery-bot`: Scans all ~88 location/service combinations every 6 hours

The discovery bot produces valuable scarcity data but it's not used to adapt monitoring behavior. The booking system only works with the 4 hardcoded locations, and adding new services requires code changes.

**Constraints:**
- Must stay within Supabase free tier (500 MB database, 5 GB bandwidth)
- Services have different scarcity patterns—one-size-fits-all polling is wasteful
- Current `queue_entries` table is empty, making schema changes safe

## Goals / Non-Goals

**Goals:**
- Track all ~88 location/service combinations at adaptive rates
- Enable new booking services via database flag only (no code changes)
- Unify monitoring code into single maintainable structure
- Provide daily visibility into tier status via Discord
- Automatically promote/demote services based on observed scarcity and velocity

**Non-Goals:**
- Changing the booking-bot's core booking flow (just its data source)
- Building a UI for tier management (database updates are sufficient)
- Real-time notifications for tier changes (daily report is enough)
- Predictive/ML-based tier assignment (rule-based promotion is sufficient)

## Decisions

### 1. Unified Folder Structure: `apps/dmv-service-monitor/`

**Decision:** Consolidate all monitoring into single folder with clear submodules.

**Alternatives considered:**
- Keep separate bots (rejected: code duplication, harder to share utilities)
- Single monolithic file (rejected: poor maintainability)

**Structure:**
```
apps/dmv-service-monitor/
  tiers/booking.ts, hot.ts, warm.ts, cold.ts, frozen.ts
  discovery/scanner.ts, tier-sync.ts
  shared/browser.ts, slot-parser.ts, promotion.ts
  reports/discord-status.ts
  run.ts
```

### 2. Single `location_services` Table (Not Separate Tables)

**Decision:** One table serves as both service registry AND tier tracking.

**Alternatives considered:**
- Separate `services` + `location_services` + `service_tiers` tables (rejected: more joins, more confusion)
- Keep tier data in discovery-bot config files (rejected: can't query easily, no persistence)

**Key columns:**
- `is_bookable`: TRUE = users can queue for this service (Booking tier)
- `monitoring_tier`: 1-4 for non-bookable services
- Promotion tracking: `low_supply_start_date`, `high_velocity_start_date`, etc.

### 3. Day-Based Promotion Windows (Not Scan Counts)

**Decision:** Require 3 consecutive DAYS of consistent signal before promotion.

**Alternatives considered:**
- Scan-count based (rejected: 2 scans = 12 hours is too short, prone to noise)
- Weekly reviews (rejected: too slow to react to real demand)

**Promotion thresholds:**
- Tier 4→3: Supply < 100 OR downward trend (20+ fewer slots vs 30 days ago)
- Tier 3→2: Supply < 30 for 3 consecutive days
- Tier 2→1: Velocity |Δ| ≥ 2 for 3 consecutive days
- Tier 1→Booking: Manual decision

**Demotion windows are longer (5-7 days) to prevent flapping.**

### 4. Extend Queue System Now (Not Later)

**Decision:** Add `location_service_id` to `queue_entries` and `bookings` now.

**Alternatives considered:**
- Keep location-only and add service support later (rejected: would require another migration)
- Create new tables for multi-service queuing (rejected: unnecessary complexity)

**Rationale:** `queue_entries` is empty, so this is the perfect time. Enables "flip is_bookable" workflow from day one.

### 5. CLI-Based Tier Runners (Not Single Long-Running Process)

**Decision:** Each tier has its own npm script, triggered by cron-job.org.

**Alternatives considered:**
- Single process with internal schedulers (rejected: more complex, harder to debug, memory issues)
- GitHub Actions for all (rejected: 2-min intervals would exceed limits)

**Scripts:**
- `npm run monitor:booking` - every 2 min
- `npm run monitor:hot` - every 5 min
- `npm run monitor:warm` - every 30 min
- `npm run monitor:discovery` - every 6 hours
- `npm run monitor:frozen` - daily
- `npm run monitor:report` - daily (Discord)

## Risks / Trade-offs

**Risk:** Promotion thresholds too aggressive → services bounce between tiers
→ **Mitigation:** Longer demotion windows (5-7 days), daily Discord report for visibility

**Risk:** Missing the existing monitoring-bot's reliability during migration
→ **Mitigation:** Keep old bot folders as `.bak` for first week, verify booking tier produces identical results

**Risk:** `location_services` table becomes stale if discovery bot fails
→ **Mitigation:** `is_active` flag, `last_discovery_at` timestamp, alerts if stale

**Risk:** Supabase free tier exceeded with high polling
→ **Mitigation:** Storage projections show ~2-3 MB/month with differential storage; monitor dashboard

**Trade-off:** Breaking change to queue_entries/bookings schema
→ **Accepted:** Table is empty, migration is safe, enables dynamic service enablement

## Migration Plan

**Phase 1: Database**
1. Create `location_services` table
2. Create `slot_snapshots` table
3. Add `location_service_id` to `queue_entries` and `bookings`
4. Run discovery to seed `location_services` with all ~88 combos
5. Mark 4 current services as `is_bookable = true`

**Phase 2: Unified Monitor**
1. Create `apps/dmv-service-monitor/` structure
2. Extract shared utilities from monitoring-bot
3. Verify `npm run monitor:booking` matches old monitoring-bot output
4. Rename old bot folders to `.bak`

**Phase 3: Tier System**
1. Deploy tier monitors (hot, warm, frozen)
2. Run for 24-48 hours, verify promotions work
3. Enable daily Discord status report

**Phase 4: Cleanup**
1. Delete `.bak` folders
2. Update all GitHub workflows
3. Archive this change

**Rollback:**
- Restore `.bak` folders
- Revert package.json scripts
- Old cron jobs can be re-enabled immediately

## Resolved Questions

1. **Initial tier assignment:** All services start at Tier 4 (Frozen) EXCEPT the 4 currently tracked services (DL/ID Renewals at satellite city halls) which start as Booking tier with `is_bookable = true`.

2. **Discord report timing:** 8am HST confirmed.

3. **Slot velocity threshold:** |Δ| ≥ 2 slots per poll. By Tier 2, services already have < 30 slots (from Tier 3 promotion), so 2+ slots changing in 30 minutes (~10% turnover) indicates real demand. Can adjust to 3 if too noisy.
