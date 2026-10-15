# Launch Gap Analysis

**Date:** 2026-10-15  
**Branch:** `cursor/launch-readiness-9546` (includes security hardening merge)  
**Goal:** Create real event + open ticket sales tomorrow

## Critical path status

| Requirement | Status | Notes |
|-------------|--------|-------|
| Admin login / RBAC | DONE | Auth.js + org roles |
| Secure checkout / webhook / QR / scan | DONE | Hardening branch |
| Create event (UI) | DONE | `/admin/events/new` wizard |
| Configure ticket types / prices (UI) | DONE | Wizard + ops panel price change |
| Publish / draft | DONE | Wizard publish + action API |
| Open/close / pause sales | DONE | Event + ticket type pause |
| Released inventory vs capacity | DONE | `quantityReleased` + release API |
| Controlled price change under sale | DONE | PriceHistory + reservation snapshots |
| Live sales on admin | DONE | `/live` poll 8s |
| Traffic / funnel analytics | PARTIAL | Track API + funnel counts (no full charts) |
| Vercel production deploy docs | DONE | `docs/VERCEL_DEPLOYMENT.md` |
| Upstash Redis rate limit | DONE | REST provider when env set |
| Waitlist | MISSING | Model stub only (post-launch) |
| Event duplication | MISSING | Post-launch TODO |
| Full marketing suite | MISSING | Out of scope for tomorrow |
| Blob image upload | MISSING → implementing | Vercel Blob or URL field fallback |

## Requirement map (1–46 abbreviated)

| # | Area | Status |
|---|------|--------|
| 1 | Vercel deploy | MISSING → docs + config |
| 2 | No Vercel KV / Upstash | PARTIAL → wire Redis provider |
| 3–5 | Admin SaaS routes / overview / live | PARTIAL → expand |
| 6–7 | Traffic + funnel | MISSING → minimal |
| 8–11 | Inventory release / batches / pause | MISSING → core |
| 12–15 | Price management + lock | MISSING → core |
| 16–20 | Ticket types / quick actions / wizard / draft / master switch | MISSING → core |
| 21–22 | Customer availability display | PARTIAL → config |
| 23 | Waitlist prep | MISSING → model stub |
| 24–26 | Charts / refresh / financial | PARTIAL |
| 27–29 | Orders / attendees / settings | PARTIAL |
| 30–33 | Platform admin / health / webhooks | PARTIAL |
| 34 | Mobile admin quick | PARTIAL |
| 35–37 | Public link / OG / SEO | PARTIAL → OG |
| 38–40 | Images / duplicate / audit | PARTIAL |
| 41–43 | Checklist / first event / inventory test | implementing |
| 44–46 | Design / no over-engineer | DONE (keep identity) |

## Implementation priority for this pass

1. Schema: `quantityReleased`, `salesPausedAt`, `PriceHistory`, analytics events, waitlist stub  
2. Services: pause / release / price change / reservation price snapshot  
3. Admin: wizard + event overview quick actions + tickets + orders/attendees polish  
4. Public: availability modes + OG  
5. Vercel docs + env validation + Upstash rate limit  
6. Integration test: inventory scenario §43  
7. LAUNCH_CHECKLIST.md
