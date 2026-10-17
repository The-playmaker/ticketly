export type EmailAddress = { email: string; name?: string };

export type SendEmailInput = {
  to: EmailAddress | EmailAddress[];
  subject: string;
  html: string;
  text?: string;
  from?: EmailAddress;
};

/**
 * EmailProvider abstraction — Console (dev) / Resend (production).
 */
export interface EmailProvider {
  send(input: SendEmailInput): Promise<{ id: string }>;
}

export class ConsoleEmailProvider implements EmailProvider {
  async send(input: SendEmailInput): Promise<{ id: string }> {
    const to = Array.isArray(input.to) ? input.to : [input.to];
    console.info("[email:console]", {
      to: to.map((t) => t.email),
      subject: input.subject,
      preview: input.text?.slice(0, 200) ?? input.html.slice(0, 200),
    });
    return { id: `console_${Date.now()}` };
  }
}

export class ResendEmailProvider implements EmailProvider {
  async send(input: SendEmailInput): Promise<{ id: string }> {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("RESEND_API_KEY is required when EMAIL_PROVIDER=resend");
    }

    const from =
      input.from ??
      ({
        email: process.env.EMAIL_FROM ?? "noreply@ticketly.local",
        name: "Ticketly",
      } satisfies EmailAddress);

    const toList = Array.isArray(input.to) ? input.to : [input.to];
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: from.name ? `${from.name} <${from.email}>` : from.email,
        to: toList.map((t) => (t.name ? `${t.name} <${t.email}>` : t.email)),
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      throw new Error(data.message ?? `Resend error HTTP ${res.status}`);
    }
    if (!data.id) {
      throw new Error("Resend did not return an email id");
    }
    return { id: data.id };
  }
}

export function getEmailProvider(): EmailProvider {
  const provider = (process.env.EMAIL_PROVIDER ?? "console").toLowerCase().trim();
  switch (provider) {
    case "resend":
      return new ResendEmailProvider();
    case "console":
      return new ConsoleEmailProvider();
    default:
      throw new Error(
        `Unsupported EMAIL_PROVIDER=${provider}. Use console (dev) or resend (production).`
      );
  }
}

export function isProductionEmailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const provider = (env.EMAIL_PROVIDER ?? "console").toLowerCase().trim();
  if (provider === "console") return false;
  if (provider === "resend") return Boolean(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim());
  return false;
}
