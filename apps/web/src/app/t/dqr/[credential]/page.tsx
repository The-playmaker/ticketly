import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ticketly Dynamic QR",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Public landing for dynamic QR URL form.
 * Does not mint, refresh, or disclose ticket status.
 */
export default async function PublicDynamicQrPage({
  params,
}: {
  params: Promise<{ credential: string }>;
}) {
  await params;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Ticketly</p>
      <h1 className="mt-3 font-display text-3xl text-zinc-900">Dynamisk billett-QR</h1>
      <p className="mt-3 text-sm text-zinc-600">
        Kortlivet QR for døren. Status verifiseres kun av innlogget scanner — denne siden
        godkjenner ikke inngang.
      </p>
    </main>
  );
}
