import { NextResponse } from "next/server";
import { GlobalRole } from "@prisma/client";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/admin/org-access";
import { UserAdminService } from "@/services/user-admin-service";
import { jsonError } from "@/lib/api-error";
import { clientIp } from "@/lib/security/rate-limit";

export async function GET(req: Request) {
  try {
    await requireSuperAdmin();
    const url = new URL(req.url);
    const q = url.searchParams.get("q") ?? undefined;
    const status = (url.searchParams.get("status") ?? "ALL") as
      | "ALL"
      | "ACTIVE"
      | "INVITED"
      | "DISABLED";
    const role = (url.searchParams.get("role") ?? "ALL") as GlobalRole | "ALL";
    const users = await UserAdminService.listPlatformUsers({ q, status, role });
    return NextResponse.json({ users });
  } catch (e) {
    return jsonError(e);
  }
}

const patchSchema = z.object({
  userId: z.string().min(1),
  action: z.enum(["enable", "disable", "set_role", "send_reset"]),
  globalRole: z.enum(["SUPER_ADMIN", "CUSTOMER"]).optional(),
});

export async function PATCH(req: Request) {
  try {
    const { user: actor } = await requireSuperAdmin();
    const body = patchSchema.parse(await req.json());
    const ip = clientIp(req);

    switch (body.action) {
      case "enable":
        return NextResponse.json(
          await UserAdminService.setUserActive({
            actorId: actor.id,
            targetUserId: body.userId,
            isActive: true,
            ipAddress: ip,
          })
        );
      case "disable":
        return NextResponse.json(
          await UserAdminService.setUserActive({
            actorId: actor.id,
            targetUserId: body.userId,
            isActive: false,
            ipAddress: ip,
          })
        );
      case "set_role": {
        if (!body.globalRole) {
          return NextResponse.json({ error: "globalRole required" }, { status: 400 });
        }
        return NextResponse.json(
          await UserAdminService.setGlobalRole({
            actorId: actor.id,
            targetUserId: body.userId,
            globalRole: body.globalRole as GlobalRole,
            ipAddress: ip,
          })
        );
      }
      case "send_reset": {
        const target = await UserAdminService.listPlatformUsers({ take: 200 });
        const found = target.find((u) => u.id === body.userId);
        if (!found) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        await UserAdminService.sendPasswordReset({
          actorId: actor.id,
          email: found.email,
          ipAddress: ip,
        });
        return NextResponse.json({
          message: "Hvis kontoen finnes, har vi sendt instruksjoner.",
        });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return jsonError(e);
  }
}
