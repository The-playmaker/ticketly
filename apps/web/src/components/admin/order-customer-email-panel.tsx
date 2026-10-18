"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

  function setFeedback(kind: MsgKind, text: string) {
    setMsgKind(kind);
    setMsg(text);
  }

  async function patchEmail(): Promise<string | null> {
    const res = await fetch(`/api/admin/orders/${orderNumber}/customer-email`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    const data = (await res.json().catch(() => null)) as {
      email?: string;
      unchanged?: boolean;
      error?: { message?: string };
    } | null;
    if (!res.ok) {
      throw new Error(data?.error?.message ?? "Kunne ikke lagre e-post");
    }
    const next = data?.email ?? email.trim();
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

  const dirty = email.trim().toLowerCase() !== savedEmail.toLowerCase();
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
            onChange={(e) => setEmail(e.target.value)}
            disabled={disabled}
            data-testid="admin-order-customer-email"
          />
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
