import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
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
            "default-src 'self'; img-src 'self' data: blob: https://images.unsplash.com; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.stripe.com; frame-src https://js.stripe.com https://hooks.stripe.com; media-src 'self' blob:;",
        },
      ],
    },
  ],
};

export default nextConfig;
