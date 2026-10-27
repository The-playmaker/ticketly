"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EMAIL_MESSAGES,
  emailSchema,
  emailTypoHint,
  normalizeEmail,
} from "@ticketly/validation";

type MsgKind = "ok" | "fail" | null;

export function OrderCustomerEmailPanel({
  orderNumber,
  customerEmail,
  canResend,
}: {
  orderNumber: string;
  customerEmail: string;
  /** Server-computed: paid/partially refunded with active tickets */
  canResend: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(customerEmail);
  const [busy, setBusy] = useState<"save" | "resend" | "both" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgKind, setMsgKind] = useState<MsgKind>(null);
  const [savedEmail, setSavedEmail] = useState(customerEmail);
  const [typoDismissed, setTypoDismissed] = useState<string | null>(null);

  function setFeedback(kind: MsgKind, text: string) {
    setMsgKind(kind);
    setMsg(text);
  }

  const typoHint = useMemo(() => {
    const hint = emailTypoHint(email);
    if (!hint) return null;
    if (typoDismissed === hint.original) return null;
    return hint;
  }, [email, typoDismissed]);

  function clientValidateEmail(): string | null {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setFeedback("fail", EMAIL_MESSAGES.invalid);
      return null;
    }
    return parsed.data;
  }

  async function patchEmail(): Promise<string | null> {
    const validated = clientValidateEmail();
    if (!validated) return null;

    const res = await fetch(`/api/admin/orders/${orderNumber}/customer-email`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: validated }),
    });
    const data = (await res.json().catch(() => null)) as {
      email?: string;
      unchanged?: boolean;
      error?: { message?: string };
    } | null;
    if (!res.ok) {
      throw new Error(data?.error?.message ?? "Kunne ikke lagre e-post");
    }
    const next = data?.email ?? validated;
    setSavedEmail(next);
    setEmail(next);
    return next;
  }

  async function postResend(): Promise<{ email: string; ok: boolean }> {
    const res = await fetch(`/api/admin/orders/${orderNumber}/resend-email`, {
      method: "POST",
    });
    const data = (await res.json().catch(() => null)) as {
      email?: string;
      ok?: boolean;
      error?: { message?: string };
    } | null;
    if (!res.ok) {
      throw new Error(data?.error?.message ?? "Kunne ikke sende e-post");
    }
    return { email: data?.email ?? savedEmail, ok: data?.ok !== false };
  }

  async function onSave() {
    setBusy("save");
    setMsg(null);
    setMsgKind(null);
    try {
      const next = await patchEmail();
      if (!next) return;
      setFeedback("ok", `E-post lagret: ${next}`);
      router.refresh();
    } catch (e) {
      setFeedback("fail", e instanceof Error ? e.message : "Kunne ikke lagre e-post");
    } finally {
      setBusy(null);
    }
  }

  async function onResend() {
    setBusy("resend");
    setMsg(null);
    setMsgKind(null);
    try {
      const result = await postResend();
      setFeedback(
        result.ok ? "ok" : "fail",
        result.ok
          ? `Billett sendt til ${result.email}`
          : `Sending til ${result.email} feilet — billettene er uendret`
      );
      router.refresh();
    } catch (e) {
      setFeedback("fail", e instanceof Error ? e.message : "Kunne ikke sende e-post");
    } finally {
      setBusy(null);
    }
  }

  async function onSaveAndResend() {
    setBusy("both");
    setMsg(null);
    setMsgKind(null);
    try {
      const next = await patchEmail();
      if (!next) return;
      try {
        const result = await postResend();
        setFeedback(
          result.ok ? "ok" : "fail",
          result.ok
            ? `E-post lagret og billett sendt til ${result.email}`
            : `E-post lagret (${next}), men sending feilet — billettene er uendret`
        );
      } catch (e) {
        setFeedback(
          "fail",
          `E-post lagret (${next}), men sending feilet: ${
            e instanceof Error ? e.message : "ukjent feil"
          }`
        );
      }
      router.refresh();
    } catch (e) {
      setFeedback(
        "fail",
        e instanceof Error
          ? `Lagring feilet — e-post ble ikke sendt. ${e.message}`
          : "Lagring feilet — e-post ble ikke sendt"
      );
    } finally {
      setBusy(null);
    }
  }

  const dirty = normalizeEmail(email) !== normalizeEmail(savedEmail);
  const disabled = busy !== null;

  return (
    <section
      className="rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5"
      data-testid="order-customer-email-panel"
    >
      <h2 className="text-sm font-medium text-[color:var(--muted)]">Kunde & levering</h2>
      <p className="mt-2 text-sm text-[color:var(--muted)]">
        Nåværende e-post: <span className="text-foreground">{savedEmail}</span>
      </p>

      <div className="mt-4 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="admin-order-customer-email">E-post</Label>
          <Input
            id="admin-order-customer-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setTypoDismissed(null);
            }}
            disabled={disabled}
            data-testid="admin-order-customer-email"
          />
          {typoHint ? (
            <p className="text-sm text-amber-200" role="status" data-testid="admin-email-typo-hint">
              {typoHint.message}{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-amber-100"
                onClick={() => {
                  setEmail(typoHint.suggested);
                  setTypoDismissed(null);
                }}
              >
                Bruk forslag
              </button>
              <span className="text-[color:var(--muted)]"> · </span>
              <button
                type="button"
                className="text-[color:var(--muted)] underline underline-offset-2"
                onClick={() => setTypoDismissed(typoHint.original)}
              >
                Nei
              </button>
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || !dirty}
            onClick={onSave}
            data-testid="admin-order-save-email"
          >
            {busy === "save" ? "Lagrer…" : "Lagre e-post"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || !canResend}
            onClick={onResend}
            title={canResend ? undefined : "Kun betalte ordrer med aktive billetter"}
            data-testid="admin-order-resend-email"
          >
            {busy === "resend" ? "Sender…" : "Send billett på nytt"}
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={disabled || !canResend}
            onClick={onSaveAndResend}
            data-testid="admin-order-save-and-resend"
          >
            {busy === "both" ? "Lagrer og sender…" : "Lagre og send på nytt"}
          </Button>
        </div>

        {msg ? (
          <p
            className={`text-sm ${msgKind === "fail" ? "text-amber-200" : "text-[color:var(--muted)]"}`}
            data-testid="admin-order-email-feedback"
            role="status"
          >
            {msg}
          </p>
        ) : null}
      </div>
    </section>
  );
}
