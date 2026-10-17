import { getEmailProvider } from "./provider";
import { formatMoney } from "@/lib/utils";
import { NotificationService } from "@/services/notification-service";
import {
  detailListHtml,
  escapeHtml,
  footerTextBlock,
  wrapEmailHtml,
} from "./layout";

const from = () => ({
  email: process.env.EMAIL_FROM ?? "noreply@ticketly.local",
  name: "Ticketly",
});

async function deliver(params: {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text: string;
  orderId?: string;
  eventId?: string;
  userId?: string;
}) {
  if (params.orderId) {
    return NotificationService.logAndSend({
      to: params.to,
      toName: params.toName,
      subject: params.subject,
      html: params.html,
      text: params.text,
      orderId: params.orderId,
      eventId: params.eventId,
      userId: params.userId,
    });
  }

  await getEmailProvider().send({
    from: from(),
    to: { email: params.to, name: params.toName },
    subject: params.subject,
    text: params.text,
    html: params.html,
  });
  return { ok: true as const };
}

export async function sendOrderConfirmationEmail(params: {
  to: string;
  customerName: string;
  orderNumber: string;
  eventName: string;
  eventWhen?: string;
  venue?: string;
  ageLimit?: number | null;
  quantity?: number;
  total: number;
  currency: string;
  sellerName?: string;
  ticketsUrl: string;
  supportEmail?: string | null;
  supportPhone?: string | null;
  orderId?: string;
  eventId?: string;
  userId?: string;
}) {
  const subject = `Ordrebekreftelse – ${params.eventName}`;
  const ageLine =
    params.ageLimit != null
      ? `${params.ageLimit}+ · Gyldig legitimasjon kan bli krevd ved inngang`
      : "";

  const text = `Takk for kjøpet, ${params.customerName}!

Ordrenummer: ${params.orderNumber}
Arrangement: ${params.eventName}
${params.eventWhen ? `Tid: ${params.eventWhen}\n` : ""}${params.venue ? `Sted: ${params.venue}\n` : ""}${
    ageLine ? `Alderskrav: ${ageLine}\n` : ""
  }${
    params.quantity != null ? `Antall billetter: ${params.quantity}\n` : ""
  }Totalt: ${formatMoney(params.total, params.currency)}

Vis billetter: ${params.ticketsUrl}

${footerTextBlock({
  supportEmail: params.supportEmail,
  supportPhone: params.supportPhone,
  sellerName: params.sellerName,
})}`;

  const bodyHtml = `
<p style="margin:0 0 12px;">Hei ${escapeHtml(params.customerName)},</p>
<p style="margin:0 0 12px;">Takk for kjøpet. Her er bekreftelsen på ordren din.</p>
${detailListHtml([
  { label: "Ordrenummer", value: params.orderNumber, strong: true },
  { label: "Arrangement", value: params.eventName, strong: true },
  { label: "Tid", value: params.eventWhen ?? "" },
  { label: "Sted", value: params.venue ?? "" },
  { label: "Alderskrav", value: ageLine },
  {
    label: "Antall",
    value: params.quantity != null ? String(params.quantity) : "",
  },
  {
    label: "Totalt",
    value: formatMoney(params.total, params.currency),
    strong: true,
  },
])}`;

  const html = wrapEmailHtml({
    preheader: `Ordre ${params.orderNumber} er bekreftet – ${params.eventName}`,
    title: "Ordrebekreftelse",
    bodyHtml,
    cta: { href: params.ticketsUrl, label: "Vis billetter" },
    supportEmail: params.supportEmail,
    supportPhone: params.supportPhone,
    sellerName: params.sellerName,
  });

  return deliver({
    to: params.to,
    toName: params.customerName,
    subject,
    html,
    text,
    orderId: params.orderId,
    eventId: params.eventId,
    userId: params.userId,
  });
}

