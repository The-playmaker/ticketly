"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SetPasswordForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const token = sp.get("token") ?? "";
  const inviteToken = sp.get("invite") ?? undefined;
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!token) {
      setInvalid(true);
      return;
    }
    fetch(`/api/auth/set-password?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          setInvalid(true);
          return;
        }
        const data = (await res.json()) as { email?: string };
        setEmail(data.email ?? null);
      })
      .catch(() => setInvalid(true));
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError("Passordet må være minst 12 tegn");
      return;
    }
    if (password !== confirm) {
      setError("Passordene er ikke like");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/auth/set-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        password,
        inviteToken,
        name: name.trim() || undefined,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: string | { message?: string };
      };
      const msg =
        typeof data.error === "string"
          ? data.error
          : data.error?.message ?? "Kunne ikke sette passord";
      setError(msg);
      return;
    }
    router.push("/login");
  }

  if (invalid) {
    return (
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <h1 className="text-xl font-semibold">Ugyldig lenke</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Lenken er ugyldig, brukt eller utløpt. Be om en ny invitasjon eller
          tilbakestilling.
        </p>
        <Link href="/forgot-password" className="mt-4 inline-block text-sm underline">
          Glemt passord
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
      <Link href="/login" className="font-display text-2xl">
        Ticket<span className="text-amber-400">ly</span>
      </Link>
      <h1 className="mt-4 text-xl font-semibold">Sett passord</h1>
      <p className="mt-1 text-sm text-zinc-400">
        {email ? `Konto: ${email}` : "Velg et sterkt passord (minst 12 tegn)."}
      </p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        {inviteToken ? (
          <div>
            <Label htmlFor="name">Navn</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        ) : null}
        <div>
          <Label htmlFor="password">Nytt passord</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
          />
        </div>
        <div>
          <Label htmlFor="confirm">Bekreft passord</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={12}
          />
        </div>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <Button className="w-full" type="submit" disabled={loading || !token}>
          {loading ? "Lagrer…" : "Lagre passord"}
        </Button>
      </form>
    </div>
  );
}

export default function SetPasswordPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <Suspense fallback={<p className="text-sm text-zinc-400">Laster…</p>}>
        <SetPasswordForm />
      </Suspense>
    </div>
  );
}
