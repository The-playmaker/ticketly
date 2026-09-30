export type EmailAddress = { email: string; name?: string };

export type SendEmailInput = {
  to: EmailAddress | EmailAddress[];
  subject: string;
  html: string;
  text?: string;
  from?: EmailAddress;
};

/**
 * EmailProvider abstraction — swap Console / Resend / Postmark / SendGrid / SMTP later.
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

/** TODO: Implement with Resend SDK */
export class ResendEmailProvider implements EmailProvider {
  async send(_input: SendEmailInput): Promise<{ id: string }> {
    throw new Error("ResendEmailProvider not implemented — set EMAIL_PROVIDER=console or implement Resend.");
  }
}

export function getEmailProvider(): EmailProvider {
  const provider = process.env.EMAIL_PROVIDER ?? "console";
  switch (provider) {
    case "resend":
      return new ResendEmailProvider();
    case "console":
    default:
      return new ConsoleEmailProvider();
  }
}