export async function sendTicketDeliveryEmail(params: {
  to: string;
  customerName: string;
  eventName: string;
  eventWhen?: string;
  venue?: string;
  ageLimit?: number | null;
  orderNumber?: string;
  ticketsUrl: string;
  supportEmail?: string | null;
  supportPhone?: string | null;
  orderId?: string;
  eventId?: string;
}) {
  const subject = `Billettene dine – ${params.eventName}`;
  const ageLine =
    params.ageLimit != null
      ? `${params.ageLimit}+ · Gyldig legitimasjon kan bli krevd ved inngang`
      : "";

  const text = `Hei ${params.customerName},

Billettene dine til ${params.eventName} er klare.
${params.orderNumber ? `Ordrenummer: ${params.orderNumber}\n` : ""}${
    params.eventWhen ? `Tid: ${params.eventWhen}\n` : ""
  }${params.venue ? `Sted: ${params.venue}\n` : ""}${ageLine ? `Alderskrav: ${ageLine}\n` : ""}
Vis billetter: ${params.ticketsUrl}

Ta med QR-koden på telefonen eller som PDF i døra. Ikke del billetten offentlig.

${footerTextBlock({
  supportEmail: params.supportEmail,
  supportPhone: params.supportPhone,
})}`;

  const bodyHtml = `
<p style="margin:0 0 12px;">Hei ${escapeHtml(params.customerName)},</p>
<p style="margin:0 0 12px;">Billettene dine er klare. Åpne dem via knappen under — én QR per billett.</p>
${detailListHtml([
  { label: "Arrangement", value: params.eventName, strong: true },
  { label: "Ordrenummer", value: params.orderNumber ?? "" },
  { label: "Tid", value: params.eventWhen ?? "" },
  { label: "Sted", value: params.venue ?? "" },
  { label: "Alderskrav", value: ageLine },
])}
<p style="margin:16px 0 0;font-size:13px;color:#c7c5d0;">Ta med QR-koden på telefonen eller som PDF i døra.</p>`;

  const html = wrapEmailHtml({
    preheader: `Åpne billettene dine til ${params.eventName}`,
    title: "Billettene dine",
    bodyHtml,
    cta: { href: params.ticketsUrl, label: "Vis billetter" },
    supportEmail: params.supportEmail,
    supportPhone: params.supportPhone,
  });

  return deliver({
    to: params.to,
    toName: params.customerName,
    subject,
    html,
    text,
    orderId: params.orderId,
    eventId: params.eventId,
  });
}

export async function sendTicketTransferEmail(params: {
  to: string;
  toName: string;
  eventName: string;
  ticketUrl: string;
  ageLimit?: number | null;
}) {
  const subject = `Du har mottatt en billett – ${params.eventName}`;
  const ageLine =
    params.ageLimit != null
      ? `${params.ageLimit}+ · Gyldig legitimasjon kan bli krevd ved inngang`
      : "";

  const text = `Hei ${params.toName},

Du har mottatt en billett til ${params.eventName}.
${ageLine ? `Alderskrav: ${ageLine}\n` : ""}
Åpne billetten: ${params.ticketUrl}

${footerTextBlock({})}`;

  const bodyHtml = `
<p style="margin:0 0 12px;">Hei ${escapeHtml(params.toName)},</p>
<p style="margin:0 0 12px;">Du har mottatt en billett. Åpne den via knappen under.</p>
${detailListHtml([
  { label: "Arrangement", value: params.eventName, strong: true },
  { label: "Alderskrav", value: ageLine },
])}`;

  const html = wrapEmailHtml({
    preheader: `En billett til ${params.eventName} venter på deg`,
    title: "Du har mottatt en billett",
    bodyHtml,
    cta: { href: params.ticketUrl, label: "Åpne billett" },
  });

  await getEmailProvider().send({
    from: from(),
    to: { email: params.to, name: params.toName },
    subject,
    text,
    html,
  });
}

export async function sendRefundEmail(params: {
  to: string;
  customerName: string;
  orderNumber: string;
  amount: number;
  currency: string;
  eventName?: string;
  supportEmail?: string | null;
  supportPhone?: string | null;
  orderId?: string;
  eventId?: string;
}) {
  const subject = `Refusjon startet – ordre ${params.orderNumber}`;
  const amount = formatMoney(params.amount, params.currency);

  const text = `Hei ${params.customerName},

Vi har startet refusjon på ${amount} for ordre ${params.orderNumber}.
${params.eventName ? `Arrangement: ${params.eventName}\n` : ""}
Tilbakebetaling sendes til samme betalingsmåte der dette er mulig. Det kan ta noen virkedager før beløpet er synlig.

${footerTextBlock({
  supportEmail: params.supportEmail,
  supportPhone: params.supportPhone,
})}`;

  const bodyHtml = `
<p style="margin:0 0 12px;">Hei ${escapeHtml(params.customerName)},</p>
<p style="margin:0 0 12px;">Vi har startet refusjon for ordren din.</p>
${detailListHtml([
  { label: "Ordrenummer", value: params.orderNumber, strong: true },
  { label: "Arrangement", value: params.eventName ?? "" },
  { label: "Beløp", value: amount, strong: true },
])}
<p style="margin:12px 0 0;">Tilbakebetaling sendes til samme betalingsmåte der dette er mulig. Det kan ta noen virkedager før beløpet er synlig.</p>`;

  const html = wrapEmailHtml({
    preheader: `Refusjon på ${amount} for ordre ${params.orderNumber}`,
    title: "Refusjon startet",
    bodyHtml,
    supportEmail: params.supportEmail,
    supportPhone: params.supportPhone,
  });

  return deliver({
    to: params.to,
    toName: params.customerName,
    subject,
    html,
    text,
    orderId: params.orderId,
    eventId: params.eventId,
  });
}

