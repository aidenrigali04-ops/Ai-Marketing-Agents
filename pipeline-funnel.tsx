"use client";

import { STATUS_LABELS } from "@/lib/supabase";

const STATUS_COLORS: Record<string, string> = {
  pending_profile: "#52525b",
  profiled:        "#3b82f6",
  outreach_ready:  "#a855f7",
  in_sequence:     "#f59e0b",
  replied:         "#14b8a6",
  demo_booked:     "#22c55e",
  closed_won:      "#16a34a",
};

interface Props {
  statusCounts: Record<string, number>;
  statusOrder:  string[];
  total:        number;
}

export function PipelineFunnel({ statusCounts, statusOrder, total }: Props) {
  const maxCount = Math.max(...statusOrder.map(s => statusCounts[s] ?? 0), 1);

  return (
    <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4">
      <p className="text-xs text-zinc-400 font-mono uppercase tracking-wider mb-4">Pipeline funnel</p>
      <div className="space-y-2">
        {statusOrder.map(status => {
          const count = statusCounts[status] ?? 0;
          const pct   = total > 0 ? (count / total * 100).toFixed(1) : "0";
          const barPct = maxCount > 0 ? (count / maxCount * 100) : 0;
          const color = STATUS_COLORS[status] ?? "#52525b";
          return (
            <div key={status} className="flex items-center gap-3">
              <span className="text-[11px] text-zinc-500 w-28 shrink-0 truncate font-mono">
                {STATUS_LABELS[status] ?? status}
              </span>
              <div className="flex-1 h-5 bg-zinc-800 rounded-sm overflow-hidden">
                <div
                  className="h-full rounded-sm transition-all duration-500 flex items-center px-2"
                  style={{ width: `${Math.max(barPct, 2)}%`, background: color + "40", borderLeft: `2px solid ${color}` }}
                >
                  {count > 0 && (
                    <span className="text-[10px] font-medium" style={{ color }}>
                      {count}
                    </span>
                  )}
                </div>
              </div>
              <span className="text-[11px] text-zinc-600 font-mono w-10 text-right shrink-0">
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
