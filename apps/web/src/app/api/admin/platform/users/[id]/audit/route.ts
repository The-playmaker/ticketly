import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin/org-access";
import { UserAdminService } from "@/services/user-admin-service";
import { jsonError } from "@/lib/api-error";

type Props = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Props) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const logs = await UserAdminService.listAuditForUser(id);
    return NextResponse.json({ logs });
  } catch (e) {
    return jsonError(e);
  }
}
