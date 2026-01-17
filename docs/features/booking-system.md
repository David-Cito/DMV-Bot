# Booking System

## Summary
Book appointments based on user approval or auto-booking rules, using prefilled user data when allowed.

## Current
- No booking automation implemented.

## Planned

### Approval-Based Booking
- Send a notification with appointment details.
- User confirms within a time window.
- System books the appointment if still available.

### Auto-Booking
- User opts into automatic booking.
- Pre-filled user profile data is used to complete booking immediately.
- Optional constraints: only book within certain time ranges or days.

### Data Requirements
- User identity details
- Contact information
- DMV form fields required by the site

### Safety Controls
- Booking confirmation before final submission (optional)
- Audit trail of booking attempts

## Open Questions
- What fields are required by the DMV flow?
- How to securely store sensitive user info?
- When to fallback to manual approval?
