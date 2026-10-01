import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";

/**
 * Optional standalone API host.
 * Primary HTTP API currently lives in apps/web (Next.js route handlers)
 * so mobile/web share one process in Docker Compose.
 * This app exists to make a future split trivial — same packages.
 */
const app = new Hono();

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "@ticketly/api",
    note: "Use apps/web API routes for production traffic in v1",
  })
);

const port = Number(process.env.API_PORT ?? 3460);
serve({ fetch: app.fetch, port });
console.log(`@ticketly/api listening on :${port}`);
