import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Syne, DM_Sans } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const syne = Syne({ variable: "--font-display", subsets: ["latin"], weight: ["500", "600", "700", "800"] });
const dmSans = DM_Sans({ variable: "--font-body", subsets: ["latin"], weight: ["400", "500", "600", "700"] });

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
        className={`${geistSans.variable} ${geistMono.variable} ${syne.variable} ${dmSans.variable} min-h-screen bg-zinc-950 font-body text-zinc-100 antialiased`}
      >
        {children}
        <Toaster theme="dark" richColors position="top-center" />
      </body>
    </html>
  );
}
