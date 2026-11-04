import { afterAll, describe, expect, it } from "vitest";
import { withCoverCacheBust } from "@/lib/media/cover-url";
import { prisma } from "@/lib/db";
import { EventService } from "@/services/event-service";

describe("withCoverCacheBust", () => {
  it("produces the same URL for a Date and its JSON-serialized ISO string", () => {
    const d = new Date("2026-11-04T12:00:00.000Z");
    const url = "https://x.public.blob.vercel-storage.com/events/e1/cover.jpg";
    expect(withCoverCacheBust(url, d.toISOString())).toBe(withCoverCacheBust(url, d));
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("EventService.uniqueSlug", () => {
  const createdOrgIds: string[] = [];

  afterAll(async () => {
    await prisma.event.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  });

  it("keeps public slugs globally unique across organizations", async () => {
    const tag = `slugtest-${Date.now().toString(36)}`;
    const [a, b] = await Promise.all(
      ["a", "b"].map((s) =>
        prisma.organization.create({ data: { name: `${tag}-${s}`, slug: `${tag}-${s}` } })
      )
    );
    createdOrgIds.push(a!.id, b!.id);
    const base = {
      name: "Slug Test",
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: new Date(Date.now() + 90_000_000),
      capacity: 10,
    };
    const e1 = await EventService.create({
      ...base,
      organizationId: a!.id,
      sellerOrganizationId: a!.id,
      slug: tag,
    });
    const e2 = await EventService.create({
      ...base,
      organizationId: b!.id,
      sellerOrganizationId: b!.id,
      slug: tag,
    });
    expect(e1.slug).toBe(tag);
    expect(e2.slug).toBe(`${tag}-2`);
  });
});
