# Offline scanner limitations

Online check-in is always preferred.

When using offline mode:

1. **Stale inventory** — tickets sold after the bundle download are unknown offline.
2. **Stale status** — refunds/cancellations after download may still appear VALID.
3. **TTL** — bundles expire; staff must re-download.
4. **Conflicts** — if two devices check in the same ticket offline, the server keeps the first applied success; others become CONFLICT.
5. **PII** — offline DB must not store names, emails, or phones; only publicId, token hash, status, ticket type label.
6. **Key protection** — bundle encryption keys belong in SecureStore / Keychain / Keystore.
7. **Not a substitute for connectivity** — reconnection and sync are mandatory operational procedures.
8. **Dynamic QR** — offline mode is **not supported** for `Event.qrMode=DYNAMIC_QR`. Bundle creation is refused; clients must reject `dqr.v1` payloads rather than falling back to static hashing. See `docs/TICKET_SECURITY.md`.
