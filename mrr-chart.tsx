"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

const TARGET = 40000;

// Week-by-week ramp projection
const PROJECTION = [
  { week: "Start", mrr: 0 },
  { week: "Wk 2",  mrr: 2000 },
  { week: "Wk 4",  mrr: 8000 },
  { week: "Wk 6",  mrr: 15000 },
  { week: "Wk 8",  mrr: 22000 },
  { week: "Wk 10", mrr: 30000 },
  { week: "Wk 12", mrr: TARGET },
];

interface Props {
  currentMRR?: number;
}

export function MRRChart({ currentMRR = 0 }: Props) {
  return (
    <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-zinc-400 font-mono uppercase tracking-wider">12-week MRR ramp</p>
        <span className="text-xs text-teal-400 font-mono">target: $40k</span>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={PROJECTION} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis
            dataKey="week"
            tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip
            contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 6, fontSize: 12 }}
            labelStyle={{ color: "#a1a1aa" }}
            formatter={(v: number) => [`$${v.toLocaleString()}`, "MRR"]}
          />
          <ReferenceLine y={TARGET} stroke="#14b8a6" strokeDasharray="4 4" strokeOpacity={0.4} />
          <Line
            type="monotone"
            dataKey="mrr"
            stroke="#14b8a6"
            strokeWidth={2}
            dot={{ r: 3, fill: "#14b8a6", strokeWidth: 0 }}
            activeDot={{ r: 5, fill: "#14b8a6" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
