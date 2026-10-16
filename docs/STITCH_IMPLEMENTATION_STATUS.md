# Stitch Implementation Status — Ticketly

**Updated:** 2026-10-16  
**Project:** `16462286503999379148` · Obsidian Signal  
**Rule:** Stitch = visual/UX SoT · Ticketly backend = data/business SoT

## Summary

| Bucket | Count |
|--------|------:|
| **READY** | 11 |
| **PARTIAL** | 6 |
| **BLOCKED** | 0 |

**Overall: PARTIAL** — design system + public/admin/scanner restyle shipped against live Stitch assets; some admin surfaces (settlements wallet UI, team CRUD, platform console breadth) remain mapped to existing backend capabilities only.

---

## Per-screen status

| Screen ID | Inferred name | Target | Status | Notes |
|-----------|---------------|--------|--------|-------|
| `b2c9b293…` | Homepage desktop | `/` | **READY** | Obsidian Signal hero + event grid from backend |
| `05788bcf…` | Homepage mobile | `/` | **READY** | Responsive same route |
| `2b2b13e7…` | Event & billettvalg | `/events/[slug]` | **READY** | Accent/token restyle; dynamic data |
| `7cb0eb8c…` | Event mobile | `/events/[slug]` | **READY** | Responsive |
| `65b77504…` | Checkout + Nexi shell | `/checkout*` | **READY** | Visual shell only; **Nexi Embedded Checkout preserved** (no fake card fields) |
| `98e7c8b2…` | Order success | `/orders/[orderNumber]` | **READY** | Poller + pending/paid states intact |
| `30d8c329…` | Digital QR | order / my tickets | **READY** | `TicketQrCard` restyled |
| `f1e85b53…` | Arrangør oversikt | `/admin` | **READY** | Dark sidebar shell + KPI from `getOrgDashboardStats` |
| `75beb49d…` | Sales control | `/admin/events/[id]` | **READY** | `EventOpsPanel` wired to backend release/price/pause |
| `edc6ba5f…` | Ordrer & refusjon | `/admin/orders*` | **PARTIAL** | Dark restyle; refund uses existing APIs |
| `ddcd6591…` | Deltakere | `/admin/events/[id]/attendees` | **PARTIAL** | Existing attendees; styling follow-through |
| `48bfc5bb…` | Betalinger & oppgjør | settings / diagnostics | **PARTIAL** | Nexi health/diagnostics only — **no Ticketly wallet / withdraw** |
| `853093c9…` | Analyse | analytics / reports | **PARTIAL** | Charts restyled; metrics from backend |
| `3d2d173a…` | Team & roller | `/admin/settings` | **PARTIAL** | Org settings exist; full team UI if missing stays unavailable |
| `2621594b…` | Platform Super Admin | `/admin/platform/...` | **PARTIAL** | Diagnostics SUPER_ADMIN-only; broader platform console not invented |
| `c8bbe420…` | Mobil arrangør | `/admin` mobile | **PARTIAL** | Compact top nav + touch targets; HTML asset blocked (Google auth) — screenshot used |
| `98346e14…` | Dørskanner | `/scan` | **READY** | Full-screen HUD around existing check-in engine; HTML asset blocked — screenshot used |

---

## Design system

| Item | Status |
|------|--------|
| Tokens in `globals.css` from Stitch `designTheme` | Done (`#ff5a1f`, surfaces, muted, destructive) |
| Space Grotesk + Inter | Done (`layout.tsx`) |
| Shared Button / Input / Badge / Card / EventCard / SiteHeader / AdminShell | Done |
| No hardcoded Stitch demo figures in production UI | Enforced (backend/empty states) |

## Protected backends (untouched)

Nexi Checkout, PaymentProvider, webhook idempotency, inventory locking, reservation snapshots, QR security, scanner validation, audit, org isolation.

## Remaining

1. Pixel QA pass vs remaining admin screenshots (attendees, team, platform).  
2. Optional `/m` dedicated mobile organizer route if compact admin is insufficient.  
3. Re-download scanner/mobile HTML when Stitch HTML URLs no longer require Google session.  
4. Rotate Stitch API key if it was shared in chat (do not commit).
