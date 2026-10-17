/**
 * Shared Obsidian Signal email chrome for transactional mail (table layout for Gmail/Outlook/Apple Mail).
 * Public customer links only — never embed internal analytics or third-party trackers.
 */

const COLORS = {
  bg: "#131316",
  surface: "#1f1f22",
  surfaceHigh: "#2a2a2d",
  text: "#e4e1e6",
  muted: "#c7c5d0",
  accent: "#ff5a1f",
  accentSoft: "#ffb59e",
  outline: "#5b4038",
  white: "#ffffff",
} as const;

function appBaseUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3456").replace(/\/$/, "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function emailLegalLinks(): { terms: string; privacy: string; refund: string } {
  const base = appBaseUrl();
  return {
    terms: `${base}/terms`,
    privacy: `${base}/privacy`,
    refund: `${base}/refund-policy`,
  };
}

export function supportLinesText(supportEmail?: string | null, supportPhone?: string | null): string {
  const lines: string[] = [];
  if (supportEmail) lines.push(`E-post: ${supportEmail}`);
  if (supportPhone) lines.push(`Telefon: ${supportPhone}`);
  if (!lines.length) {
    return "Trenger du hjelp? Bruk supportlenken på ordresiden, eller svar på denne e-posten hvis den er sendt fra arrangøren.";
  }
  return lines.join("\n");
}

export function wrapEmailHtml(params: {
  preheader: string;
  title: string;
  bodyHtml: string;
  cta?: { href: string; label: string };
  supportEmail?: string | null;
  supportPhone?: string | null;
  sellerName?: string | null;
  /** Optional event cover shown above the title band (ticket / order mail). */
  coverImageUrl?: string | null;
}): string {
  const links = emailLegalLinks();
  const supportHtml = supportLinesText(params.supportEmail, params.supportPhone)
    .split("\n")
    .map((line) => escapeHtml(line))
    .join("<br/>");

  const ctaBlock = params.cta
    ? `<tr>
        <td align="center" style="padding:8px 32px 28px;">
          <a href="${escapeHtml(params.cta.href)}"
             style="display:inline-block;background:${COLORS.accent};color:${COLORS.white};font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:6px;">
            ${escapeHtml(params.cta.label)}
          </a>
        </td>
      </tr>`
    : "";

  const seller =
    params.sellerName != null && params.sellerName.trim()
      ? `<p style="margin:0 0 8px;font-size:13px;color:${COLORS.muted};">Selger: ${escapeHtml(params.sellerName)}</p>`
      : "";

  const coverBlock =
    params.coverImageUrl != null && params.coverImageUrl.trim()
      ? `<tr>
            <td style="padding:0;line-height:0;font-size:0;">
              <img src="${escapeHtml(params.coverImageUrl)}" alt="" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0;"/>
            </td>
          </tr>`
      : "";

  return `<!DOCTYPE html>
<html lang="nb">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="dark"/>
<title>${escapeHtml(params.title)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.bg};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${escapeHtml(params.preheader)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.bg};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${COLORS.surface};border:1px solid ${COLORS.outline};border-radius:12px;overflow:hidden;">
          ${coverBlock}
          <tr>
            <td style="background:${COLORS.surfaceHigh};padding:20px 32px;border-bottom:3px solid ${COLORS.accent};">
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${COLORS.accent};font-weight:700;">
                Ticketly
              </p>
              <h1 style="margin:8px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.25;color:${COLORS.white};font-weight:700;">
                ${escapeHtml(params.title)}
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px 8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:${COLORS.text};">
              ${params.bodyHtml}
            </td>
          </tr>
          ${ctaBlock}
          <tr>
            <td style="padding:8px 32px 28px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:${COLORS.muted};border-top:1px solid ${COLORS.outline};">
              ${seller}
              <p style="margin:0 0 12px;font-weight:600;color:${COLORS.text};">Support</p>
              <p style="margin:0 0 16px;">${supportHtml}</p>
              <p style="margin:0;">
                <a href="${escapeHtml(links.terms)}" style="color:${COLORS.accentSoft};text-decoration:underline;">Kjøpsvilkår</a>
                &nbsp;·&nbsp;
                <a href="${escapeHtml(links.privacy)}" style="color:${COLORS.accentSoft};text-decoration:underline;">Personvern</a>
                &nbsp;·&nbsp;
                <a href="${escapeHtml(links.refund)}" style="color:${COLORS.accentSoft};text-decoration:underline;">Refusjon</a>
              </p>
              <p style="margin:16px 0 0;font-size:11px;color:${COLORS.muted};">
                Du mottar denne e-posten fordi du har handlet via Ticketly. Ingen sporingslenker er lagt til.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function detailListHtml(
  rows: Array<{ label: string; value: string; strong?: boolean }>
): string {
  const items = rows
    .filter((r) => r.value.trim().length > 0)
    .map((r) => {
      const value = r.strong
        ? `<strong style="color:#ffffff;">${escapeHtml(r.value)}</strong>`
        : escapeHtml(r.value);
      return `<tr>
        <td style="padding:6px 0;font-size:13px;color:${COLORS.muted};width:38%;vertical-align:top;">${escapeHtml(r.label)}</td>
        <td style="padding:6px 0;font-size:15px;color:${COLORS.text};vertical-align:top;">${value}</td>
      </tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:12px 0 8px;">${items}</table>`;
}

export function footerTextBlock(params: {
  supportEmail?: string | null;
  supportPhone?: string | null;
  sellerName?: string | null;
}): string {
  const links = emailLegalLinks();
  const parts = [
    params.sellerName ? `Selger: ${params.sellerName}` : "",
    "Support",
    supportLinesText(params.supportEmail, params.supportPhone),
    "",
    `Kjøpsvilkår: ${links.terms}`,
    `Personvern: ${links.privacy}`,
    `Refusjon: ${links.refund}`,
  ].filter(Boolean);
  return parts.join("\n");
}

export { escapeHtml, COLORS as EMAIL_COLORS };
