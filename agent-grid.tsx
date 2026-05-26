"use client";

import { timeAgo } from "@/lib/supabase";

const AGENTS = [
  { id: "01", name: "Prospect harvester", cron: "Every 30 min",  color: "#0F6E56" },
  { id: "02", name: "Lead profiler",      cron: "Event-driven",  color: "#534AB7" },
  { id: "03", name: "Outreach gen",       cron: "Event-driven",  color: "#BA7517" },
  { id: "04", name: "Follow-up seq",      cron: "Daily 8am",     color: "#185FA5" },
  { id: "05", name: "Response handler",   cron: "Event-driven",  color: "#3B6D11" },
  { id: "06", name: "Content engine",     cron: "Monday 9am",    color: "#993556" },
  { id: "07", name: "Metrics analyst",    cron: "Friday 5pm",    color: "#993C1D" },
  { id: "08", name: "Retention agent",    cron: "1st of month",  color: "#0C447C" },
];

interface Props {
  harvestLogs: any[];
}

export function AgentGrid({ harvestLogs }: Props) {
  const lastHarvest = harvestLogs[0];

  return (
    <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4">
      <p className="text-xs text-zinc-400 font-mono uppercase tracking-wider mb-3">Agent status</p>
      <div className="space-y-1.5">
        {AGENTS.map(agent => {
          const isActive = agent.id === "01";
          const lastRun  = isActive && lastHarvest ? timeAgo(lastHarvest.run_at) : null;
          const inserted = isActive && lastHarvest ? lastHarvest.leads_inserted : null;

          return (
            <div
              key={agent.id}
              className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-zinc-800/40 transition-colors"
            >
              <div
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: agent.color }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-300 truncate">{agent.id} · {agent.name}</p>
                <p className="text-[10px] text-zinc-600 font-mono">{agent.cron}</p>
              </div>
              <div className="text-right shrink-0">
                {lastRun && (
                  <p className="text-[10px] text-zinc-500 font-mono">{lastRun}</p>
                )}
                {inserted !== null && (
                  <p className="text-[10px] font-mono" style={{ color: agent.color }}>
                    +{inserted} leads
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 pt-3 border-t border-zinc-800/60">
        <p className="text-[10px] text-zinc-600 font-mono">
          All agents running on Trigger.dev · auto-deploying from GitHub
        </p>
      </div>
    </div>
  );
}
