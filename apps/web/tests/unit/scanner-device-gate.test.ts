import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/api-error";
import { readFileSync } from "fs";
import path from "path";

const findUnique = vi.fn();
const update = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    device: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

import { assertDeviceNotRevoked } from "@/lib/auth/org-access";

describe("assertDeviceNotRevoked", () => {
  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
  });

  it("web scanner allows missing deviceId", async () => {
    await expect(assertDeviceNotRevoked(undefined)).resolves.toBeUndefined();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("mobile/offline requireRegistered rejects missing deviceId with 403", async () => {
    await expect(
      assertDeviceNotRevoked(null, { requireRegistered: true })
    ).rejects.toMatchObject({ code: "DEVICE_REQUIRED", status: 403 } satisfies Partial<AppError>);
  });

  it("requireRegistered rejects unknown deviceId with 403", async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      assertDeviceNotRevoked("dev-unknown", { requireRegistered: true })
    ).rejects.toMatchObject({ code: "DEVICE_UNKNOWN", status: 403 });
  });

  it("rejects revoked devices", async () => {
    findUnique.mockResolvedValue({ id: "dev-1", revokedAt: new Date() });
    await expect(assertDeviceNotRevoked("dev-1")).rejects.toMatchObject({
      code: "DEVICE_REVOKED",
      status: 403,
    });
  });

  it("offline routes require registered device (source)", () => {
    const bundle = readFileSync(
      path.resolve(__dirname, "../../src/app/api/scanner/offline/bundle/route.ts"),
      "utf8"
    );
    const sync = readFileSync(
      path.resolve(__dirname, "../../src/app/api/scanner/offline/sync/route.ts"),
      "utf8"
    );
    const checkIn = readFileSync(
      path.resolve(__dirname, "../../src/app/api/tickets/check-in/route.ts"),
      "utf8"
    );
    expect(bundle).toContain("requireRegistered: true");
    expect(sync).toContain("requireRegistered: true");
    expect(checkIn).toContain("viaMobileBearer");
    expect(checkIn).toContain("requireRegistered: user.viaMobileBearer");
  });
});
