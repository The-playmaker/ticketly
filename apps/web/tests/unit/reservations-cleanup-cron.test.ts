import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/reservation-service", () => ({
  ReservationService: {
    repairEvent: vi.fn(),
    cleanupStaleReservations: vi.fn(),
  },
}));

import { ReservationService } from "@/services/reservation-service";
import { GET, POST } from "@/app/api/cron/reservations-cleanup/route";

describe("POST /api/cron/reservations-cleanup", () => {
  const prevSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-cron-secret";
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevSecret;
  });

  it("rejects missing bearer token", async () => {
    const res = await POST(
      new Request("http://localhost/api/cron/reservations-cleanup", { method: "POST" })
    );
    expect(res.status).toBe(401);
  });

  it("rejects wrong bearer token", async () => {
    const res = await POST(
      new Request("http://localhost/api/cron/reservations-cleanup", {
        method: "POST",
        headers: { Authorization: "Bearer wrong" },
      })
    );
    expect(res.status).toBe(401);
  });

  it("applies repair for a single event", async () => {
    vi.mocked(ReservationService.repairEvent).mockResolvedValue({
      eventId: "evt_1",
      dryRun: false,
      now: new Date().toISOString(),
      graceMinutes: 15,
      expiredCount: 2,
      applied: true,
      types: [
        {
          ticketTypeId: "tt_1",
          name: "Ordinær",
          quantityReleased: 50,
          quantitySold: 40,
          currentQuantityReserved: 5,
          activeTotal: 2,
          activeUnexpiredTotal: 0,
          expiredActiveQuantity: 2,
          expiredActiveCount: 2,
          proposedQuantityReserved: 0,
          delta: -5,
          availableBefore: 5,
          availableAfter: 10,
        },
      ],
    });

    const res = await POST(
      new Request("http://localhost/api/cron/reservations-cleanup?event=evt_1", {
        method: "POST",
        headers: { Authorization: "Bearer test-cron-secret" },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dryRun).toBe(false);
    expect(body.events[0].eventId).toBe("evt_1");
    expect(body.events[0].expiredCount).toBe(2);
    expect(ReservationService.repairEvent).toHaveBeenCalledWith({
      eventId: "evt_1",
      apply: true,
    });
  });

  it("runs batch cleanup without event id", async () => {
    vi.mocked(ReservationService.cleanupStaleReservations).mockResolvedValue({
      events: [],
      skipped: 0,
    });

    const res = await GET(
      new Request("http://localhost/api/cron/reservations-cleanup", {
        method: "GET",
        headers: { Authorization: "Bearer test-cron-secret" },
      })
    );
    expect(res.status).toBe(200);
    expect(ReservationService.cleanupStaleReservations).toHaveBeenCalledWith({
      force: true,
      limit: 50,
    });
  });

  it("dry-run requires event", async () => {
    const res = await GET(
      new Request("http://localhost/api/cron/reservations-cleanup?dryRun=1", {
        headers: { Authorization: "Bearer test-cron-secret" },
      })
    );
    expect(res.status).toBe(400);
  });
});
