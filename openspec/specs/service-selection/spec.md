# Service Selection

> **Last Updated:** February 2026
> **Status:** Planning

---

## Purpose

Handle service type selection during onboarding. Currently only driver's license/state ID renewal is supported at Satellite City Hall locations. When users need other services, collect their interest as demand signals for future development.

### Goals

- Be transparent about what we support
- Collect demand data for unsupported services
- Optionally notify users when we add their requested service
- Inform roadmap decisions with real user data

---

## Location Types

Hawaii has two types of DMV locations with different services:

### Satellite City Halls (Currently Tracked)

Limited services, but convenient locations:

| Location | Services Available |
|----------|-------------------|
| Downtown | Renewals, Duplicates, Motor Vehicles, Holo Card, Disability Permits |
| Hawaii Kai | Renewals, Duplicates, Motor Vehicles, Holo Card, Disability Permits |
| Pearlridge | Renewals, Duplicates, Motor Vehicles, Holo Card, Disability Permits |
| Windward City | Renewals, Duplicates, Motor Vehicles, Holo Card, Disability Permits |

### Driver License Offices (Not Yet Tracked)

Full services including tests and new issuance:

| Location | Notable Services |
|----------|-----------------|
| Kapālama | All DL/ID services, permits, transfers |
| Kapolei | All DL/ID services, permits, transfers |
| Koʻolau | All DL/ID services, permits, transfers |
| Wahiawā | All DL/ID services, permits, transfers |
| Waiʻanae | All DL/ID services, permits, transfers |

---

## Supported vs Unsupported Services

### Currently Supported (Satellite City Halls)

| Service | DMV Category |
|---------|--------------|
| **Driver License Renewal** | "Driver License & State ID Renewals" |
| **State ID Renewal** | "Driver License & State ID Renewals" |

### Could Support (Same Locations)

| Service | DMV Category | Notes |
|---------|--------------|-------|
| License/ID Duplicate | "Driver License or State ID Duplicates & Instruction Permit Renewals" | Same appointment type |
| Instruction Permit Renewal | "Driver License or State ID Duplicates & Instruction Permit Renewals" | Same appointment type |
| Motor Vehicle Services | "Motor Vehicles & Other Services" | Registration, title, etc. |
| Holo Card | "Motor Vehicles & Other Services / Holo Card & Disability Parking Permits" | Transit card |
| Disability Parking Permit | "Motor Vehicles & Other Services / Holo Card & Disability Parking Permits" | Placard services |

### Requires New Locations (Driver License Offices)

| Service | DMV Category | Notes |
|---------|--------------|-------|
| Instruction Permit Initial | "Instruction Permit Initial (In-person Written Test)" | Written test required |
| Instruction Permit (Online Follow-up) | "Instruction Permit (Online Test Follow-up)" | After passing online test |
| Out Of State Transfer | "Out Of State Transfer" | Moving to Hawaii |
| State ID Initial | "State ID Initial" | First-time ID |
| Provisional to Full License | "Hawaii Provisional to a Full License" | Not a road test |

### Not Available Online

| Service | Notes |
|---------|-------|
| Road Test | Scheduled separately, not through appointment system |
| U.S. Passport | Only at select locations (Ala Moana, Kapolei, Wahiawā) |

---

## Conversation Flow

