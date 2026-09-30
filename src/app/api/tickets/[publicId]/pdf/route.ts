import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { buildQrPayload } from "@/lib/tickets/token";
import { formatEventDateTime } from "@/lib/time";

type Props = { params: Promise<{ publicId: string }> };

export async function GET(_req: Request, { params }: Props) {
  const { publicId } = await params;
  const ticket = await prisma.ticket.findUnique({
    where: { publicId },
    include: {
      ticketType: true,
      event: { include: { venue: true } },
      order: true,
    },
  });

  if (!ticket) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const qrDataUrl = await QRCode.toDataURL(buildQrPayload(ticket.secureToken), { width: 300 });
  const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, "");
  const qrBuffer = Buffer.from(qrBase64, "base64");

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const chunks: Buffer[] = [];

  const pdfBuffer: Buffer = await new Promise((resolve, reject) => {
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(22).text("Ticketly", { continued: false });
    doc.moveDown(0.5);
    doc.fontSize(18).text(ticket.event.name);
    doc.fontSize(12).fillColor("#444").text(ticket.ticketType.name);
    doc.text(formatEventDateTime(ticket.event.startsAt, ticket.event.timezone));
    doc.text(ticket.event.venue?.name ?? ticket.event.city ?? "");
    doc.moveDown();
    doc.fillColor("#000").text(`Navn: ${ticket.holderName ?? ""}`);
    doc.text(`Ordre: ${ticket.order.orderNumber}`);
    doc.text(`Billett: ${ticket.publicId}`);
    doc.moveDown();
    doc.image(qrBuffer, { width: 180 });
    doc.moveDown();
    doc.fontSize(9).fillColor("#888").text("Vis QR-koden i døra. Ikke del skjermdump offentlig.");
    doc.end();
  });

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${ticket.publicId}.pdf"`,
    },
  });
}
