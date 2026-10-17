import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ticketly QR",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Public landing for static QR URLs.
 * Intentionally does NOT reveal ticket validity, holder, or approve entry.
 * Door admission is staff-only via authenticated scanner APIs.
 */
export default async function PublicQrVerifyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await params; // consume — never echo token into HTML/logs
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Ticketly</p>
      <h1 className="mt-3 font-display text-3xl text-zinc-900">Billett-QR</h1>
      <p className="mt-3 text-sm text-zinc-600">
        Denne koden er ment for døren. Vis den til arrangementets scanner — gyldighet avgjøres
        kun av innlogget staff, ikke av denne siden.
      </p>
    </main>
  );
}
