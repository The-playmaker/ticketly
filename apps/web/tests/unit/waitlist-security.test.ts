import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventStatus } from "@prisma/client";
import { AppError } from "@/lib/api-error";
import { readFileSync } from "fs";
import path from "path";

const findUnique = vi.fn();
const findFirst = vi.fn();
const create = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    event: { findUnique: (...a: unknown[]) => findUnique(...a) },
    ticketType: { findFirst: (...a: unknown[]) => findFirst(...a) },
    waitlistEntry: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      create: (...a: unknown[]) => create(...a),
    },
  },
}));

import { WaitlistService } from "@/services/waitlist-service";

describe("WaitlistService.join security", () => {
  beforeEach(() => {
    findUnique.mockReset();
    findFirst.mockReset();
    create.mockReset();
  });

  it("returns 404 for unknown event", async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      WaitlistService.join({
        eventId: "missing",
        email: "a@example.com",
        requestedQuantity: 1,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 } satisfies Partial<AppError>);
  });

  it("returns 404 for HIDDEN / non-published events", async () => {
    findUnique.mockResolvedValue({
      id: "e1",
      waitlistEnabled: true,
      visibility: "HIDDEN",
      status: EventStatus.PUBLISHED,
    });
    await expect(
      WaitlistService.join({ eventId: "e1", email: "a@example.com" })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("rejects ticketTypeId that does not belong to the event", async () => {
    findUnique.mockResolvedValue({
      id: "e1",
      waitlistEnabled: true,
      visibility: "PUBLIC",
      status: EventStatus.PUBLISHED,
    });
    findFirst.mockResolvedValueOnce(null); // ticket type
    await expect(
      WaitlistService.join({
        eventId: "e1",
        ticketTypeId: "tt-other",
        email: "a@example.com",
      })
    ).rejects.toMatchObject({ code: "TICKET_TYPE_NOT_FOUND", status: 404 });
  });

  it("route validates qty 1–20 and rate-limits (source)", () => {
    const route = readFileSync(
      path.resolve(__dirname, "../../src/app/api/waitlist/route.ts"),
      "utf8"
    );
    expect(route).toContain("requestedQuantity");
    expect(route).toContain(".max(20)");
    expect(route).toContain("rateLimitAsync");
    expect(route).toContain("waitlist:email:");
    expect(route).toContain("waitlist:ip:");

    const admin = readFileSync(
      path.resolve(__dirname, "../../src/app/api/admin/events/[id]/waitlist/route.ts"),
      "utf8"
    );
    expect(admin).toContain('NOT_FOUND');
    expect(admin).not.toContain("findUniqueOrThrow");
  });
});
