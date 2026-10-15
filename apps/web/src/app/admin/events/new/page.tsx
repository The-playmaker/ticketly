import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CreateEventWizard } from "@/components/admin/create-event-wizard";

export default async function NewEventPage() {
  const session = await auth();
  let orgId: string | null = null;
  if (session!.user.globalRole === "SUPER_ADMIN") {
    orgId = (await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } }))?.id ?? null;
  } else {
    orgId =
      (
        await prisma.organizationMember.findFirst({
          where: { userId: session!.user.id, isActive: true },
        })
      )?.organizationId ?? null;
  }

  if (!orgId) {
    return <p className="text-sm text-zinc-600">Ingen organisasjon tilknyttet kontoen.</p>;
  }

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nytt arrangement</h1>
        <p className="text-sm text-zinc-500">
          Opprett og åpne salg på under 5 minutter · {org.name}
        </p>
      </div>
      <CreateEventWizard
        organizationId={orgId}
        defaultServiceFee={org.defaultServiceFee}
        currency={org.defaultCurrency}
      />
    </div>
  );
}
