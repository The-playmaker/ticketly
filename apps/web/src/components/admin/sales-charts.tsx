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
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <h2 className="mb-4 text-lg font-semibold">Salg per dag</h2>
      {data.length === 0 ? (
        <p className="text-sm text-zinc-500">Ingen salgsdata ennå.</p>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(value) => formatMoney(Math.round(Number(value) * 100))}
              />
              <Bar dataKey="amount" fill="#d97706" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
