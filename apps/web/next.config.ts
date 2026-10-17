import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: [
    "@ticketly/database",
    "@ticketly/shared-types",
    "@ticketly/validation",
    "@ticketly/auth",
    "@ticketly/ticketing",
    "@ticketly/payments",
    "@ticketly/notifications",
    "@ticketly/wallet",
    "@ticketly/ui",
  ],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
      { protocol: "https", hostname: "*.blob.vercel-storage.com" },
    ],
  },
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=()" },
        {
          key: "Content-Security-Policy",
          value:
            "default-src 'self'; img-src 'self' data: blob: https://images.unsplash.com https://*.public.blob.vercel-storage.com https://*.blob.vercel-storage.com https://*.stripe.com; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://*.js.stripe.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.stripe.com https://*.stripe.com https://*.public.blob.vercel-storage.com https://*.blob.vercel-storage.com https://vercel.com; frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com; media-src 'self' blob:;",
        },
      ],
    },
    // Access-token URLs and ticket credentials must not leak via Referer
    {
      source: "/orders/:path*",
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "private, no-store" },
      ],
    },
    {
      source: "/my/tickets",
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "private, no-store" },
      ],
    },
    {
      source: "/t/:path*",
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "private, no-store" },
      ],
    },
    {
      source: "/api/tickets/:path*",
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "private, no-store" },
      ],
    },
  ],
};

export default nextConfig;
