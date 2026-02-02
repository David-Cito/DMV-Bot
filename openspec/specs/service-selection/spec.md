# Service Selection

> **Last Updated:** February 2026
> **Status:** Planning

---

## Purpose

Handle service type selection during onboarding. Currently only driver's license/state ID renewal is supported. When users need other services, collect their interest as demand signals for future development.

### Goals

- Be transparent about what we support
- Collect demand data for unsupported services
- Optionally notify users when we add their requested service
- Inform roadmap decisions with real user data

---

## Supported vs Unsupported Services

### Currently Supported

| Service | Description |
|---------|-------------|
| **Driver's License Renewal** | Renew existing driver's license |
| **State ID Renewal** | Renew existing state ID |

### Not Yet Supported (Collect Votes)

| Service | Description |
|---------|-------------|
| Road Test | Behind-the-wheel driving test |
| Permit Test | Written test for learner's permit |
| New License | First-time license (not renewal) |
| Title Transfer | Vehicle title services |
| Registration | Vehicle registration services |
| Other | Catch-all for unlisted services |

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
                                         2. Road Test
                                         3. Permit Test
                                         4. New License
                                         5. Title/Registration
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


[If user selects 2-5 - UNSUPPORTED]

"2"
        ───────────────────────────────▶
                                        "We don't track Road Test appointments
                                         yet, but we're considering adding it!

                                         Your interest has been noted.

                                         Want us to text you when we add
                                         Road Test tracking?

                                         Reply YES or NO"
        ◀───────────────────────────────
"yes"
        ───────────────────────────────▶
                                        "Got it! We'll notify you when Road Test
                                         tracking becomes available.

                                         Need help with anything else?
                                         Reply MENU to see options."
        ◀───────────────────────────────


[If user selects 6 - OTHER]

"6"
        ───────────────────────────────▶
                                        "What DMV service do you need?

                                         Reply with a brief description."
        ◀───────────────────────────────
"motorcycle endorsement"
        ───────────────────────────────▶
                                        "Thanks! We've noted your interest in
                                         'motorcycle endorsement'.

                                         We'll use this feedback to decide
                                         what to add next.

                                         Want us to text you if we add this?

                                         Reply YES or NO"
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

### service_votes

Track interest in services we don't yet support.

```sql
CREATE TABLE service_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What service they wanted
    service_type TEXT NOT NULL,          -- 'road_test', 'permit_test', 'new_license', 'title_transfer', 'registration', 'other'
    service_description TEXT,            -- Free-text if they chose "other"

    -- Who voted (optional - can be anonymous)
    phone_number TEXT,                   -- For notification signup
    notify_when_available BOOLEAN DEFAULT FALSE,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    notified_at TIMESTAMPTZ             -- When we texted them about availability
);

-- Index for counting votes by service
CREATE INDEX idx_service_votes_type ON service_votes(service_type);

-- Index for notification queries
CREATE INDEX idx_service_votes_notify ON service_votes(service_type, notify_when_available)
    WHERE notify_when_available = TRUE AND notified_at IS NULL;
```

### Example Queries

```sql
-- Get vote counts by service type
SELECT
    service_type,
    COUNT(*) as vote_count,
    COUNT(*) FILTER (WHERE notify_when_available) as want_notification
FROM service_votes
GROUP BY service_type
ORDER BY vote_count DESC;

-- Get "other" descriptions for analysis
SELECT
    service_description,
    COUNT(*) as mentions
FROM service_votes
WHERE service_type = 'other'
GROUP BY service_description
ORDER BY mentions DESC;

-- Get users to notify when we launch a service
SELECT phone_number
FROM service_votes
WHERE service_type = 'road_test'
  AND notify_when_available = TRUE
  AND notified_at IS NULL;
```

---

## Service Type Mapping

| User Input | service_type Value |
|------------|-------------------|
| 1, "renewal", "license renewal" | *(supported - no vote)* |
| 2, "road test", "driving test" | `road_test` |
| 3, "permit", "permit test", "written test" | `permit_test` |
| 4, "new license", "first license" | `new_license` |
| 5, "title", "registration" | `title_registration` |
| 6, "other", anything else | `other` |

---

## Notification When Service Launches

When we add support for a new service:

```sql
-- 1. Find users who wanted notification
SELECT phone_number
FROM service_votes
WHERE service_type = 'road_test'
  AND notify_when_available = TRUE
  AND notified_at IS NULL;

-- 2. Send notification (via Twilio)
-- "Great news! We now track Road Test appointments.
--  Text us to get started!"

-- 3. Mark as notified
UPDATE service_votes
SET notified_at = NOW()
WHERE service_type = 'road_test'
  AND notify_when_available = TRUE
  AND notified_at IS NULL;
```

---

## Analytics & Reporting

### Demand Dashboard

Track these metrics to inform roadmap:

| Metric | Query |
|--------|-------|
| Total votes by service | `COUNT(*) GROUP BY service_type` |
| Notification signup rate | `AVG(notify_when_available::int)` |
| Votes this week | `WHERE created_at > NOW() - INTERVAL '7 days'` |
| Unique "other" descriptions | `COUNT(DISTINCT service_description)` |

### When to Add a Service

Consider adding a service when:
- Vote count exceeds threshold (e.g., 50+ votes)
- High notification signup rate (>70% want to be notified)
- Technical feasibility confirmed (DMV site supports it)

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

- **Multiple service selection** - User might need both renewal AND road test
- **Priority voting** - Let users indicate urgency of need
- **Location-specific demand** - Track which locations have demand for which services
- **Conversion tracking** - When we add a service, track if voters convert to paying users

---

## Related Specs

- [Notifications](../notifications/spec.md) - SMS conversation flow
- [User States](../user-states/spec.md) - State machine after service selection
- [Database](../database/spec.md) - Main schema reference
