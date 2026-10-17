import type { PaymentStatus, ReservationStatus } from "@prisma/client";

/**
 * Backend-driven checkout UI states.
 * Never invent success before server confirmation.
 */
export type CheckoutUiState =
  | "ACTIVE"
  | "PROCESSING"
  | "WAITING_CONFIRMATION"
  | "PAID"
  | "FAILED"
  | "RESERVATION_EXPIRED"
  | "REVIEW_REQUIRED";

export function resolveCheckoutUiState(input: {
  paymentStatus: PaymentStatus | string;
  reservationStatus?: ReservationStatus | string | null;
  reservationExpiresAt?: Date | string | null;
  paymentAnomaly?: boolean;
  initiatingPayment?: boolean;
  /** Client saw payment-completed or landed with checkout=success — still not proof */
  awaitingWebhookConfirm?: boolean;
  now?: Date;
}): CheckoutUiState {
  const now = input.now ?? new Date();

  if (input.paymentAnomaly || input.paymentStatus === "REVIEW_REQUIRED") {
    return "REVIEW_REQUIRED";
  }
  if (input.paymentStatus === "PAID") return "PAID";
  if (input.paymentStatus === "FAILED" || input.paymentStatus === "CANCELLED") {
    return "FAILED";
  }

  if (input.reservationStatus === "EXPIRED" || input.reservationStatus === "RELEASED") {
    return "RESERVATION_EXPIRED";
  }
  if (input.reservationExpiresAt) {
    const exp = new Date(input.reservationExpiresAt);
    if (exp.getTime() < now.getTime() - 5_000) {
      // 5s clock-drift grace — backend remains authoritative
      return "RESERVATION_EXPIRED";
    }
  }

  if (input.initiatingPayment) return "PROCESSING";
  if (input.awaitingWebhookConfirm) return "WAITING_CONFIRMATION";
  if (input.paymentStatus === "AUTHORIZED") return "WAITING_CONFIRMATION";
  if (input.paymentStatus === "PENDING") return "ACTIVE";

  return "ACTIVE";
}

export function checkoutStateCopy(state: CheckoutUiState): {
  title: string;
  body: string;
} {
  switch (state) {
    case "ACTIVE":
      return {
        title: "Fullfør betaling",
        body: "Velg betalingsmetode nedenfor. Kort- og betalingsdetaljer håndteres av betalingsleverandøren.",
      };
    case "PROCESSING":
      return {
        title: "Forbereder betaling…",
        body: "Vi oppretter en sikker betalingsøkt.",
      };
    case "WAITING_CONFIRMATION":
      return {
        title: "Vi bekrefter betalingen",
        body: "Dette tar vanligvis bare et øyeblikk. Vi venter fortsatt på bekreftelse fra betalingsleverandøren.",
      };
    case "PAID":
      return {
        title: "Billettene dine er klare",
        body: "Betalingen er bekreftet og billettene er utstedt.",
      };
    case "FAILED":
      return {
        title: "Betalingen gikk ikke gjennom",
        body: "Prøv igjen eller velg en annen betalingsmetode. Reservasjonen kan fortsatt være gyldig.",
      };
    case "RESERVATION_EXPIRED":
      return {
        title: "Reservasjonen er utløpt",
        body: "Velg billetter på nytt. Backend er autoritativ for tilgjengelighet.",
      };
    case "REVIEW_REQUIRED":
      return {
        title: "Betaling under manuell gjennomgang",
        body: "Ordren er midlertidig sperret. Kontakt support hvis du ble belastet.",
      };
  }
}
