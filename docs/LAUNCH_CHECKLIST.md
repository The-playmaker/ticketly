# Launch Checklist

See [LAUNCH_STATUS.md](./LAUNCH_STATUS.md) and [PAYMENTS.md](./PAYMENTS.md) for current readiness.

## Payments go-live gates

- Nets Easy (Nexi) production keys configured (`PAYMENT_PROVIDER=nexi`)
- Stripe backup keys configured when `PAYMENT_BACKUP_PROVIDER=stripe`
- No automatic Nexi → Stripe failover after a payment has started (create-time only when primary is definitively unavailable)
- Webhooks public HTTPS + secrets set for both providers used
- Real sandbox payment + refund path verified
- `EMAIL_PROVIDER=resend` (or equivalent) — not console
