# Stitch design assets (Ticketly)

Project: **Ticketly: Premium Event Ticketing Platform**  
ID: `16462286503999379148`

| Folder | Contents |
|--------|----------|
| `meta/` | Per-screen JSON from `get_screen` + `index.json` |
| `html/` | Generated HTML reference (do not ship as runtime) |
| `screens/` | Screenshot renders for visual QA |
| `assets/` | Bundled images extracted for the Next.js app |

Populate with:

```bash
STITCH_API_KEY=... node scripts/fetch-stitch-screens.mjs
```

Treat HTML as **design reference** — translate into existing Ticketly routes/components; do not replace Nexi, inventory, or scanner backends.
