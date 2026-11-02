"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/utils";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";
import {
  EMAIL_MESSAGES,
  emailSchema,
  emailTypoHint,
  normalizeEmail,
} from "@ticketly/validation";
import { toPaymentUserFacingError, toUserFacingError } from "@/lib/user-facing-error";
import {
  availabilityFromErrorCode,
  technicalErrorPresentation,
  type TicketAvailabilityPresentation,
} from "@/lib/tickets/ticket-availability";
import { TicketAvailabilityStatus } from "@/components/tickets/ticket-availability-status";
import {
  readPromoterRefClient,
  readRefFromSearchParams,
  setPromoterRefCookie,
} from "@/lib/promoter";

const schema = z
  .object({
    firstName: z.string().min(1, "Påkrevd"),
    lastName: z.string().min(1, "Påkrevd"),
    email: emailSchema,
    emailConfirm: z.string().min(1, EMAIL_MESSAGES.required),
    phone: z.string().optional(),
    promoCode: z.string().optional(),
    createAccount: z.boolean().optional(),
    termsAccepted: z.literal(true, { error: "Du må godta vilkårene" }),
    ageConfirmed: z.boolean().optional(),
    marketingOptIn: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    if (normalizeEmail(val.emailConfirm) !== val.email) {
      ctx.addIssue({
        code: "custom",
        path: ["emailConfirm"],
        message: EMAIL_MESSAGES.mismatch,
      });
    }
  });

type FormValues = z.infer<typeof schema>;