```
USER                                    SYSTEM
────                                    ──────

"Hi"
        ───────────────────────────────▶
                                        "Welcome to DMV Bot!

                                         What do you need help with?

                                         1. License/ID Renewal
                                         2. License/ID Duplicate
                                         3. Instruction Permit
                                         4. Out of State Transfer
                                         5. Motor Vehicle Services
                                         6. Something else"
        ◀───────────────────────────────

[If user selects 1 - SUPPORTED]

"1"
        ───────────────────────────────▶
                                        "Great! We can help with renewals.

                                         Which location do you need?
                                         1. Downtown
                                         2. Hawaii Kai
                                         3. Pearlridge
                                         4. Windward City"
        ◀───────────────────────────────

        [Continues to normal signup flow...]


[If user selects 2 - COULD SUPPORT (same locations)]

"2"
        ───────────────────────────────▶
                                        "We don't track License/ID Duplicates
                                         yet, but it's on our radar!

                                         Your interest has been noted.

                                         Want us to text you when we add it?

                                         Reply YES or NO"
        ◀───────────────────────────────
"yes"
        ───────────────────────────────▶
                                        "Got it! We'll notify you when
                                         Duplicate tracking is available.

                                         Need help with anything else?
                                         Reply MENU to see options."
        ◀───────────────────────────────


[If user selects 3 or 4 - REQUIRES NEW LOCATIONS]

"3"
        ───────────────────────────────▶
                                        "Instruction Permits require an
                                         appointment at a Driver License office
                                         (Kapālama, Kapolei, etc.) - not at
                                         the Satellite City Halls we track.

                                         We're considering adding those
                                         locations. Your interest has been noted.

                                         Want us to text you when we add
                                         Driver License office tracking?

                                         Reply YES or NO"
        ◀───────────────────────────────


[If user selects 6 - OTHER]

"6"
        ───────────────────────────────▶
                                        "What DMV service do you need?

                                         Reply with a brief description."
        ◀───────────────────────────────
"road test"
        ───────────────────────────────▶
                                        "Road tests are scheduled separately
                                         from the online appointment system.

                                         Is there another service we can
                                         help you with?

                                         Reply MENU to see options."
        ◀───────────────────────────────
```

---

## Conversation State Machine

```
IDLE
  │
  │ user texts anything
  ▼
SELECTING_SERVICE  ◄──── NEW STATE
  │
  ├─── selects supported service (1)
  │         │
  │         ▼
  │    SELECTING_LOCATION (existing flow)
  │
  ├─── selects known unsupported (2-5)
  │         │
  │         ▼
  │    VOTE_RECORDED
  │         │
  │         ▼
  │    ASKING_NOTIFY_PREFERENCE
  │         │
  │         ▼
  │    IDLE (vote saved, optional notify signup)
  │
  └─── selects "other" (6)
            │
            ▼
       DESCRIBING_SERVICE
            │
            ▼
       VOTE_RECORDED
            │
            ▼
       ASKING_NOTIFY_PREFERENCE
            │
            ▼
       IDLE (vote saved, optional notify signup)
```

---

## Database Schema

See [Database Spec](../database/spec.md) for full schema. The `service_votes` table is defined there.

### Quick Reference

```sql
-- Record a vote (phone always captured for future launch notifications)
INSERT INTO service_votes (phone, service_type, description, notify_when_available)
VALUES ('+18081234567', 'instruction_permit', NULL, TRUE);

-- Get vote counts
SELECT service_type, COUNT(*) as votes
FROM service_votes
GROUP BY service_type
ORDER BY votes DESC;

-- Get ALL users who voted for a service (for launch announcement)
SELECT phone
FROM service_votes
WHERE service_type = 'license_id_duplicate'
  AND notified_at IS NULL;

-- Get only users who explicitly opted in to notifications
SELECT phone
FROM service_votes
WHERE service_type = 'license_id_duplicate'
  AND notify_when_available = TRUE
  AND notified_at IS NULL;
```

---

## Service Type Mapping

| User Input | service_type Value |
|------------|-------------------|
| 1, "renewal" | *(supported - no vote)* |
| 2, "duplicate" | `license_id_duplicate` |
| 3, "permit" | `instruction_permit` |
| 4, "transfer", "out of state" | `out_of_state_transfer` |
| 5, "motor vehicle", "registration", "title" | `motor_vehicle_services` |
| 6, "other" + free text | `other` |

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| User votes multiple times | Allow it - each vote counts (shows strong interest) |
| User changes mind on notification | No update mechanism (keep simple) |
| User later signs up for renewal | Normal flow - vote history preserved |
| Invalid "other" description | Accept anything, clean up in analysis |

---

## Future Considerations

- **Easy expansion** - Add Duplicates/Permit Renewals (same Satellite City Hall locations)
- **Hard expansion** - Add Driver License offices (Kapālama, Kapolei, Koʻolau, Wahiawā, Waiʻanae)
- **Passport tracking** - Only at Ala Moana, Kapolei, Wahiawā Satellite City Halls

---

## Related Specs

- [Notifications](../notifications/spec.md) - SMS conversation flow
- [User States](../user-states/spec.md) - State machine after service selection
- [Database](../database/spec.md) - Main schema reference
