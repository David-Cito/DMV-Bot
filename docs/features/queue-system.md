# Queue System

## Summary
Group users into queues based on shared constraints so the bot can optimize checks and minimize duplicate effort.

## Current
- No queue system implemented.

## Planned (Group Queuing by Constraints)

### Constraints Used for Grouping
- **Location(s)** (one or many)
- **Target window** (date range)
- **Urgency tier** (e.g., ≤7 days, ≤14 days)
- **Service type** (e.g., Driver License renewals)

### Behavior
- Users with matching constraints share a queue.
- A single check feeds multiple users.
- If an appointment meets the constraints, notify all eligible users in that queue.

### Benefits
- Reduces redundant checks.
- Improves coverage for strict windows.
- Enables priority ordering by deposit tier.

## Open Questions
- Priority rules: FIFO vs highest deposit first?
- Queue expiration rules?
- Max queue size per constraint set?
