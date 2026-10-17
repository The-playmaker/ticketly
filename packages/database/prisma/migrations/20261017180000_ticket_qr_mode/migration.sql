-- Ticket QR mode foundation (DYNAMIC_QR opt-in; STATIC_QR remains default)

CREATE TYPE "TicketQrMode" AS ENUM ('STATIC_QR', 'DYNAMIC_QR');

ALTER TABLE "Event"
  ADD COLUMN "qrMode" "TicketQrMode" NOT NULL DEFAULT 'STATIC_QR',
  ADD COLUMN "dynamicQrTtlSeconds" INTEGER NOT NULL DEFAULT 30;
