"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/utils";

const schema = z.object({
  firstName: z.string().min(1, "Påkrevd"),
  lastName: z.string().min(1, "Påkrevd"),
  email: z.string().email("Ugyldig e-post"),
  phone: z.string().optional(),
  promoCode: z.string().optional(),
  createAccount: z.boolean().optional(),
});

type FormValues = z.infer<typeof schema>;

export function CheckoutForm({
  eventId,
  eventName,
  sessionId,
  items,
  estimatedTotal,
}: {
  eventId: string;
  eventName: string;
  sessionId: string;
  items: { ticketTypeId: string; quantity: number }[];
  estimatedTotal: number;
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promoDiscount, setPromoDiscount] = useState(0);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      promoCode: "",
      createAccount: false,
    },
  });

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
    } else {
      setPromoDiscount(0);
      setError(data.error ?? "Ugyldig kampanjekode");
    }
  }

  async function pay(values: FormValues) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          sessionId,
          items,
          ...values,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg =
          data?.error?.message ??
          (typeof data.error === "string" ? data.error : null) ??
          "Checkout feilet";
        throw new Error(msg);
      }

      // Free / hosted redirect
      if (data.integrationType === "HostedPaymentPage" && data.checkoutUrl && !data.checkoutKey) {
        window.location.assign(data.checkoutUrl);
        return;
      }

      // Nexi EmbeddedCheckout — stay in Ticketly payment layout
      if (data.paymentId && data.checkoutKey) {
        const params = new URLSearchParams({
          paymentId: data.paymentId,
          orderNumber: data.orderNumber,
          t: data.accessToken,
        });
        router.push(`/checkout/payment?${params.toString()}`);
        return;
      }

      if (data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
        return;
      }

      throw new Error("Mangler betalingsøkt fra server");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Noe gikk galt");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="flex gap-2 text-xs uppercase tracking-wide text-zinc-500">
        <span className={step >= 1 ? "text-amber-400" : ""}>1. Billetter</span>
        <span>·</span>
        <span className={step >= 2 ? "text-amber-400" : ""}>2. Kontakt</span>
        <span>·</span>
        <span className={step >= 3 ? "text-amber-400" : ""}>3. Betaling</span>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <p className="text-sm text-zinc-400">{eventName}</p>
        <p className="mt-1 text-lg font-semibold">
          {formatMoney(Math.max(0, estimatedTotal - promoDiscount))}
          {promoDiscount > 0 ? (
            <span className="ml-2 text-sm font-normal text-emerald-400">
              −{formatMoney(promoDiscount)}
            </span>
          ) : null}
        </p>
        <p className="text-xs text-zinc-500">Serviceavgift beregnes i neste steg</p>
      </div>

      {step === 1 ? (
        <div className="space-y-4">
          <p className="text-sm text-zinc-300">
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
            <Input id="email" type="email" {...form.register("email")} />
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

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <Button className="w-full" size="lg" type="submit" disabled={loading}>
            {loading ? "Forbereder betaling…" : "Gå til betaling"}
          </Button>
          <p className="text-center text-xs text-zinc-500">
            Guest checkout — konto er ikke påkrevd. Betaling bekreftes via sikker webhook, ikke
            success-URL alene.
          </p>
        </form>
      ) : null}
    </div>
  );
}
