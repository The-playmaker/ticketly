# Stitch Screen Manifest — Ticketly

**Stitch project:** Ticketly: Premium Event Ticketing Platform  
**Project ID:** `16462286503999379148`  
**Design identity (from brief):** Obsidian Signal — dark graphite, amber ≈ `#FF5A1F`, Space Grotesk, premium nightlife

## Retrieval status

| Attempt | Result |
|---------|--------|
| Stitch MCP namespace in Cursor Cloud | **Not installed** |
| `https://stitch.googleapis.com/mcp` `tools/list` | Works without auth (schema only) |
| `get_screen` / `get_project` / `list_screens` | **AUTH REQUIRED** — OAuth 2 / `STITCH_API_KEY` (`X-Goog-Api-Key`) |
| `STITCH_API_KEY` / `STITCH_ACCESS_TOKEN` in environment | **Missing** |
| Downloaded HTML / screenshots | **None** |

Per task rules: **do not proceed with UI restyle from screen IDs alone** when screens can be retrieved with credentials. Application UI changes are **paused** until screens are fetched.

### How to unblock

1. Create/obtain a Stitch API key (or OAuth access token) for the Google account that owns project `16462286503999379148`.
2. Add to Cloud Agent secrets / local `.env` (never commit):

```bash
STITCH_API_KEY=...
# or
STITCH_ACCESS_TOKEN=...
GOOGLE_CLOUD_PROJECT=...
```

3. Run:

```bash
node scripts/fetch-stitch-screens.mjs
```

4. Re-run this agent (or continue) to fill inferred names from HTML/screenshots and implement Obsidian Signal UX into existing Ticketly routes.

Assets land in:

- `design/stitch/meta/*.json`
- `design/stitch/html/*.html`
- `design/stitch/screens/*.{png,webp}`

---

## Screen inventory (IDs only — names pending retrieval)

| # | Stitch ID | Screen (inferred) | Desktop/Mobile | Surface | Target Ticketly route | Status | Reuse |
|---|-----------|-------------------|----------------|---------|----------------------|--------|-------|
| 1 | `05788bcfcf5148c39e994780d11220f7` | _pending retrieval_ | _pending_ | _pending_ | _map after inspect_ | **BLOCKED** | — |
| 2 | `7cb0eb8cfb044a46a1b5c0e410005b86` | _pending retrieval_ | _pending_ | _pending_ | _map after inspect_ | **BLOCKED** | — |
| 3 | `98346e1454ce4af1ae4136ba4dc0106f` | _pending retrieval_ | _pending_ | _pending_ | _map after inspect_ | **BLOCKED** | — |
| 4 | `c8bbe420d4834503b2d675966300c923` | _pending retrieval_ | _pending_ | _pending_ | _map after inspect_ | **BLOCKED** | — |
| 5 | `b2c9b2936a114ec5a709be75da6f88bc` | _pending retrieval_ | _pending_ | _pending_ | _map after inspect_ | **BLOCKED** | — |
| 6 | `65b7750422c145adac7031d67a5390e2` | _pending retrieval_ | _pending_ | _pending_ | _map after inspect_ | **BLOCKED** | — |
| 7 | `30d8c3292714482bb65a2aa5a24afe02` | _pending retrieval_ | _pending_ | _pending_ | _map after inspect_ | **BLOCKED** | — |
| 8 | `2b2b13e7935647a7b0b68f521c2dba2e` | _pending retrieval_ | _pending_ | _pending_ | _map after inspect_ | **BLOCKED** | — |
| 9 | `98e7c8b20f0d48b3b2989903878be72c` | _pending retrieval_ | _pending_ | _pending_ | _map after inspect_ | **BLOCKED** | — |
| 10 | `75beb49d5e774f7fbeca675600f17d68` | _pending retrieval_ | _pending_ | _pending_ | _map after inspect_ | **BLOCKED** | — |
| 11 | `f1e85b531db8481296da369ae57e3248` | _pending retrieval_ | _pending_ | _pending_ | _map after inspect_ | **BLOCKED** | — |
| 12 | `edc6ba5ffc8c47fcbb94f40115cc8879` | _pending retrieval_ | _pending_ | _pending_ | _map after inspect_ | **BLOCKED** | — |
| 13 | `ddcd6591320a4276987c570373455490` | _pending retrieval_ | _pending_ | _pending_ | _map after inspect_ | **BLOCKED** | — |
| 14 | `48bfc5bbcedc4f2db5664e43727724ba` | _pending retrieval_ | _pending_ | _pending_ | _map after inspect_ | **BLOCKED** | — |
| 15 | `853093c953c44cb0988de0faf3c17a0f` | _pending retrieval_ | _pending_ | _pending_ | _map after inspect_ | **BLOCKED** | — |
| 16 | `3d2d173a96174b189802877add64f124` | _pending retrieval_ | _pending_ | _pending_ | _map after inspect_ | **BLOCKED** | — |
| 17 | `2621594be47a43849b52686b30510500` | _pending retrieval_ | _pending_ | _pending_ | _map after inspect_ | **BLOCKED** | — |

Do **not** trust Stitch UI labels such as `Generating Screen...` — infer identity from downloaded HTML + screenshot after auth works.

---

## Anticipated Ticketly route map (for after retrieval)

These are **candidate** mappings from existing app structure — confirm against actual Stitch renders before restyle:

| Likely surface | Existing routes / components to reuse |
|----------------|----------------------------------------|
| Public home / listing | `/`, `/events`, `EventCard`, `SiteHeader` |
| Event detail | `/events/[slug]`, ticket selector |
| Checkout + Nexi shell | `/checkout`, `/checkout/payment`, `NexiCheckoutContainer` (**keep embedded Checkout**) |
| Order success / QR | `/orders/[orderNumber]`, `TicketQrCard` |
| Admin overview | `/admin` |
| Event ops / sales control | `/admin/events/[id]`, `EventOpsPanel` |
| Orders / refund | `/admin/orders`, `/admin/orders/[orderNumber]` |
| Attendees | `/admin/events/[id]/attendees` |
| Analytics / settings | `/admin/events/[id]/analytics`, `/admin/settings` |
| Door scanner | `/scan`, `ScannerClient` |
| Platform diagnostics | `/admin/platform/payments/diagnostics` (SUPER_ADMIN) |

Backend/business logic (Nexi, inventory, webhooks, QR, scanner) remains authoritative — Stitch is visual/UX only.

---

## Design tokens (brief only — not yet extracted from Stitch HTML)

Pending HTML analysis. Brief target:

| Token | Intended direction |
|-------|-------------------|
| Accent | ≈ `#FF5A1F` (Obsidian Signal amber) |
| Background | Dark graphite |
| Typography | Space Grotesk (where design uses it) |
| Character | High contrast, architectural/sharp, nightlife |

Current app `globals.css` still uses `#f59e0b` accent — **do not wholesale swap** until Stitch screens confirm tokens.
