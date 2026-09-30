import { getEmailProvider } from "./provider";
import { formatMoney } from "@/lib/utils";

const from = () => ({
  email: process.env.EMAIL_FROM ?? "noreply@ticketly.local",
  name: "Ticketly",
});

export async function sendOrderConfirmationEmail(params: {
  to: string;
  customerName: string;
  orderNumber: string;
  eventName: string;
  total: number;
  currency: string;
  ticketsUrl: string;
}) {
  const provider = getEmailProvider();
  await provider.send({
    from: from(),
    to: { email: params.to, name: params.customerName },
    subject: `Ordrebekreftelse ${params.orderNumber} – ${params.eventName}`,
    text: `Takk for kjøpet, ${params.customerName}!\n\nOrdrenummer: ${params.orderNumber}\nArrangement: ${params.eventName}\nTotalt: ${formatMoney(params.total, params.currency)}\n\nSe billettene dine: ${params.ticketsUrl}`,
    html: `<h1>Takk for kjøpet!</h1>
<p>Hei ${params.customerName},</p>
<p>Ordrenummer: <strong>${params.orderNumber}</strong></p>
<p>Arrangement: <strong>${params.eventName}</strong></p>
<p>Totalt: <strong>${formatMoney(params.total, params.currency)}</strong></p>
<p><a href="${params.ticketsUrl}">Vis billetter</a></p>`,
  });
}

export async function sendTicketTransferEmail(params: {
  to: string;
  toName: string;
  eventName: string;
  ticketUrl: string;
}) {
  const provider = getEmailProvider();
  await provider.send({
    from: from(),
    to: { email: params.to, name: params.toName },
    subject: `Du har mottatt en billett til ${params.eventName}`,
    text: `Hei ${params.toName},\n\nDu har mottatt en billett til ${params.eventName}.\nÅpne billetten: ${params.ticketUrl}`,
    html: `<h1>Du har mottatt en billett</h1>
<p>Hei ${params.toName},</p>
<p>Du har mottatt en billett til <strong>${params.eventName}</strong>.</p>
<p><a href="${params.ticketUrl}">Åpne billett</a></p>`,
  });
}

export async function sendRefundEmail(params: {
  to: string;
  customerName: string;
  orderNumber: string;
  amount: number;
  currency: string;
}) {
  const provider = getEmailProvider();
  await provider.send({
    from: from(),
    to: { email: params.to, name: params.customerName },
    subject: `Refusjon for ordre ${params.orderNumber}`,
    text: `Hei ${params.customerName},\n\nVi har refundert ${formatMoney(params.amount, params.currency)} for ordre ${params.orderNumber}.`,
    html: `<h1>Refusjon</h1><p>Hei ${params.customerName},</p>
<p>Vi har refundert <strong>${formatMoney(params.amount, params.currency)}</strong> for ordre <strong>${params.orderNumber}</strong>.</p>`,
  });
}

export async function sendEventCancelledEmail(params: {
  to: string;
  customerName: string;
  eventName: string;
  orderNumber: string;
}) {
  const provider = getEmailProvider();
  await provider.send({
    from: from(),
    to: { email: params.to, name: params.customerName },
    subject: `Arrangement kansellert: ${params.eventName}`,
    text: `Hei ${params.customerName},\n\n${params.eventName} er kansellert. Ordre ${params.orderNumber} behandles.`,
    html: `<h1>Arrangement kansellert</h1>
<p>Hei ${params.customerName},</p>
<p><strong>${params.eventName}</strong> er kansellert. Ordre <strong>${params.orderNumber}</strong> behandles.</p>`,
  });
}

export async function sendOrganizerInviteEmail(params: {
  to: string;
  organizationName: string;
  inviteUrl: string;
  role: string;
}) {
  const provider = getEmailProvider();
  await provider.send({
    from: from(),
    to: { email: params.to },
    subject: `Invitasjon til ${params.organizationName}`,
    text: `Du er invitert som ${params.role} til ${params.organizationName}.\nAksepter: ${params.inviteUrl}`,
    html: `<h1>Invitasjon</h1>
<p>Du er invitert som <strong>${params.role}</strong> til <strong>${params.organizationName}</strong>.</p>
<p><a href="${params.inviteUrl}">Aksepter invitasjon</a></p>`,
  });
}
