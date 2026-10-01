import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@ticketly/database": path.resolve(__dirname, "../../packages/database/src"),
      "@ticketly/ticketing": path.resolve(__dirname, "../../packages/ticketing/src"),
      "@ticketly/shared-types": path.resolve(__dirname, "../../packages/shared-types/src"),
      "@ticketly/validation": path.resolve(__dirname, "../../packages/validation/src"),
      "@ticketly/auth": path.resolve(__dirname, "../../packages/auth/src"),
      "@ticketly/payments": path.resolve(__dirname, "../../packages/payments/src"),
    },
  },
});
