# Ticket state machine

Central enforcement: `apps/web/src/services/ticket-state-machine.ts` via `TicketService` / `CheckInService` / `RefundService`.

```
RESERVED ──► VALID ──► CHECKED_IN
               │            │
               ├──► REFUNDED ◄─┤
               ├──► CANCELLED ◄┤
               └──► TRANSFERRED (token rotated; row returns to VALID for new holder)
```

## Allowed transitions

| From | To |
|------|----|
| RESERVED | VALID, CANCELLED |
| VALID | CHECKED_IN, REFUNDED, CANCELLED, TRANSFERRED |
| CHECKED_IN | REFUNDED, CANCELLED |
| TRANSFERRED | CANCELLED, REFUNDED |
| CANCELLED | _(terminal)_ |
| REFUNDED | _(terminal)_ |

## Business rules

- **REFUNDED → VALID** is never allowed without an explicit admin reversal flow (not implemented).
- **CHECKED_IN → REFUNDED** is allowed (post-entry refund policy).
- Transfer stores old/new **token hashes** in `TicketTransfer`; old QR becomes INVALID.
- Refund vs check-in: both take row locks; one wins. Refunded ticket never scans SUCCESS after commit.

## Offline

First online-committed SUCCESS wins. Later offline sync of the same ticket → `OFFLINE_CONFLICT_DUPLICATE` (audit retained).
