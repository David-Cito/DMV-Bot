# Booking Flow - Delta Spec

> **Change:** dmv-service-monitor-system

---

## MODIFIED Requirements

### Requirement: Dual-User Booking Flow

The booking bot uses a dual-user strategy: select two eligible users before navigating to DMV. If the primary user's card fails, immediately swap to the backup user without restarting the bot.

```
    SLOT DETECTED
           |
           v
    +-------------------------------------+
    |  1. Acquire SLOT lock               |
    +------------------+------------------+
                       |
                       v
    +-------------------------------------+
    |  2. Select TOP 2 eligible users     |
    |     (atomically set state=BOOKING)  |
    |                                     |
    |     User A = first in priority      |
    |     User B = backup                 |
    +------------------+------------------+
                       |
                       v
    +-------------------------------------+
    |  3. Navigate to DMV, click slot     |
    |     (3-minute hold timer starts)    |
    +------------------+------------------+
                       |
                       v
    ...
```

#### Scenario: Slot detected for bookable service
- **WHEN** the booking tier scanner detects an available slot
- **THEN** it SHALL look up the slot's location_service_id to determine location_code and service_trans_val

#### Scenario: User selection uses location_service_id
- **WHEN** selecting the top 2 eligible users
- **THEN** the query SHALL filter by `location_service_id` matching the detected slot's service

---

## ADDED Requirements

### Requirement: Booking bot reads services from database

The booking bot SHALL dynamically read which services to scan from the `location_services` table instead of using hardcoded LOCATIONS array.

#### Scenario: Booking bot startup
- **WHEN** the booking bot starts
- **THEN** it SHALL query `location_services WHERE is_bookable = true AND monitoring_enabled = true`

#### Scenario: New bookable service included automatically
- **WHEN** an admin sets `is_bookable = true` on a location_services row
- **THEN** the next booking bot run SHALL include that service in its scan without code deployment

---

### Requirement: Booking uses location_service metadata

The booking bot SHALL use `location_code` and `service_trans_val` from the location_services row to navigate the DMV website.

#### Scenario: Navigate to correct location
- **WHEN** booking a slot for a location_service
- **THEN** the bot SHALL click `.location.button-look.next[data-loc-val="${location_code}"]`

#### Scenario: Select correct service
- **WHEN** on the service selection page
- **THEN** the bot SHALL click `.transaction.button-look[data-trans-val="${service_trans_val}"]`

---

### Requirement: Booking record includes location_service_id

Completed bookings SHALL reference the specific location_service_id, enabling accurate reporting across all service types.

#### Scenario: Booking created with location_service_id
- **WHEN** a booking is successfully completed
- **THEN** the bookings table row SHALL include `location_service_id` from the queue_entry

#### Scenario: Historical bookings maintain location_id (transitional)
- **WHEN** viewing historical bookings before migration
- **THEN** they SHALL still be queryable by `location_id` until data is backfilled
