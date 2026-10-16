# Stitch Screen Manifest — Ticketly

**Stitch project:** Ticketly: Premium Event Ticketing Platform  
**Project ID:** `16462286503999379148`  
**Design system:** Obsidian Signal (`designTheme.customColor` `#ff5a1f`, Space Grotesk + Inter, dark)

Assets: `design/stitch/{meta,html,screens}/`

| Stitch ID | Screen | Surface | Route | Status | Reuse |
|-----------|--------|---------|-------|--------|-------|
| `b2c9b2936a114ec5a709be75da6f88bc` | Homepage — Finn neste opplevelse | Public / Desktop | `/` | Existing – restyle | `page.tsx`, `SiteHeader`, `EventCard` |
| `05788bcfcf5148c39e994780d11220f7` | Mobil Homepage (390px) | Public / Mobile | `/` | Existing – restyle | same |
| `2b2b13e7935647a7b0b68f521c2dba2e` | Event & Billettvalg | Public / Desktop | `/events/[slug]` | Existing – restyle | event page, `TicketSelector` |
| `7cb0eb8cfb044a46a1b5c0e410005b86` | Mobil Event & Billettvalg | Public / Mobile | `/events/[slug]` | Existing – restyle | same |
| `65b7750422c145adac7031d67a5390e2` | Lynrask Checkout (+ Nexi shell) | Public / Desktop | `/checkout`, `/checkout/payment` | Existing – restyle shell only | `CheckoutForm`, `NexiCheckoutContainer` |
| `98e7c8b20f0d48b3b2989903878be72c` | Order Success | Public / Desktop | `/orders/[orderNumber]` | Existing – restyle | order page, poller |
| `30d8c3292714482bb65a2aa5a24afe02` | Digital QR-Billett | Public / Desktop | `/orders/[orderNumber]`, `/my/tickets` | Existing – restyle | `TicketQrCard` |
| `f1e85b531db8481296da369ae57e3248` | Arrangør Oversikt | Admin / Desktop | `/admin` | Existing – restyle | admin page + shell |
| `75beb49d5e774f7fbeca675600f17d68` | Event Overview & Sales Control | Admin / Desktop | `/admin/events/[id]` | Existing – restyle | `EventOpsPanel` |
| `edc6ba5ffc8c47fcbb94f40115cc8879` | Ordreoversikt & Refusjon | Admin / Desktop | `/admin/orders`, `/admin/orders/[orderNumber]` | Existing – restyle | orders pages |
| `ddcd6591320a4276987c570373455490` | Deltakere & Gjesteliste | Admin / Desktop | `/admin/events/[id]/attendees` | Existing – restyle | attendees page |
| `48bfc5bbcedc4f2db5664e43727724ba` | Betalinger & Oppgjør | Admin / Desktop | `/admin/settings` + payments health | Partial – no wallet | health/diagnostics; **no Ticketly wallet** |
| `853093c953c44cb0988de0faf3c17a0f` | Analyse & Salgsytelse | Admin / Desktop | `/admin/events/[id]/analytics`, `/admin/reports` | Existing – restyle | analytics + charts |
| `3d2d173a96174b189802877add64f124` | Team & Roller | Admin / Desktop | `/admin/settings` (team) | Partial | org settings; team CRUD if missing → unavailable |
| `2621594be47a43849b52686b30510500` | Platform Super Admin | Platform / Desktop | `/admin/platform/...` | Partial | SUPER_ADMIN only; diagnostics exists |
| `c8bbe420d4834503b2d675966300c923` | Mobil Arrangørstyring (390px) | Organizer / Mobile | `/admin` (mobile layout) + `/m` if added | Existing – restyle | dedicated 390px layout |
| `98346e1454ce4af1ae4136ba4dc0106f` | Dørskanner Fullskjerm | Staff / Mobile | `/scan` | Existing – restyle | `ScannerClient` |

### Asset notes

- Screenshot + HTML retrieved for 15/17 screens.
- `98346…` and `c8bbe4…` HTML download URLs redirect to Google sign-in; **screenshots are valid** and used for visual QA.
- Stitch demo copy (`Friday Night`, `92 640`, etc.) must **never** hardcode into production UI — use backend data.

### Design tokens (from `designTheme`)

| Token | Value |
|-------|-------|
| background / surface | `#131316` |
| surface-container | `#1f1f22` |
| surface-container-high | `#2a2a2d` |
| on-surface | `#e4e1e6` |
| muted / secondary | `#c7c5d0` |
| primary-container (CTA) | `#ff5a1f` |
| primary (soft) | `#ffb59e` |
| error | `#ffb4ab` |
| roundness | ROUND_FOUR (~4–8px) |
| headline | Space Grotesk |
| body | Inter |
