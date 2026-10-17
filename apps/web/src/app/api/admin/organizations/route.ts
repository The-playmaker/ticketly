import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin, requireAdminSession, resolveOrgIdForUser } from "@/lib/admin/org-access";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/api-error";
import { slugify } from "@/lib/utils";
import { writeAuditLog } from "@/lib/audit";
import { canManageOrganization, isSuperAdmin } from "@/lib/auth/rbac";
import { GlobalRole, OrgRole } from "@prisma/client";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(80).optional(),
  legalName: z.string().min(1).max(200),
  organizationNumber: z.string().min(5).max(30),
  legalAddress: z.string().min(1).max(300),
  legalPostalCode: z.string().min(2).max(20),
  legalCity: z.string().min(1).max(100),
  legalCountry: z.string().min(2).max(2).default("NO"),
  customerServiceEmail: z.string().email(),
  customerServicePhone: z.string().min(1).max(40),
  contactEmail: z.string().email(),
  website: z.string().url().max(300).optional().nullable(),
  vatRegistrationStatus: z.enum(["UNKNOWN", "REGISTERED", "NOT_REGISTERED", "EXEMPT"]),
  termsVersion: z.string().min(1).optional(),
  refundPolicyText: z.string().min(1),
  displayName: z.string().max(200).optional(),
});

const patchSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  slug: z.string().min(1).max(80).optional(),
  legalName: z.string().min(1).max(200).optional(),
  organizationNumber: z.string().min(5).max(30).optional(),
  legalAddress: z.string().min(1).max(300).optional(),
  legalPostalCode: z.string().min(2).max(20).optional(),
  legalCity: z.string().min(1).max(100).optional(),
  legalCountry: z.string().min(2).max(2).optional(),
  customerServiceEmail: z.string().email().optional(),
  customerServicePhone: z.string().max(40).optional().nullable(),
  contactEmail: z.string().email().optional(),
  website: z.string().url().max(300).optional().nullable(),
  vatRegistrationStatus: z
    .enum(["UNKNOWN", "REGISTERED", "NOT_REGISTERED", "EXEMPT"])
    .optional(),
  termsVersion: z.string().min(1).optional(),
  refundPolicyText: z.string().min(1).optional().nullable(),
  displayName: z.string().max(200).optional(),
  isActive: z.boolean().optional(),
});

export async function GET() {
  try {
    const session = await requireAdminSession();
    const user = {
      id: session.user.id,
      email: session.user.email!,
      globalRole: session.user.globalRole,
      isActive: session.user.isActive !== false,
      memberships: session.user.memberships,
    };
    if (isSuperAdmin(user)) {
      const orgs = await prisma.organization.findMany({ orderBy: { createdAt: "asc" } });
      return NextResponse.json({ organizations: orgs });
    }
    const orgId = await resolveOrgIdForUser(user.id, user.globalRole);
    if (!orgId) return NextResponse.json({ organizations: [] });
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    return NextResponse.json({ organizations: org ? [org] : [] });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireSuperAdmin();
    const body = createSchema.parse(await req.json());
    const slug = body.slug ?? slugify(body.name);
    const org = await prisma.organization.create({
      data: {
        name: body.displayName?.trim() || body.name,
        slug,
        legalName: body.legalName,
        organizationNumber: body.organizationNumber,
        legalAddress: body.legalAddress,
        legalPostalCode: body.legalPostalCode,
        legalCity: body.legalCity,
        legalCountry: body.legalCountry,
        customerServiceEmail: body.customerServiceEmail,
        customerServicePhone: body.customerServicePhone,
        contactEmail: body.contactEmail,
        website: body.website ?? null,
        vatRegistrationStatus: body.vatRegistrationStatus,
        termsVersion: body.termsVersion ?? "1.0",
        refundPolicyText: body.refundPolicyText,
      },
    });

    // Creator becomes ORGANIZER_ADMIN so team/settings membership checks succeed.
    await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
      update: { role: OrgRole.ORGANIZER_ADMIN, isActive: true },
      create: {
        organizationId: org.id,
        userId: user.id,
        role: OrgRole.ORGANIZER_ADMIN,
        isActive: true,
      },
    });

    await writeAuditLog({
      actorId: user.id,
      organizationId: org.id,
      action: "ORG_CREATED",
      entityType: "Organization",
      entityId: org.id,
      metadata: { name: org.name, legalName: org.legalName },
    });

    return NextResponse.json(org, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await requireAdminSession();
    const body = patchSchema.parse(await req.json());
    const user = {
      id: session.user.id,
      email: session.user.email!,
      globalRole: session.user.globalRole as GlobalRole,
      isActive: session.user.isActive !== false,
      memberships: session.user.memberships,
    };
    if (!canManageOrganization(user, body.organizationId) && !isSuperAdmin(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { organizationId, displayName, isActive, ...rest } = body;
    if (typeof isActive === "boolean" && !isSuperAdmin(user)) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Kun SUPER_ADMIN kan endre aktiv-status" } },
        { status: 403 }
      );
    }

    const data: Record<string, unknown> = { ...rest };
    if (displayName != null) data.name = displayName;
    if (typeof isActive === "boolean") data.isActive = isActive;

    for (const key of Object.keys(data)) {
      if (data[key] === undefined) delete data[key];
    }

    const org = await prisma.organization.update({
      where: { id: organizationId },
      data,
    });

    await writeAuditLog({
      actorId: user.id,
      organizationId,
      action: "ORG_SELLER_UPDATED",
      entityType: "Organization",
      entityId: organizationId,
      metadata: { ...rest, isActive },
    });

    return NextResponse.json(org);
  } catch (e) {
    return jsonError(e);
  }
}
