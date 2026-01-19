# Notification System

## Summary
Notify users quickly when an appointment matches their constraints. Offer deposit discounts for free notification channels.

## Current
- Discord webhook alerts (primary) using `DISCORD_WEBHOOK_URL`.
- Optional user mention via `DISCORD_MENTION_USER_ID`.
- Email alerts via GitHub Actions SMTP (secondary, used if Discord fails).

## Planned (Free Notification Channels + Discounts)

### Channels to Support (Examples)
- Email (secondary fallback)
- Discord webhook (primary)
- Telegram bot
- Push via Pushover/ntfy
- SMS (paid, optional)

### Discount Logic
Users who enable **free** notification channels receive a deposit discount.

### Features
- User preferences for channel priority
- Throttling / rate limits
- Fallback order if primary fails

## Open Questions
- Which free channels to prioritize?
- Opt-in consent and verification flow?
- Notification retries and cooldowns?
