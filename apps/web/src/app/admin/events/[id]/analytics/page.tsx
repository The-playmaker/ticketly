import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireEventAccess } from "@/lib/admin/org-access";
import { formatMoney } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = { params: Promise<{ id: string }> };

export default async function EventAnalyticsPage({ params }: Props) {
  const { id } = await params;
  await auth();
  let event;
  try {
    ({ event } = await requireEventAccess(id));
  } catch {
    notFound();
  }

  const [pageViews, checkoutStarts, paymentInitiated, paidOrders, revenue, utmRows] =
    await Promise.all([
      prisma.analyticsEvent.count({ where: { eventId: id, type: "PAGE_VIEW" } }),
      prisma.analyticsEvent.count({ where: { eventId: id, type: "CHECKOUT_STARTED" } }),
      prisma.analyticsEvent.count({ where: { eventId: id, type: "PAYMENT_INITIATED" } }),
      prisma.order.count({
        where: {
          eventId: id,
          organizationId: event.organizationId,
          paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED"] },
        },
      }),
      prisma.order.aggregate({
        where: {
          eventId: id,
          organizationId: event.organizationId,
          paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED"] },
        },
        _sum: { total: true },
      }),
      prisma.order.groupBy({
        by: ["utmSource"],
        where: {
          eventId: id,
          organizationId: event.organizationId,
          paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED"] },
          utmSource: { not: null },
        },
        _count: true,
        _sum: { total: true },
      }),
    ]);

  const conversion =
    pageViews > 0 ? Math.round((paidOrders / pageViews) * 1000) / 10 : null;

  const cards = [
    { label: "Sidevisninger", value: String(pageViews) },
    { label: "Checkout startet", value: String(checkoutStarts) },
    { label: "Betaling startet", value: String(paymentInitiated) },
    { label: "Betalte ordrer", value: String(paidOrders) },
    {
      label: "Konvertering",
      value: conversion == null ? "Ikke tilgjengelig" : `${conversion}%`,
    },
    {
      label: "Omsetning",
      value: formatMoney(revenue._sum.total ?? 0),
    },
  ];

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-500">
        Kun ekte data. Tomme tall betyr ingen tracking ennå — ikke mock-verdier.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label} className="border-zinc-200 bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-500">{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-medium text-zinc-500">Trafikk / UTM (betalte ordrer)</h2>
        {utmRows.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">NOT YET AVAILABLE — ingen UTM på betalte ordrer</p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-2">utm_source</th>
                <th className="py-2">Ordrer</th>
                <th className="py-2">Omsetning</th>
              </tr>
            </thead>
            <tbody>
              {utmRows.map((r) => (
                <tr key={r.utmSource ?? "null"} className="border-t border-zinc-100">
                  <td className="py-2">{r.utmSource ?? "—"}</td>
                  <td className="py-2">{r._count}</td>
                  <td className="py-2">{formatMoney(r._sum.total ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
