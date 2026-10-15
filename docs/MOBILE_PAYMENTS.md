# Mobile payments (Expo)

## Web launch vs native

Tomorrow’s **web** launch uses Nexi Checkout Embedded on `apps/web`.
The Expo app (`apps/mobile`) must use the **same backend** payment architecture
(`POST /api/checkout` → provider webhooks → order PAID → tickets).

Native Nexi / Checkout SDK integration may be **PARTIAL / TODO** for the web
launch if the mobile app is not shipping tomorrow. Do not delay web launch solely
for a native payment SDK.

## Recommended path

1. Mobile calls Ticketly backend to create order + Nexi payment (same as web)
2. Prefer official Nexi mobile / Checkout integration when shipping native pay
3. Do **not** wrap the web checkout in a WebView and pretend it is native if an
   official SDK is the correct integration for your Nexi agreement
4. Until native SDK is wired: deep-link to the web checkout payment page over HTTPS
   on the production domain is an acceptable interim for staff testing only

## Status

| Surface | Status |
|---------|--------|
| Web EmbeddedCheckout | Implemented |
| Backend Nexi provider + webhooks | Implemented |
| Expo native payment UI | TODO / document when App Store release is scheduled |

Shared rules: no secret API keys on device; amounts from server; webhooks are source of truth.