export function CheckoutForm({
  eventId,
  eventName,
  sessionId,
  items,
  estimatedTotal,
  ageLimit,
  coverImageUrl,
  seller,
}: {
  eventId: string;
  eventName: string;
  sessionId: string;
  items: { ticketTypeId: string; quantity: number }[];
  estimatedTotal: number;
  ageLimit?: number | null;
  /** Cache-busted cover URL shown on parent; kept for component consumers/tests. */
  coverImageUrl?: string | null;
  seller?: {
    legalName: string;
    organizationNumber?: string | null;
  } | null;
}) {
  void coverImageUrl;
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availabilityFeedback, setAvailabilityFeedback] =
    useState<TicketAvailabilityPresentation | null>(null);
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [typoDismissed, setTypoDismissed] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(
      schema.superRefine((val, ctx) => {
        if (ageLimit != null && ageLimit > 0 && val.ageConfirmed !== true) {
          ctx.addIssue({
            code: "custom",
            path: ["ageConfirmed"],
            message: "Bekreft alderskravet",
          });
        }
      })
    ),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      emailConfirm: "",
      phone: "",
      promoCode: "",
      createAccount: false,
      termsAccepted: undefined as unknown as true,
      ageConfirmed: false,
      marketingOptIn: false,
    },
  });

  const watchedEmail = form.watch("email");
  const typoHint = useMemo(() => {
    const hint = emailTypoHint(watchedEmail ?? "");
    if (!hint) return null;
    if (typoDismissed === hint.original) return null;
    return hint;
  }, [watchedEmail, typoDismissed]);

  // Prefill promoter / promo code from ?ref= cookie or URL (never blocks checkout).
  // startTransition: avoid Suspense/hydration early-update (React #421) while siblings hydrate.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = readRefFromSearchParams(params);
      if (fromUrl) setPromoterRefCookie(fromUrl);
      const existing = form.getValues("promoCode");
      if (existing?.trim()) return;
      const code = fromUrl ?? readPromoterRefClient();
      if (code) {
        startTransition(() => {
          form.setValue("promoCode", code);
        });
        void (async () => {
          const res = await fetch("/api/promos/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, eventId, subtotal: estimatedTotal }),
          });
          if (!res.ok) return;
          const data = await res.json();
          startTransition(() => {
            setPromoDiscount(data.discount ?? 0);
          });
        })();
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount for attribution
  }, []);

  async function validatePromo() {
    const code = form.getValues("promoCode");
    if (!code) return;
    const res = await fetch("/api/promos/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, eventId, subtotal: estimatedTotal }),
    });
    const data = await res.json();
    if (res.ok) {
      setPromoDiscount(data.discount ?? 0);
      setError(null);
    } else {
      setPromoDiscount(0);
      setError(toUserFacingError(data, "Ugyldig kampanjekode"));
    }
  }

  async function pay(values: FormValues) {
    setLoading(true);
    setError(null);
    setAvailabilityFeedback(null);
    try {
      const params = new URLSearchParams(
        typeof window !== "undefined" ? window.location.search : ""
      );
      // Prefer typed code; fall back to cookie/URL ref so attribution survives empty field.
      const attributedCode =
        values.promoCode?.trim() ||
        readRefFromSearchParams(params) ||
        readPromoterRefClient() ||
        undefined;
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          sessionId,
          items,
          firstName: values.firstName,
          lastName: values.lastName,
          email: values.email,
          emailConfirm: values.emailConfirm,
          phone: values.phone,
          promoCode: attributedCode,
          createAccount: values.createAccount,
          termsAccepted: true,
          termsVersion: LEGAL_VERSIONS.terms,
          privacyVersion: LEGAL_VERSIONS.privacy,
          refundPolicyVersion: LEGAL_VERSIONS.refundPolicy,
          ageConfirmed: ageLimit != null ? Boolean(values.ageConfirmed) : undefined,
          marketingOptIn: Boolean(values.marketingOptIn),
          utmSource: params.get("utm_source") ?? undefined,
          utmMedium: params.get("utm_medium") ?? undefined,
          utmCampaign: params.get("utm_campaign") ?? undefined,
          utmContent: params.get("utm_content") ?? undefined,
          utmTerm: params.get("utm_term") ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const code =
          data && typeof data === "object" && data.error && typeof data.error === "object"
            ? (data.error as { code?: string }).code
            : undefined;
        const business = availabilityFromErrorCode(code);
        if (business) {
          setAvailabilityFeedback(business);
          setLoading(false);
          return;
        }
        throw new Error(toPaymentUserFacingError(data));
      }

      if (data.integrationType === "HostedPaymentPage" && data.checkoutUrl && !data.checkoutKey) {
        window.location.assign(data.checkoutUrl);
        return;
      }

      if (data.paymentId && data.checkoutKey) {
        const q = new URLSearchParams({
          paymentId: data.paymentId,
          orderNumber: data.orderNumber,
          t: data.accessToken,
        });
        router.push(`/checkout/payment?${q.toString()}`);
        return;
      }

      if (data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
        return;
      }

      throw new Error("Mangler betalingsøkt fra server");
    } catch (e) {
      setAvailabilityFeedback(technicalErrorPresentation(toPaymentUserFacingError(e)));
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">
        <li className={step >= 1 ? "text-[color:var(--accent)]" : undefined}>1. Billetter</li>
        <li aria-hidden>·</li>
        <li className={step >= 2 ? "text-[color:var(--accent)]" : undefined}>2. Kontakt</li>
        <li aria-hidden>·</li>
        <li className={step >= 3 ? "text-[color:var(--accent)]" : undefined}>3. Betaling</li>
      </ol>

      <div className="tl-panel p-4">
        <p className="text-sm text-[color:var(--muted)]">{eventName}</p>
        <p className="mt-1 font-display text-2xl font-semibold tabular-nums">
          {formatMoney(Math.max(0, estimatedTotal - promoDiscount))}
          {promoDiscount > 0 ? (
            <span className="ml-2 text-sm font-normal text-[color:var(--success)]">
              −{formatMoney(promoDiscount)}
            </span>
          ) : null}
        </p>
        {ageLimit != null ? (
          <p className="mt-2 text-xs text-[color:var(--accent-soft)]">
            {ageLimit}+ · Gyldig legitimasjon kreves
          </p>
        ) : null}
        {seller?.legalName ? (
          <p className="mt-2 text-xs text-[color:var(--muted)]">
            Selger: {seller.legalName}
            {seller.organizationNumber ? ` · Org.nr. ${seller.organizationNumber}` : ""}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-[color:var(--muted)]">Serviceavgift beregnes i neste steg</p>
      </div>

      {step === 1 ? (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-[color:var(--muted)]">
            Billetter er reservert i 10 minutter mens du fullfører kjøpet.
          </p>
          <Button className="w-full" size="lg" onClick={() => setStep(2)}>
            Fortsett
          </Button>
        </div>
      ) : null}

      {step >= 2 ? (
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((v) => {
            setStep(3);
            void pay(v);
          })}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="firstName">Fornavn</Label>
              <Input id="firstName" {...form.register("firstName")} />
            </div>
            <div>
              <Label htmlFor="lastName">Etternavn</Label>
              <Input id="lastName" {...form.register("lastName")} />
            </div>
          </div>
          <div>
            <Label htmlFor="email">E-post</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              {...form.register("email", {
                onChange: () => setTypoDismissed(null),
              })}
            />
            {form.formState.errors.email ? (
              <p className="mt-1 text-sm text-[color:var(--destructive)]">{form.formState.errors.email.message}</p>
            ) : null}
            {typoHint ? (
              <p
                className="mt-1.5 text-sm text-[color:var(--warning)]"
                role="status"
                data-testid="email-typo-hint"
              >
                {typoHint.message}{" "}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:brightness-110"
                  onClick={() => {
                    form.setValue("email", typoHint.suggested, {
                      shouldValidate: true,
                      shouldDirty: true,
                    });
                    setTypoDismissed(null);
                  }}
                >
                  Bruk forslag
                </button>
                <span className="text-[color:var(--muted)]"> · </span>
                <button
                  type="button"
                  className="text-[color:var(--muted)] underline underline-offset-2 hover:text-foreground"
                  onClick={() => setTypoDismissed(typoHint.original)}
                >
                  Nei
                </button>
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="emailConfirm">Bekreft e-post</Label>
            <Input
              id="emailConfirm"
              type="email"
              autoComplete="email"
              {...form.register("emailConfirm")}
            />
            {form.formState.errors.emailConfirm ? (
              <p className="mt-1 text-sm text-[color:var(--destructive)]">
                {form.formState.errors.emailConfirm.message}
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="phone">Telefon</Label>
            <Input id="phone" type="tel" {...form.register("phone")} />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="promoCode">Kampanjekode</Label>
              <Input id="promoCode" {...form.register("promoCode")} placeholder="VIP20" />
            </div>
            <Button type="button" variant="secondary" className="mt-6" onClick={validatePromo}>
              Bruk
            </Button>
          </div>

          {ageLimit != null && ageLimit > 0 ? (
            <label className="flex items-start gap-3 rounded-lg border border-[color:var(--outline)]/30 bg-[color:var(--surface-low)]/60 p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                {...form.register("ageConfirmed")}
              />
              <span>
                <span className="font-medium text-foreground">
                  Jeg bekrefter at billettbrukeren oppfyller arrangementets aldersgrense ({ageLimit}+).
                </span>
                <span className="mt-1 block text-xs text-[color:var(--muted)]">
                  Gyldig legitimasjon kan bli krevd ved inngang. Dette er ikke en identitetskontroll.
                </span>
              </span>
            </label>
          ) : null}

          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1" {...form.register("termsAccepted")} />
            <span className="text-[color:var(--muted)]">
              Ved å fullføre kjøpet godtar du{" "}
              <Link href="/terms" className="text-[color:var(--accent-soft)] hover:underline" target="_blank">
                Kjøpsvilkår
              </Link>{" "}
              og{" "}
              <Link
                href="/refund-policy"
                className="text-[color:var(--accent-soft)] hover:underline"
                target="_blank"
              >
                Refusjonspolicy
              </Link>{" "}
              og bekrefter at du har lest{" "}
              <Link href="/privacy" className="text-[color:var(--accent-soft)] hover:underline" target="_blank">
                Personvernerklæringen
              </Link>
              .
            </span>
          </label>

          <label className="flex items-start gap-3 text-sm text-[color:var(--muted)]">
            <input type="checkbox" className="mt-1" {...form.register("marketingOptIn")} />
            <span>
              Ja, jeg vil motta nyheter og tilbud (valgfritt). Du kan melde deg av når som helst.
            </span>
          </label>

          {availabilityFeedback ? (
            <TicketAvailabilityStatus
              status={availabilityFeedback}
              onRetry={
                availabilityFeedback.tone === "error"
                  ? () => void form.handleSubmit(pay)()
                  : undefined
              }
            />
          ) : null}
          {error ? <p className="text-sm text-[color:var(--destructive)]">{error}</p> : null}
          {form.formState.errors.termsAccepted ? (
            <p className="text-sm text-[color:var(--destructive)]">{form.formState.errors.termsAccepted.message}</p>
          ) : null}
          {form.formState.errors.ageConfirmed ? (
            <p className="text-sm text-[color:var(--destructive)]">{form.formState.errors.ageConfirmed.message}</p>
          ) : null}

          <Button className="w-full" size="lg" type="submit" disabled={loading}>
            {loading ? "Forbereder betaling…" : "Gå til betaling"}
          </Button>
          <p className="text-center text-xs text-[color:var(--muted)]">
            Guest checkout — konto er ikke påkrevd. Vi bekrefter betalingen før billettene utstedes.
          </p>
        </form>
      ) : null}
    </div>
  );
}
