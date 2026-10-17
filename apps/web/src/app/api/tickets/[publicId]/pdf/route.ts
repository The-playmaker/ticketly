import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { buildQrPayload, resolveRawTicketToken } from "@/lib/tickets/token";
import { formatEventDateTime } from "@/lib/time";
import { getOptionalSession } from "@/lib/auth/session";
import { getTicketStatusPresentation } from "@/lib/tickets/ticket-status";

type Props = { params: Promise<{ publicId: string }> };

function safeEqual(a: string, b: string) {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export async function GET(req: Request, { params }: Props) {
  const { publicId } = await params;
  const url = new URL(req.url);
  const accessToken = url.searchParams.get("t");

  const ticket = await prisma.ticket.findUnique({
    where: { publicId },
    include: {
      ticketType: true,
      event: { include: { venue: true } },
      order: true,
    },
  });

  if (!ticket) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Not found" } },
      { status: 404 }
    );
  }

  const session = await getOptionalSession();
  const isOwner = Boolean(
    session && ticket.order.customerId && session.id === ticket.order.customerId
  );
  const hasToken = Boolean(accessToken && safeEqual(accessToken, ticket.order.accessToken));

  if (!isOwner && !hasToken) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Ingen tilgang" } },
      { status: 403 }
    );
  }

  const status = getTicketStatusPresentation(ticket.status);
  const rawToken = resolveRawTicketToken(ticket);
  const canShowQr = Boolean(rawToken) && !status.qrDisabled;

  if (!rawToken && !status.qrDisabled) {
    return NextResponse.json(
      { error: { code: "TOKEN_UNAVAILABLE", message: "QR utilgjengelig" } },
      { status: 409 }
    );
  }

  let qrBuffer: Buffer | null = null;
  if (canShowQr && rawToken) {
    const qrDataUrl = await QRCode.toDataURL(buildQrPayload(rawToken), {
      width: 360,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#09090b", light: "#ffffff" },
    });
    const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, "");
    qrBuffer = Buffer.from(qrBase64, "base64");
  }

  const when = formatEventDateTime(ticket.event.startsAt, ticket.event.timezone);
  const venue = ticket.event.venue?.name ?? ticket.event.city ?? "";
  const holder = ticket.holderName ?? "—";

  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const chunks: Buffer[] = [];

  const pdfBuffer: Buffer = await new Promise((resolve, reject) => {
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header bar
    doc.rect(0, 0, doc.page.width, 72).fill("#131316");
    doc
      .fillColor("#ff5a1f")
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("TICKETLY", 48, 28, { continued: false });
    doc
      .fillColor("#e4e1e6")
      .font("Helvetica")
      .fontSize(10)
      .text("Digital billett", 48, 46);

    doc.fillColor("#ff5a1f").rect(0, 72, doc.page.width, 3).fill();

    let y = 100;
    doc.fillColor("#111111").font("Helvetica-Bold").fontSize(22).text(ticket.event.name, 48, y, {
      width: doc.page.width - 96,
    });
    y = doc.y + 10;

    doc.fillColor("#444444").font("Helvetica").fontSize(11);
    doc.text(when, 48, y);
    y = doc.y + 4;
    if (venue) {
      doc.text(venue, 48, y);
      y = doc.y + 4;
    }
    if (ticket.event.ageLimit != null) {
      doc
        .fillColor("#b45309")
        .text(`${ticket.event.ageLimit}+ · Gyldig legitimasjon kreves`, 48, y);
      y = doc.y + 14;
    } else {
      y += 10;
    }

    // Meta panel
    const panelTop = y;
    doc.roundedRect(48, panelTop, doc.page.width - 96, 108, 6).fillAndStroke("#f4f4f5", "#d4d4d8");

    const meta = [
      ["Billettype", ticket.ticketType.name],
      ["Navn", holder],
      ["Ordre", ticket.order.orderNumber],
      ["Billett-ID", ticket.publicId],
      ["Status", status.label],
    ];
    let metaY = panelTop + 14;
    for (const [label, value] of meta) {
      doc.fillColor("#71717a").font("Helvetica").fontSize(8).text(label.toUpperCase(), 64, metaY);
      doc.fillColor("#18181b").font("Helvetica-Bold").fontSize(11).text(value, 180, metaY - 2, {
        width: doc.page.width - 250,
      });
      metaY += 18;
    }

    y = panelTop + 128;

    if (qrBuffer) {
      const qrSize = 200;
      const qrX = (doc.page.width - qrSize) / 2;
      doc.roundedRect(qrX - 12, y, qrSize + 24, qrSize + 24, 8).fill("#ffffff");
      doc.image(qrBuffer, qrX, y + 12, { width: qrSize });
      y += qrSize + 40;
      doc
        .fillColor("#18181b")
        .font("Helvetica")
        .fontSize(11)
        .text("Vis QR-koden i døra. Én billett — én skanning.", 48, y, {
          align: "center",
          width: doc.page.width - 96,
        });
    } else {
      doc
        .roundedRect(48, y, doc.page.width - 96, 72, 6)
        .fillAndStroke("#fef2f2", "#fecaca");
      doc
        .fillColor("#991b1b")
        .font("Helvetica-Bold")
        .fontSize(14)
        .text(status.label, 64, y + 18, { width: doc.page.width - 128 });
      doc
        .fillColor("#7f1d1d")
        .font("Helvetica")
        .fontSize(11)
        .text(status.description, 64, y + 40, { width: doc.page.width - 128 });
      y += 90;
    }

    doc
      .fillColor("#a1a1aa")
      .font("Helvetica")
      .fontSize(9)
      .text("Ikke del skjermdump eller PDF offentlig. Billetten er personlig.", 48, doc.page.height - 64, {
        width: doc.page.width - 96,
        align: "center",
      });

    doc.end();
  });

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="ticketly-${ticket.publicId}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
