import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin, requireAdminSession, resolveOrgIdForUser } from "@/lib/admin/org-access";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/api-error";
import { slugify } from "@/lib/utils";
import { writeAuditLog } from "@/lib/audit";
import { canManageOrganization, isSuperAdmin } from "@/lib/auth/rbac";
import { GlobalRole, OrgRole } from "@prisma/client";

const sellerSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(80).optional(),
  legalName: z.string().min(1).max(200),
  organizationNumber: z.string().min(5).max(30),
  legalAddress: z.string().min(1).max(300),
  legalPostalCode: z.string().min(2).max(20),
  legalCity: z.string().min(1).max(100),
  legalCountry: z.string().min(2).max(2).default("NO"),
  customerServiceEmail: z.string().email(),
  customerServicePhone: z.string().max(40).optional(),
  contactEmail: z.string().email().optional(),
  vatRegistrationStatus: z
    .enum(["UNKNOWN", "REGISTERED", "NOT_REGISTERED", "EXEMPT"])
    .optional(),
  termsVersion: z.string().min(1).optional(),
  refundPolicyText: z.string().min(1).optional(),
  displayName: z.string().max(200).optional(),
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
    const body = sellerSchema.parse(await req.json());
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
        contactEmail: body.contactEmail ?? body.customerServiceEmail,
        vatRegistrationStatus: body.vatRegistrationStatus ?? "UNKNOWN",
        termsVersion: body.termsVersion ?? "1.0",
        refundPolicyText: body.refundPolicyText,
      },
    });

    // Make creator org admin member as well if they are not only platform-level
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

const patchSchema = sellerSchema.partial().extend({
  organizationId: z.string().min(1),
});

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

    const { organizationId, displayName, ...rest } = body;
    const org = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...rest,
        ...(displayName != null ? { name: displayName } : {}),
      },
    });

    await writeAuditLog({
      actorId: user.id,
      organizationId,
      action: "ORG_SELLER_UPDATED",
      entityType: "Organization",
      entityId: organizationId,
      metadata: rest,
    });

    return NextResponse.json(org);
  } catch (e) {
    return jsonError(e);
  }
}
