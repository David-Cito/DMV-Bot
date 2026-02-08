# Queue Mechanics - Delta Spec

> **Change:** dmv-service-monitor-system

---

## MODIFIED Requirements

### Requirement: Atomic User Selection

The system SHALL select eligible users atomically to prevent race conditions between multiple bot instances.

```sql
-- Bot selecting and locking users atomically

WITH eligible_users AS (
  SELECT id, tier, created_at
  FROM queue_entries
  WHERE location_service_id = $location_service_id
    AND state = 'ACTIVE'
    AND (time_preference IS NULL OR time_preference = $slot_time_block)
  ORDER BY
    CASE WHEN tier = 'priority' THEN 0 ELSE 1 END,
    created_at ASC
  LIMIT 2
  FOR UPDATE SKIP LOCKED  -- Prevents race conditions
)
UPDATE queue_entries
SET state = 'BOOKING',
    booking_bot_id = $bot_run_id,
    booking_started_at = NOW(),
    booking_slot_id = $slot_id
WHERE id IN (SELECT id FROM eligible_users)
RETURNING *;

-- Returns the users that were successfully locked
-- If another bot grabbed them first, returns fewer/no rows
```

#### Scenario: User selection by location_service_id
- **WHEN** the booking bot selects eligible users for a detected slot
- **THEN** it SHALL filter by `location_service_id` (not `location_id`) to match users queued for that specific service

#### Scenario: Backward compatible fallback (transitional)
- **WHEN** a queue_entry has `location_id` set but `location_service_id` is NULL (legacy entry)
- **THEN** the booking bot SHALL match based on `location_id` until all entries are migrated

---

## ADDED Requirements

### Requirement: Queue entries reference specific location/service combination

Queue entries SHALL reference a specific `location_service_id` instead of just `location_id`, enabling users to queue for any bookable service.

#### Scenario: User queues for specific service
- **WHEN** a user signs up for "Out of State Transfer at Kapalama"
- **THEN** a queue_entry SHALL be created with `location_service_id` pointing to that specific location_services row

#### Scenario: User queues for DL/ID Renewal (current behavior)
- **WHEN** a user signs up for "Hawaii Kai DL/ID Renewals"
- **THEN** a queue_entry SHALL be created with `location_service_id` pointing to the HKAI DL/ID Renewals location_services row

---

### Requirement: Per-location-service queue sizing

Queue size limits SHALL be configurable per location_service combination, not just per location.

#### Scenario: Different services at same location have different limits
- **WHEN** "DL/ID Renewals at Downtown" is highly competitive
- **AND** "Motor Vehicles at Downtown" has abundant availability
- **THEN** each service MAY have a different `queue_size_limit` in its location_services row

#### Scenario: Default to location queue size
- **WHEN** a location_services row does not have a custom `queue_size_limit`
- **THEN** it SHALL inherit the queue_size_limit from the locations table for backward compatibility