export async function sendEventCancelledEmail(params: {
  to: string;
  customerName: string;
  eventName: string;
  orderNumber: string;
}) {
  const subject = `Arrangement kansellert – ${params.eventName}`;
  const text = `Hei ${params.customerName},

${params.eventName} er kansellert. Ordre ${params.orderNumber} behandles.

${footerTextBlock({})}`;

  const bodyHtml = `
<p style="margin:0 0 12px;">Hei ${escapeHtml(params.customerName)},</p>
<p style="margin:0 0 12px;"><strong style="color:#ffffff;">${escapeHtml(params.eventName)}</strong> er kansellert.</p>
${detailListHtml([{ label: "Ordrenummer", value: params.orderNumber, strong: true }])}
<p style="margin:12px 0 0;">Vi følger opp ordren din. Du får mer informasjon når refusjon eller annen løsning er klar.</p>`;

  const html = wrapEmailHtml({
    preheader: `${params.eventName} er kansellert`,
    title: "Arrangement kansellert",
    bodyHtml,
  });

  await getEmailProvider().send({
    from: from(),
    to: { email: params.to, name: params.customerName },
    subject,
    text,
    html,
  });
}

export async function sendOrganizerInviteEmail(params: {
  to: string;
  organizationName: string;
  inviteUrl: string;
  role: string;
}) {
  const subject = `Invitasjon til ${params.organizationName}`;
  const text = `Du er invitert som ${params.role} til ${params.organizationName}.

Sett passord og aksepter: ${params.inviteUrl}

Lenken er engangsbruk og utløper. Passord sendes aldri på e-post.

${footerTextBlock({})}`;

  const bodyHtml = `
<p style="margin:0 0 12px;">Du er invitert som <strong style="color:#ffffff;">${escapeHtml(params.role)}</strong> til <strong style="color:#ffffff;">${escapeHtml(params.organizationName)}</strong>.</p>
<p style="margin:0;">Lenken er engangsbruk og utløper. Passord sendes aldri på e-post.</p>`;

  const html = wrapEmailHtml({
    preheader: `Invitasjon til ${params.organizationName}`,
    title: "Invitasjon",
    bodyHtml,
    cta: { href: params.inviteUrl, label: "Sett passord og aksepter" },
  });

  await getEmailProvider().send({
    from: from(),
    to: { email: params.to },
    subject,
    text,
    html,
  });
}

export async function sendPasswordSetupEmail(params: {
  to: string;
  setupUrl: string;
  organizationName?: string;
}) {
  const org = params.organizationName ? ` for ${params.organizationName}` : "";
  const subject = `Sett passord${org} – Ticketly`;
  const text = `Sett passordet ditt${org}:
${params.setupUrl}

Lenken er engangsbruk og utløper.

${footerTextBlock({})}`;

  const bodyHtml = `
<p style="margin:0 0 12px;">Fullfør kontooppsett${
    params.organizationName
      ? ` for <strong style="color:#ffffff;">${escapeHtml(params.organizationName)}</strong>`
      : ""
  }.</p>
<p style="margin:0;">Lenken er engangsbruk og utløper.</p>`;

  const html = wrapEmailHtml({
    preheader: "Velg passord for Ticketly-kontoen din",
    title: "Sett passord",
    bodyHtml,
    cta: { href: params.setupUrl, label: "Velg passord" },
  });

  await getEmailProvider().send({
    from: from(),
    to: { email: params.to },
    subject,
    text,
    html,
  });
}

export async function sendPasswordResetEmail(params: {
  to: string;
  resetUrl: string;
  name?: string;
}) {
  const hello = params.name ? `Hei ${params.name},` : "Hei,";
  const subject = "Tilbakestill passord – Ticketly";
  const text = `${hello}

Tilbakestill passordet ditt her:
${params.resetUrl}

Hvis du ikke ba om dette, kan du ignorere e-posten.

${footerTextBlock({})}`;

  const bodyHtml = `
<p style="margin:0 0 12px;">${escapeHtml(hello)}</p>
<p style="margin:0;">Hvis du ikke ba om dette, kan du ignorere e-posten.</p>`;

  const html = wrapEmailHtml({
    preheader: "Tilbakestill passordet ditt på Ticketly",
    title: "Tilbakestill passord",
    bodyHtml,
    cta: { href: params.resetUrl, label: "Velg nytt passord" },
  });

  await getEmailProvider().send({
    from: from(),
    to: { email: params.to, name: params.name },
    subject,
    text,
    html,
  });
}

export async function sendAccountDisabledEmail(params: {
  to: string;
  name?: string;
}) {
  const hello = params.name ? `Hei ${params.name},` : "Hei,";
  const subject = "Konto deaktivert – Ticketly";
  const text = `${hello}

Kontoen din hos Ticketly er deaktivert. Kontakt administrator hvis dette er feil.

${footerTextBlock({})}`;

  const bodyHtml = `
<p style="margin:0 0 12px;">${escapeHtml(hello)}</p>
<p style="margin:0;">Kontoen din hos Ticketly er deaktivert. Kontakt administrator hvis dette er feil.</p>`;

  const html = wrapEmailHtml({
    preheader: "Kontoen din er deaktivert",
    title: "Konto deaktivert",
    bodyHtml,
  });

  await getEmailProvider().send({
    from: from(),
    to: { email: params.to, name: params.name },
    subject,
    text,
    html,
  });
}
