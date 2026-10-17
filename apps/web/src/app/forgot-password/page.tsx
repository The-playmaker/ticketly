"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = (await res.json()) as { message?: string };
    setMessage(data.message ?? "Hvis kontoen finnes, har vi sendt instruksjoner.");
    setLoading(false);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <Link href="/login" className="font-display text-2xl">
          Ticket<span className="text-amber-400">ly</span>
        </Link>
        <h1 className="mt-4 text-xl font-semibold">Glemt passord</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Oppgi e-postadressen din. Vi sender instruksjoner hvis kontoen finnes.
        </p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="email">E-post</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          {message ? <p className="text-sm text-emerald-400">{message}</p> : null}
          <Button className="w-full" type="submit" disabled={loading}>
            {loading ? "Sender…" : "Send instruksjoner"}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-zinc-500">
          <Link href="/login" className="underline hover:text-zinc-300">
            Tilbake til innlogging
          </Link>
        </p>
      </div>
    </div>
  );
}
