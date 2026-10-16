"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney } from "@/lib/utils";

export function SalesCharts({
  salesPerDay,
}: {
  salesPerDay: { date: string; amount: number }[];
}) {
  const data = salesPerDay.map((d) => ({
    date: d.date.slice(5),
    amount: d.amount / 100,
  }));

  return (
    <div className="rounded-lg border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-4">
      <h2 className="mb-4 font-display text-lg font-semibold">Billettsalg over tid</h2>
      {data.length === 0 ? (
        <p className="text-sm text-[color:var(--muted)]">Ingen salgsdata ennå.</p>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#353438" />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: "#c7c5d0" }} />
              <YAxis tick={{ fontSize: 12, fill: "#c7c5d0" }} />
              <Tooltip
                formatter={(value) => formatMoney(Math.round(Number(value) * 100))}
                contentStyle={{
                  background: "#1f1f22",
                  border: "1px solid #5b4038",
                  borderRadius: 8,
                }}
              />
              <Bar dataKey="amount" fill="#ff5a1f" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
