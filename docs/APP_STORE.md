# App Store / Play distribution notes

## Identifiers

| Platform | Value |
|----------|--------|
| iOS bundle ID | `no.ticketly.app` |
| Android package | `no.ticketly.app` |
| URL scheme | `ticketly://` |
| Universal / App Links | `https://ticketly.no/...` |

## Permissions (just-in-time)

- **Camera**: Staff/Scanner mode only (`expo-camera` plugin).
- **Notifications**: requested when enabling push preferences, not at first launch.
- Face ID: only if biometric unlock is enabled later.

## Signing

### iOS
1. Apple Developer account + App ID with Push + Associated Domains.
2. Distribution certificate + provisioning profile.
3. EAS Build: `eas build -p ios` (set real `extra.eas.projectId`).
4. Apple Wallet requires separate Pass Type ID + certs (see `@ticketly/wallet`).

### Android
1. Upload keystore via EAS or Play App Signing.
2. `eas build -p android`.
3. Google Wallet requires issuer account + service account JSON.

## Privacy

- Privacy Manifest / Data safety forms: tickets, email, purchase history, crash logs.
- Marketing push is optional consent — never bundled into purchase acceptance.

## Deep links

- `ticketly://events/{slug}`
- `ticketly://orders/{orderNumber}`
- `ticketly://t/verify/{token}` (opens ticket view; check-in remains staff-only)
- HTTPS app links configured in `app.json` intentFilters / associatedDomains.
