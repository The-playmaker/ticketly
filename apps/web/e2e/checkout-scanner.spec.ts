import { test, expect } from "@playwright/test";

/**
 * E2E smoke scenarios. Requires:
 * - `npm run db:seed`
 * - web server on PLAYWRIGHT_BASE_URL (default http://localhost:3456)
 * - STRIPE_MOCK_MODE=true
 *
 * Run: npx playwright test -c playwright.config.ts
 */

test.describe("Scenario A — public event browse", () => {
  test("event page loads and shows ticket types", async ({ page }) => {
    await page.goto("/events/friday-night");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/VIP|Ordinær|Early Bird/i).first()).toBeVisible();
  });
});

test.describe("Scenario B — staff login page", () => {
  test("login form is available", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel(/e-post|email/i).or(page.locator('input[type="email"]'))).toBeVisible();
  });
});

test.describe("Scenario C — health endpoints", () => {
  test("health and ready", async ({ request }) => {
    const health = await request.get("/api/health");
    expect(health.ok()).toBeTruthy();
    const ready = await request.get("/api/ready");
    expect(ready.ok()).toBeTruthy();
  });
});

test.describe("Scenario D — order page without access token hides QR", () => {
  test("seed order page does not expose QR without t=", async ({ page }) => {
    // Seed creates TKT-2026-000001 — without access token, QR section gated
    await page.goto("/orders/TKT-2026-000001");
    const body = await page.textContent("body");
    expect(body).toBeTruthy();
    // Must not render raw verify URLs without auth/token
    expect(body!).not.toMatch(/\/t\/verify\/[A-Za-z0-9_-]{20,}/);
  });
});
