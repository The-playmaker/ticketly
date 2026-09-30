import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export async function writeAuditLog(input: {
  actorId?: string | null;
  organizationId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
}) {
  return prisma.auditLog.create({
    data: {
      actorId: input.actorId ?? undefined,
      organizationId: input.organizationId ?? undefined,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? undefined,
      metadata: input.metadata,
      ipAddress: input.ipAddress ?? undefined,
    },
  });
}
