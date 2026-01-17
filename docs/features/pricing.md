# Pricing

## Summary
Pricing is tied to **how narrow and urgent** a user’s target window is. Tighter windows and higher urgency require more frequent checks and faster response, so they carry higher deposits.

## Current
- No pricing system implemented.

## Planned (Dynamic Deposit Pricing)

### Inputs
- **Target window**: days range around a target date (e.g., ±7 days).
- **Urgency**: how soon the appointment must be (e.g., within 3 days).
- **Location constraints**: number of acceptable locations.

### Pricing Logic (Concept)
- **Narrower window = higher deposit**
  - Example: ±3 days > ±14 days.
- **Shorter lead time = higher deposit**
  - Example: “within 7 days” > “within 60 days.”
- **Fewer locations = higher deposit**
  - Example: 1 location > 4 locations.

### Example Tiers (Placeholder)
- **Low urgency** (±30–60 days): $X deposit
- **Medium urgency** (±7–14 days): $Y deposit
- **High urgency** (same-day to ±3 days): $Z deposit

### Discount Logic (Planned)
Discounts for users who enable **free notification channels** (see `notification-system.md`).

## Open Questions
- Minimum deposit to deter no-shows?
- Refund policy on failed booking attempts?
- Deposit waiver for off-peak windows?
