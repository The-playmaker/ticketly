/**
 * Standard API error envelope — never leak stack/Prisma/Stripe internals to clients.
 */
export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public internal?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function toErrorResponse(err: unknown): { status: number; body: ApiErrorBody } {
  if (err instanceof AppError) {
    if (err.internal) {
      console.error("[app-error]", err.code, err.internal);
    }
    return {
      status: err.status,
      body: { error: { code: err.code, message: err.message } },
    };
  }

  const message = err instanceof Error ? err.message : "Unknown error";
  // Map known domain messages
  if (/utsolgt|Kun \d+ billetter|Billettypen er utsolgt/i.test(message)) {
    return {
      status: 409,
      body: { error: { code: "TICKET_SOLD_OUT", message: "Denne billettypen er utsolgt." } },
    };
  }
  if (/Unauthorized|Forbidden/i.test(message)) {
    return {
      status: /Forbidden/i.test(message) ? 403 : 401,
      body: {
        error: {
          code: /Forbidden/i.test(message) ? "FORBIDDEN" : "UNAUTHORIZED",
          message: /Forbidden/i.test(message) ? "Ingen tilgang." : "Innlogging kreves.",
        },
      },
    };
  }

  console.error("[unhandled-api-error]", err);
  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "Noe gikk galt. Prøv igjen senere.",
      },
    },
  };
}

export function jsonError(err: unknown): Response {
  const { status, body } = toErrorResponse(err);
  return Response.json(body, { status });
}
