# Eventbrite parity — Ticketly capability map

Capability comparison (not visual design). Ticketly keeps **Obsidian Signal / Stitch** as visual source of truth.

Statuses for this phase: see also [LAUNCH_STATUS.md](./LAUNCH_STATUS.md).

---

## MATCHED

| Area | Ticketly |
|------|----------|
| Paid checkout + webhooks | Stripe Checkout Form current production; Nexi future/optional via `PAYMENT_PROVIDER` |
| Provider stored per payment | `Payment.provider` immutable for refunds / lookup |
| Promo codes | Percentage + fixed; event / ticket-type scope; max uses; date window; admin CRUD |
| Waitlist | Join, invite N, claim token, expiry; no false queue-position promise |
| Attendee / order exports | CSV + XLSX: orders, tickets, attendees, guestlist, check-ins, refunds, promo usage |
| Support order lookup | Search by order #, ticket ID, email, phone, name, event, provider ref |
| Duplicate event | Copies config/ticket types; never orders/payments/check-ins |
| Min/max per order | Backend-enforced on reservation |
| Sold-out UX | UTSOLGT / FLERE BILLETTER KOMMER + waitlist CTA when enabled |
| QR + scanner | Individual tickets; refunded QR rejected |
| Organizer admin | Events, inventory, orders, analytics, settings |

---

## TICKETLY BETTER

| Area | Why |
|------|-----|
| Nightlife ops | Release batches, pause sales, door scanner, guestlist, offline scanner path |
| Payment dual-stack | Explicit Nexi ↔ Stripe switch without silent failover; historical orders stay on original provider |
| Inventory formula | Released − sold − reserved with `INVENTORY_BELOW_COMMITTED` |
| Audit trail | Promo / waitlist / export / reminder / duplicate actions audited |
| Norwegian checkout | NOK, Vipps-via-Nexi path, local copy |

---

## PARTIAL

| Area | Gap |
|------|-----|
| Group / bundle tickets | `admissionCount` / `isBundle` issues N QR tickets per unit; table packages / shared credential later |
| Automated reminders | 24h / 3h schedule + cron; venue-changed / transfer templates light |
| Event series | `EventSeries` model + event `seriesId`; recurrence UI / generation not built |
| Email delivery tracking | `NotificationLog` QUEUED/SENT/FAILED; DELIVERED depends on ESP webhooks |
| Analytics | Promo / waitlist / bundle / sell-through foundations; no fake cohorts |
| Mobile organizer | Promo + waitlist summaries available; not full desktop parity |
| Resend confirmation | Support view shows history; rate-limited resend action can be tightened further |

---

## NOT BUILT

| Area |
|------|
| Social advertising tools |
| Marketplace / discovery algorithms |
| Complex waitlist lottery |
| Automatic Nexi → Stripe payment retry / silent failover |
| Event templates library (“Standard Friday Club”) as first-class product |
| Full Eventbrite-style collection / affiliate programs |

---

## NOT PLANNED YET

| Area | Note |
|------|------|
| Public marketplace ranking | Keep owned traffic + direct links first |
| Ads manager / boost | Out of scope this phase |
| Multi-currency marketplace | NOK-first |
| Seat maps / assigned seating | Optional later for venues that need it |
| Subscription memberships | Separate product track |

---

## Provider rule (non-negotiable)

Provider selection applies **only to new checkout sessions**.

Every historical payment stays tied to its original provider forever for refunds, lookup, and reconciliation.
