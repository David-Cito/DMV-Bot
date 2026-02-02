# Multi-Service Support

**Status:** Upcoming - Data collection phase planned
**Created:** 2026-02-01

## Overview

Scale the monitoring and booking system to support all DMV services, not just "DRIVER LICENSE & STATE ID Renewals".

## Current State

- Hardcoded to "DRIVER LICENSE & STATE ID Renewals" service
- Single service type tracked across all locations
- No service dimension in database schema

## Goals

1. **Phase 1:** Collect availability data for all services to evaluate demand
2. **Phase 2:** Enable monitoring for high-value services
3. **Phase 3:** Enable booking for services with sufficient cancellation supply

## Known DMV Services

Services available on the Honolulu DMV site (to be confirmed by discovery):

| Service | Code | Priority |
|---------|------|----------|
| DRIVER LICENSE & STATE ID Renewals | `dl_renewal` | Current |
| New Driver License | `dl_new` | TBD |
| Learner's Permit | `learner_permit` | TBD |
| State ID | `state_id` | TBD |
| Vehicle Registration | `vehicle_reg` | TBD |
| Title Transfer | `title_transfer` | TBD |
| Commercial Driver License | `cdl` | TBD |

## Technical Approach

### Phase 1: Discovery Bot

Create a simple bot that:
1. Navigates to each location
2. Logs all available service options
3. Outputs service list with exact text for selector matching

```typescript
// Example output
{
  "location": "Downtown Satellite City Hall",
  "services": [
    { "text": "DRIVER LICENSE & STATE ID Renewals", "available": true },
    { "text": "New Driver License", "available": true },
    ...
  ]
}
```

### Phase 2: Parameterized Monitoring Bot

Add service configuration:

```typescript
// Config
interface ServiceConfig {
  code: string;
  name: string;        // Exact text for selector
  enabled: boolean;
}

const SERVICES: ServiceConfig[] = [
  { code: 'dl_renewal', name: 'DRIVER LICENSE & STATE ID Renewals', enabled: true },
  { code: 'dl_new', name: 'New Driver License', enabled: false },
  // ...
];

// Environment variable to select service
const SERVICE_CODE = process.env.DMV_SERVICE || 'dl_renewal';
```

### Phase 3: Workflow Structure

**Option A: Separate workflow per service (Recommended)**

```
.github/workflows/
├── dmv-monitor-dl-renewal.yml      # Current service
├── dmv-monitor-dl-new.yml          # New service
├── dmv-monitor-vehicle-reg.yml     # Future
└── ...
```

Pros:
- Easy to enable/disable per service
- Independent schedules (high-demand services run more often)
- Failures isolated to one service

Cons:
- More workflow files to maintain
- Each workflow has full startup overhead

**Option B: Matrix strategy**

```yaml
jobs:
  monitor:
    strategy:
      matrix:
        service: [dl_renewal, dl_new, vehicle_reg]
    env:
      DMV_SERVICE: ${{ matrix.service }}
```

Pros:
- Single workflow file
- Easy to add/remove services

Cons:
- All services on same schedule
- One failure could affect reporting

### Phase 4: Database Schema

Add service dimension to existing tables:

```sql
-- Add to slot_states
ALTER TABLE slot_states ADD COLUMN service_type TEXT DEFAULT 'dl_renewal';

-- Add to runs
ALTER TABLE runs ADD COLUMN service_type TEXT DEFAULT 'dl_renewal';

-- Index for queries
CREATE INDEX idx_slot_states_service ON slot_states(service_type);
```

### Phase 5: Booking Bot Updates

- Add service parameter to booking flow
- Navigate to correct service before slot selection
- Queue entries include preferred service type
- Users can queue for multiple services (separate entries)

## Data Collection Metrics

For each service, track over 2-4 weeks:

| Metric | Purpose |
|--------|---------|
| Total slots/day | Baseline availability |
| Slot churn rate | How often slots appear/disappear |
| Soonest slot trend | How far out is first available |
| Peak availability times | When do new slots appear |

## Success Criteria for New Service

Before enabling monitoring/booking for a service:

1. **Sufficient volume:** >10 slots/day across all locations
2. **Churn exists:** Slots appear/disappear (not static calendar)
3. **Lead time reasonable:** Soonest slot <60 days out
4. **User demand:** Requests from users for that service

## Implementation Order

1. [ ] Create discovery bot to catalog all services
2. [ ] Add `service_type` parameter to monitoring bot
3. [ ] Update database schema
4. [ ] Run data collection for top 2-3 services (2 weeks)
5. [ ] Analyze data, decide which services to support
6. [ ] Update booking bot for multi-service
7. [ ] Update user queue to support service selection

## Open Questions

- Do all locations offer the same services?
- Are service availability patterns similar to DL renewals?
- Should users be able to queue for "any service" or must specify?
- Pricing: same fee across services or variable?

## Decision

Deferred until core DL renewal system is stable. Begin with discovery bot to understand service landscape.
