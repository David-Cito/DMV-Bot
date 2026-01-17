# Backend + Database

## Summary
A backend service and database will manage users, constraints, pricing, queues, notifications, and booking workflows.

## Current
- No backend/database implemented.
- Data stored locally in JSON under `data/history/` and `data/results/`.

## Planned

### Backend Responsibilities
- User management and authentication
- Constraint configuration (location, date window, service type)
- Queue assignment and prioritization
- Notification routing and retries
- Booking workflows (approval + auto-book)
- Pricing and deposit tracking

### Database Needs
- Users and preferences
- Queue assignments
- Notification logs
- Booking attempts and outcomes
- Pricing/deposit records
- Audit trail

### Storage Options (Candidates)
- **PostgreSQL** (via Supabase/Neon)
- **MongoDB Atlas**
- **SQLite** (local or for small-scale)

## Open Questions
- Hosted vs self-managed?
- Data retention and privacy requirements?
- How to secure PII at rest?
