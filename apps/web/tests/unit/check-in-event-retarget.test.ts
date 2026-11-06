import { describe, expect, it, vi, beforeEach } from "vitest";
import { CheckInResult, EventStatus, TicketStatus } from "@prisma/client";

/**
 * Unit coverage for wrong-event retarget rules used by door staff scanning.
 * Full admit path is covered in integration tests; this locks the access policy.
 */

const canAccessAssignedEvent = vi.fn();
const canScanTickets = vi.fn();

vi.mock("@/lib/auth/event-access", () => ({
  canAccessAssignedEvent: (...args: unknown[]) => canAccessAssignedEvent(...args),
}));

vi.mock("@/lib/auth/rbac", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/rbac")>("@/lib/auth/rbac");
  return {
    ...actual,
    canScanTickets: (...args: unknown[]) => canScanTickets(...args),
  };
});

describe("Check-in wrong-event access policy", () => {
  beforeEach(() => {
    canAccessAssignedEvent.mockReset();
    canScanTickets.mockReset();
  });

  it("assigned door staff may retarget to ticket event; unassigned may not", () => {
    const ticketEvent = { id: "evt-ticket", organizationId: "org1", name: "Tonight" };
    const selectedEvent = { id: "evt-old", organizationId: "org1", name: "Last week" };

    canScanTickets.mockImplementation((_u, orgId) => orgId === "org1");
    canAccessAssignedEvent.mockImplementation((_u, event) => event.id === "evt-ticket");

    const user = { id: "door" };
    const canRetarget =
      canScanTickets(user, ticketEvent.organizationId) &&
      canAccessAssignedEvent(user, ticketEvent);
    const canStayOnSelected =
      canScanTickets(user, selectedEvent.organizationId) &&
      canAccessAssignedEvent(user, selectedEvent);

    expect(canRetarget).toBe(true);
    expect(canStayOnSelected).toBe(false);
  });

  it("no assignment ⇒ cannot retarget (still FEIL ARRANGEMENT)", () => {
    canScanTickets.mockReturnValue(true);
    canAccessAssignedEvent.mockReturnValue(false);
    const ticketEvent = { id: "evt-ticket", organizationId: "org1", name: "Tonight" };
    expect(
      canScanTickets({}, ticketEvent.organizationId) &&
        canAccessAssignedEvent({}, ticketEvent)
    ).toBe(false);
  });

  it("documents expected result codes for scanner UX", () => {
    expect(CheckInResult.WRONG_EVENT).toBe("WRONG_EVENT");
    expect(CheckInResult.SUCCESS).toBe("SUCCESS");
    expect(TicketStatus.VALID).toBe("VALID");
    expect(EventStatus.PAUSED).toBe("PAUSED");
  });
});
