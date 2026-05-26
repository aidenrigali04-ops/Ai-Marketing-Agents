"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal } from "lucide-react";
import { useCallback } from "react";

const STATUSES = [
  "pending_profile", "profiled", "outreach_ready", "in_sequence",
  "replied", "demo_booked", "closed_won", "closed_lost", "unsubscribed",
];

const INDUSTRIES = [
  "hvac", "landscaping", "construction", "property_mgmt",
  "plumbing", "real_estate", "agency",
];

const SOURCES  = ["apollo", "clay", "vibe_prospecting", "manual", "csv"];
const DISC     = ["D", "I", "S", "C"];

const LABELS: Record<string, string> = {
  pending_profile: "Pending",   profiled: "Profiled",
  outreach_ready:  "Ready",     in_sequence: "In sequence",
  replied:         "Replied",   demo_booked: "Demo booked",
  closed_won:      "Won",       closed_lost: "Lost",
  unsubscribed:    "Unsub",     hvac: "HVAC",
  landscaping:     "Landscaping", construction: "Construction",
  property_mgmt:   "Prop mgmt", plumbing: "Plumbing",
  real_estate:     "Real estate", agency: "Agency",
  apollo:          "Apollo",    clay: "Clay",
  vibe_prospecting: "Vibe",     manual: "Manual",
  csv:             "CSV",
};

interface Props {
  currentParams: Record<string, string | undefined>;
}

export function LeadFilters({ currentParams }: Props) {
  const router = useRouter();
  const sp     = useSearchParams();

  const update = useCallback((key: string, value: string) => {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page"); // reset page on filter change
    router.push(`/leads?${params.toString()}`);
  }, [sp, router]);

  const clear = () => router.push("/leads");

  const hasFilters = !!(currentParams.status || currentParams.disc ||
    currentParams.industry || currentParams.source || currentParams.search || currentParams.min_score);

  return (
    <div className="px-4 py-2.5 border-b border-zinc-800/60 flex items-center gap-2 flex-wrap bg-zinc-900/50 shrink-0">
      {/* Search */}
      <div className="relative">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          type="text"
          placeholder="Search name, company..."
          defaultValue={currentParams.search ?? ""}
          onChange={e => update("search", e.target.value)}
          className="pl-7 pr-3 h-7 w-52 bg-zinc-800 border border-zinc-700/60 rounded text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500/50"
        />
      </div>

      {/* Status filter */}
      <select
        value={currentParams.status ?? ""}
        onChange={e => update("status", e.target.value)}
        className="h-7 px-2 bg-zinc-800 border border-zinc-700/60 rounded text-xs text-zinc-300 focus:outline-none focus:border-teal-500/50"
      >
        <option value="">All statuses</option>
        {STATUSES.map(s => <option key={s} value={s}>{LABELS[s] ?? s}</option>)}
      </select>

      {/* DISC filter */}
      <select
        value={currentParams.disc ?? ""}
        onChange={e => update("disc", e.target.value)}
        className="h-7 px-2 bg-zinc-800 border border-zinc-700/60 rounded text-xs text-zinc-300 focus:outline-none focus:border-teal-500/50"
      >
        <option value="">All DISC</option>
        {DISC.map(d => <option key={d} value={d}>{d}</option>)}
      </select>

      {/* Industry filter */}
      <select
        value={currentParams.industry ?? ""}
        onChange={e => update("industry", e.target.value)}
        className="h-7 px-2 bg-zinc-800 border border-zinc-700/60 rounded text-xs text-zinc-300 focus:outline-none focus:border-teal-500/50"
      >
        <option value="">All industries</option>
        {INDUSTRIES.map(i => <option key={i} value={i}>{LABELS[i] ?? i}</option>)}
      </select>

      {/* Source filter */}
      <select
        value={currentParams.source ?? ""}
        onChange={e => update("source", e.target.value)}
        className="h-7 px-2 bg-zinc-800 border border-zinc-700/60 rounded text-xs text-zinc-300 focus:outline-none focus:border-teal-500/50"
      >
        <option value="">All sources</option>
        {SOURCES.map(s => <option key={s} value={s}>{LABELS[s] ?? s}</option>)}
      </select>

      {/* Min score */}
      <select
        value={currentParams.min_score ?? ""}
        onChange={e => update("min_score", e.target.value)}
        className="h-7 px-2 bg-zinc-800 border border-zinc-700/60 rounded text-xs text-zinc-300 focus:outline-none focus:border-teal-500/50"
      >
        <option value="">Any score</option>
        <option value="40">≥ 40</option>
        <option value="60">≥ 60</option>
        <option value="75">≥ 75</option>
        <option value="90">≥ 90</option>
      </select>

      {/* Clear filters */}
      {hasFilters && (
        <button
          onClick={clear}
          className="h-7 px-2.5 text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700/60 rounded hover:bg-zinc-800 transition-colors"
        >
          Clear
        </button>
      )}

      <div className="ml-auto flex items-center gap-1.5 text-zinc-600">
        <SlidersHorizontal size={11} />
        <span className="text-[10px] font-mono">Filters</span>
      </div>
    </div>
  );
}
