"use client";

import { useCallback, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { Button } from "@/components/ui/button";
import { withCoverCacheBust } from "@/lib/media/cover-url";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

type Props = {
  eventId: string;
  coverImageUrl: string | null;
  updatedAt?: string | Date | null;
  onChange: (url: string | null, updatedAt?: string) => void;
};

export function CoverImageUploader({ eventId, coverImageUrl, updatedAt, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const displayUrl = preview ?? withCoverCacheBust(coverImageUrl, updatedAt);

  const revokePreview = useCallback(() => {
    setPreview((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  function validateLocal(file: File): string | null {
    if (file.size > MAX_BYTES) {
      return "Bildet er for stort. Maksimal størrelse er 10 MB.";
    }
    const type = file.type.toLowerCase();
    if (type && !["image/jpeg", "image/png", "image/webp"].includes(type)) {
      return "Ugyldig bildeformat. Kun JPG, PNG og WebP er tillatt.";
    }
    return null;
  }

  function selectFile(file: File | null) {
    setError(null);
    setMsg(null);
    if (!file) return;
    const err = validateLocal(file);
    if (err) {
      setError(err);
      return;
    }
    revokePreview();
    setPendingFile(file);
    setPreview(URL.createObjectURL(file));
  }

  async function uploadViaServer(file: File) {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/admin/events/${eventId}/cover`, {
      method: "POST",
      body: form,
    });
    const data = (await res.json().catch(() => null)) as {
      coverImageUrl?: string | null;
      updatedAt?: string;
      error?: { message?: string };
    } | null;
    if (!res.ok) {
      throw new Error(data?.error?.message ?? "Kunne ikke laste opp bildet");
    }
    return data!;
  }

  async function uploadViaClientToken(file: File) {
    const pathRes = await fetch(`/api/admin/events/${eventId}/cover/upload-token`);
    if (!pathRes.ok) {
      // Fall back to server upload if token endpoint unavailable
      return uploadViaServer(file);
    }
    const { pathname } = (await pathRes.json()) as { pathname: string };

    const blob = await upload(pathname, file, {
      access: "public",
      handleUploadUrl: `/api/admin/events/${eventId}/cover/upload-token`,
      contentType: file.type || undefined,
    });

    const res = await fetch(`/api/admin/events/${eventId}/cover`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: blob.url }),
    });
    const data = (await res.json().catch(() => null)) as {
      coverImageUrl?: string | null;
      updatedAt?: string;
      error?: { message?: string };
    } | null;
    if (!res.ok) {
      throw new Error(data?.error?.message ?? "Kunne ikke lagre cover-bildet");
    }
    return data!;
  }

  async function saveUpload() {
    if (!pendingFile) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      // Prefer client token for large files; fall back to server POST.
      const data =
        pendingFile.size > 3.5 * 1024 * 1024
          ? await uploadViaClientToken(pendingFile)
          : await uploadViaServer(pendingFile);
      revokePreview();
      setPendingFile(null);
      onChange(data.coverImageUrl ?? null, data.updatedAt);
      setMsg("Cover-bilde lagret");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opplasting feilet. Prøv igjen.");
    } finally {
      setBusy(false);
    }
  }

  async function removeCover() {
    if (!coverImageUrl && !pendingFile) return;
    if (pendingFile) {
      revokePreview();
      setPendingFile(null);
      setMsg(null);
      return;
    }
    if (!window.confirm("Fjerne cover-bildet? Dette kan ikke angres uten ny opplasting.")) {
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/cover`, { method: "DELETE" });
      const data = (await res.json().catch(() => null)) as {
        updatedAt?: string;
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Kunne ikke fjerne bildet");
      }
      onChange(null, data?.updatedAt);
      setMsg("Cover-bilde fjernet");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kunne ikke fjerne bildet");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="space-y-3 rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5"
      data-testid="cover-image-uploader"
    >
      <div>
        <h2 className="font-medium">Cover-bilde</h2>
        <p className="mt-1 text-xs text-[color:var(--muted)]">
          Anbefalt 1920×1080 (16:9). JPG, PNG eller WebP — maks 10 MB. Forhåndsvis før du lagrer.
        </p>
      </div>

      <div
        className={`relative aspect-video overflow-hidden rounded-lg border border-dashed ${
          dragOver
            ? "border-[color:var(--accent)] bg-[color:var(--accent)]/10"
            : "border-[color:var(--outline)]/40 bg-[color:var(--surface-high)]"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0] ?? null;
          selectFile(file);
        }}
      >
        {displayUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob: preview + external blob hosts
          <img
            src={displayUrl}
            alt="Cover forhåndsvisning"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-[color:var(--muted)]">
            <p>Dra og slipp bilde her, eller velg fra enheten</p>
            <p className="text-xs">Sosialt bilde: 1200×630</p>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        data-testid="cover-file-input"
        onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {coverImageUrl || pendingFile ? "Bytt bilde" : "Last opp bilde"}
        </Button>
        {pendingFile ? (
          <Button type="button" disabled={busy} onClick={() => void saveUpload()}>
            {busy ? "Laster opp…" : "Lagre cover"}
          </Button>
        ) : null}
        {coverImageUrl || pendingFile ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void removeCover()}>
            Fjern
          </Button>
        ) : null}
      </div>

      {pendingFile ? (
        <p className="text-xs text-[color:var(--warning)]">
          Forhåndsvisning — trykk «Lagre cover» for å laste opp.
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-[color:var(--destructive)]" role="alert">
          {error}
        </p>
      ) : null}
      {msg ? <p className="text-xs text-[color:var(--muted)]">{msg}</p> : null}
    </section>
  );
}
