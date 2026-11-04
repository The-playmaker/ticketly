import type { Metadata } from "next";
import { Geist_Mono, Space_Grotesk, Inter } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

// Inter and Space Grotesk are variable fonts: omitting `weight` ships ONE variable
// file per family instead of four static weight files (fewer font requests/bytes).
// Mono is only used for order numbers/codes, so don't preload it on every page.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});
const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});
const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Ticketly – Billettsalg for events",
    template: "%s · Ticketly",
  },
  description:
    "Produksjonsklar billettsalgsplattform for arrangementer, konserter og nattklubber.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="nb" className="dark">
      <body
        className={`${geistMono.variable} ${spaceGrotesk.variable} ${inter.variable} min-h-screen bg-background font-body text-foreground antialiased`}
      >
        {children}
        <Toaster theme="dark" richColors position="top-center" />
      </body>
    </html>
  );
}
