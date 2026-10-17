import { getEmailProvider } from "./provider";
import { formatMoney } from "@/lib/utils";
import { NotificationService } from "@/services/notification-service";

const from = () => ({
  email: process.env.EMAIL_FROM ?? "noreply@ticketly.local",
  name: "Ticketly",
});

function supportBlock(supportEmail?: string | null, supportPhone?: string | null) {
  const lines = [];
  if (supportEmail) lines.push(`E-post: ${supportEmail}`);
  if (supportPhone) lines.push(`Telefon: ${supportPhone}`);
  if (!lines.length) return "Kontakt support via ordresiden hvis du trenger hjelp.";
  return lines.join("\n");
}

export async function sendOrderConfirmationEmail(params: {
  to: string;
  customerName: string;
  orderNumber: string;
  eventName: string;
  eventWhen?: string;
  venue?: string;
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
  const text = `Takk for kjøpet, ${params.customerName}!

Ordrenummer: ${params.orderNumber}
Arrangement: ${params.eventName}
${params.eventWhen ? `Tid: ${params.eventWhen}\n` : ""}${params.venue ? `Sted: ${params.venue}\n` : ""}${
    params.quantity != null ? `Antall billetter: ${params.quantity}\n` : ""
  }Totalt: ${formatMoney(params.total, params.currency)}
${params.sellerName ? `Selger: ${params.sellerName}\n` : ""}
Se billetter: ${params.ticketsUrl}

${supportBlock(params.supportEmail, params.supportPhone)}`;

  const html = `<h1>Ordrebekreftelse</h1>
<p>Hei ${params.customerName},</p>
<p>Takk for kjøpet.</p>
<ul>
<li>Ordrenummer: <strong>${params.orderNumber}</strong></li>
<li>Arrangement: <strong>${params.eventName}</strong></li>
${params.eventWhen ? `<li>Tid: ${params.eventWhen}</li>` : ""}
${params.venue ? `<li>Sted: ${params.venue}</li>` : ""}
${params.quantity != null ? `<li>Antall: ${params.quantity}</li>` : ""}
<li>Totalt: <strong>${formatMoney(params.total, params.currency)}</strong></li>
${params.sellerName ? `<li>Selger: ${params.sellerName}</li>` : ""}
</ul>
<p><a href="${params.ticketsUrl}">Vis billetter</a></p>
<p>${supportBlock(params.supportEmail, params.supportPhone).replace(/\n/g, "<br/>")}</p>`;

  if (params.orderId) {
    return NotificationService.logAndSend({
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

  const provider = getEmailProvider();
  await provider.send({
    from: from(),
    to: { email: params.to, name: params.customerName },
    subject,
    text,
    html,
  });
  return { ok: true as const };
}

export async function sendTicketDeliveryEmail(params: {
  to: string;
  customerName: string;
  eventName: string;
  eventWhen?: string;
  venue?: string;
  ageLimit?: number | null;
  ticketsUrl: string;
  supportEmail?: string | null;
  supportPhone?: string | null;
  orderId?: string;
  eventId?: string;
}) {
  const subject = `Dine billetter til ${params.eventName}`;
  const ageLine =
    params.ageLimit != null
      ? `${params.ageLimit}+ · Gyldig legitimasjon kan bli krevd ved inngang.`
      : null;
  const text = `Hei ${params.customerName},

Her er billettene dine til ${params.eventName}.
${params.eventWhen ? `Tid: ${params.eventWhen}\n` : ""}${params.venue ? `Sted: ${params.venue}\n` : ""}${
    ageLine ? `${ageLine}\n` : ""
  }
Åpne billetter: ${params.ticketsUrl}

${supportBlock(params.supportEmail, params.supportPhone)}`;

  const html = `<h1>Dine billetter</h1>
<p>Hei ${params.customerName},</p>
<p>Billettene dine til <strong>${params.eventName}</strong> er klare.</p>
${params.eventWhen ? `<p>Tid: ${params.eventWhen}</p>` : ""}
${params.venue ? `<p>Sted: ${params.venue}</p>` : ""}
${ageLine ? `<p><strong>${ageLine}</strong></p>` : ""}
<p><a href="${params.ticketsUrl}">Vis billetter</a></p>
<p>${supportBlock(params.supportEmail, params.supportPhone).replace(/\n/g, "<br/>")}</p>`;

  if (params.orderId) {
    return NotificationService.logAndSend({
      to: params.to,
      toName: params.customerName,
      subject,
      html,
      text,
      orderId: params.orderId,
      eventId: params.eventId,
    });
  }

  await getEmailProvider().send({
    from: from(),
    to: { email: params.to, name: params.customerName },
    subject,
    text,
    html,
  });
  return { ok: true as const };
}

export async function sendTicketTransferEmail(params: {
  to: string;
  toName: string;
  eventName: string;
  ticketUrl: string;
  ageLimit?: number | null;
}) {
  const provider = getEmailProvider();
  const age =
    params.ageLimit != null
      ? `\nAlderskrav: ${params.ageLimit}+ · Gyldig legitimasjon kan bli krevd.`
      : "";
  await provider.send({
    from: from(),
    to: { email: params.to, name: params.toName },
    subject: `Du har mottatt en billett til ${params.eventName}`,
    text: `Hei ${params.toName},\n\nDu har mottatt en billett til ${params.eventName}.${age}\nÅpne billetten: ${params.ticketUrl}`,
    html: `<h1>Du har mottatt en billett</h1>
<p>Hei ${params.toName},</p>
<p>Du har mottatt en billett til <strong>${params.eventName}</strong>.</p>
${params.ageLimit != null ? `<p>${params.ageLimit}+ · Gyldig legitimasjon kan bli krevd.</p>` : ""}
<p><a href="${params.ticketUrl}">Åpne billett</a></p>`,
  });
}

export async function sendRefundEmail(params: {
  to: string;
  customerName: string;
  orderNumber: string;
  amount: number;
  currency: string;
  orderId?: string;
  eventId?: string;
}) {
  const subject = `Refusjon for ordre ${params.orderNumber}`;
  const text = `Hei ${params.customerName},\n\nVi har startet refusjon på ${formatMoney(params.amount, params.currency)} for ordre ${params.orderNumber}.\nTilbakebetaling sendes til samme betalingsmåte der dette er mulig.`;
  const html = `<h1>Refusjon</h1><p>Hei ${params.customerName},</p>
<p>Vi har startet refusjon på <strong>${formatMoney(params.amount, params.currency)}</strong> for ordre <strong>${params.orderNumber}</strong>.</p>
<p>Tilbakebetaling sendes til samme betalingsmåte der dette er mulig.</p>`;

  if (params.orderId) {
    return NotificationService.logAndSend({
      to: params.to,
      toName: params.customerName,
      subject,
      html,
      text,
      orderId: params.orderId,
      eventId: params.eventId,
    });
  }

  await getEmailProvider().send({
    from: from(),
    to: { email: params.to, name: params.customerName },
    subject,
    text,
    html,
  });
  return { ok: true as const };
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
    text: `Du er invitert som ${params.role} til ${params.organizationName}.\n\nSett passord og aksepter: ${params.inviteUrl}\n\nLenken er engangsbruk og utløper. Passord sendes aldri på e-post.`,
    html: `<h1>Invitasjon</h1>
<p>Du er invitert som <strong>${params.role}</strong> til <strong>${params.organizationName}</strong>.</p>
<p><a href="${params.inviteUrl}">Sett passord og aksepter invitasjon</a></p>
<p>Lenken er engangsbruk og utløper. Passord sendes aldri på e-post.</p>`,
  });
}

export async function sendPasswordSetupEmail(params: {
  to: string;
  setupUrl: string;
  organizationName?: string;
}) {
  const provider = getEmailProvider();
  const org = params.organizationName ? ` for ${params.organizationName}` : "";
  await provider.send({
    from: from(),
    to: { email: params.to },
    subject: `Sett passord${org} – Ticketly`,
    text: `Sett passordet ditt${org}:\n${params.setupUrl}\n\nLenken er engangsbruk og utløper.`,
    html: `<h1>Sett passord</h1>
<p>Fullfør kontooppsett${org ? ` for <strong>${params.organizationName}</strong>` : ""}.</p>
<p><a href="${params.setupUrl}">Velg passord</a></p>
<p>Lenken er engangsbruk og utløper.</p>`,
  });
}

export async function sendPasswordResetEmail(params: {
  to: string;
  resetUrl: string;
  name?: string;
}) {
  const provider = getEmailProvider();
  const hello = params.name ? `Hei ${params.name},` : "Hei,";
  await provider.send({
    from: from(),
    to: { email: params.to, name: params.name },
    subject: "Tilbakestill passord – Ticketly",
    text: `${hello}\n\nTilbakestill passordet ditt her:\n${params.resetUrl}\n\nHvis du ikke ba om dette, kan du ignorere e-posten.`,
    html: `<h1>Tilbakestill passord</h1>
<p>${hello}</p>
<p><a href="${params.resetUrl}">Velg nytt passord</a></p>
<p>Hvis du ikke ba om dette, kan du ignorere e-posten.</p>`,
  });
}

export async function sendAccountDisabledEmail(params: {
  to: string;
  name?: string;
}) {
  const provider = getEmailProvider();
  const hello = params.name ? `Hei ${params.name},` : "Hei,";
  await provider.send({
    from: from(),
    to: { email: params.to, name: params.name },
    subject: "Konto deaktivert – Ticketly",
    text: `${hello}\n\nKontoen din hos Ticketly er deaktivert. Kontakt administrator hvis dette er feil.`,
    html: `<h1>Konto deaktivert</h1>
<p>${hello}</p>
<p>Kontoen din hos Ticketly er deaktivert. Kontakt administrator hvis dette er feil.</p>`,
  });
}
