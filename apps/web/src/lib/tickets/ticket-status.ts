/** Customer-facing ticket status labels and QR display rules. */

export type TicketLifecycleStatus =
  | "RESERVED"
  | "VALID"
  | "CHECKED_IN"
  | "CANCELLED"
  | "TRANSFERRED"
  | "REFUNDED"
  | string;

export type TicketStatusPresentation = {
  label: string;
  description: string;
  variant: "success" | "danger" | "warning" | "muted" | "default";
  /** When true, do not render a scannable QR. */
  qrDisabled: boolean;
};

const STATUS_MAP: Record<string, TicketStatusPresentation> = {
  RESERVED: {
    label: "Reservert",
    description: "Billetten er reservert og ikke klar for inngang ennå.",
    variant: "warning",
    qrDisabled: true,
  },
  VALID: {
    label: "Gyldig",
    description: "Vis QR-koden i døra.",
    variant: "success",
    qrDisabled: false,
  },
  CHECKED_IN: {
    label: "Brukt",
    description: "Denne billetten er allerede skannet inn.",
    variant: "muted",
    qrDisabled: true,
  },
  CANCELLED: {
    label: "Kansellert",
    description: "Billetten er kansellert og kan ikke brukes.",
    variant: "danger",
    qrDisabled: true,
  },
  TRANSFERRED: {
    label: "Overført",
    description: "Billetten er overført. Den gamle QR-koden er ugyldig.",
    variant: "warning",
    qrDisabled: true,
  },
  REFUNDED: {
    label: "Refundert",
    description: "Billetten er refundert og kan ikke brukes.",
    variant: "danger",
    qrDisabled: true,
  },
};

export function getTicketStatusPresentation(
  status: TicketLifecycleStatus
): TicketStatusPresentation {
  return (
    STATUS_MAP[status] ?? {
      label: status,
      description: "Ukjent billettstatus.",
      variant: "muted" as const,
      qrDisabled: true,
    }
  );
}

export function isQrDisabled(status: TicketLifecycleStatus): boolean {
  return getTicketStatusPresentation(status).qrDisabled;
}
