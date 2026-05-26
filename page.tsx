import { createServiceClient, STATUS_LABELS, timeAgo } from "@/lib/supabase";
import { formatDistanceToNow } from "date-fns";
import {
  Users, Send, MessageCircle, Calendar,
  TrendingUp, Activity, AlertCircle, CheckCircle,
} from "lucide-react";
import { MRRChart } from "@/components/dashboard/mrr-chart";
import { AgentGrid } from "@/components/dashboard/agent-grid";
import { PipelineFunnel } from "@/components/dashboard/pipeline-funnel";

export const revalidate = 60; // refresh every 60s

async function getDashboardData() {
  const db = createServiceClient();
  const dayAgo  = new Date(Date.now() - 86400000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const [
    { data: leads },
    { data: todayLeads },
    { data: weekSteps },
    { data: weekReplies },
    { data: demos },
    { data: harvestLogs },
    { data: recentLeads },
  ] = await Promise.all([
    db.from("leads").select("id, status, score, industry, created_at"),
    db.from("leads").select("id", { count: "exact", head: true }).gte("created_at", dayAgo),
    db.from("sequence_steps").select("id, status", { count: "exact" }).eq("status", "sent").gte("sent_at", weekAgo),
    db.from("reply_log").select("reply_type, classified_at").gte("classified_at", weekAgo),
    db.from("leads").select("id", { count: "exact", head: true }).eq("status", "demo_booked"),
    db.from("harvest_log").select("*").order("run_at", { ascending: false }).limit(48),
    db.from("leads")
      .select("id, name, company, industry, status, score, disc, created_at, lead_profiles(disc)")
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  const statusCounts = (leads ?? []).reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = (acc[l.status] ?? 0) + 1;
    return acc;
  }, {});

  const totalLeads     = leads?.length ?? 0;
  const outreachSent   = weekSteps[1]?.count ?? weekSteps?.length ?? 0;
  const totalReplies   = weekReplies?.length ?? 0;
  const interested     = weekReplies?.filter(r => r.reply_type === "interested").length ?? 0;
  const replyRate      = outreachSent > 0 ? ((totalReplies / outreachSent) * 100).toFixed(1) : "0";
  const interestRate   = totalReplies > 0 ? ((interested / totalReplies) * 100).toFixed(1) : "0";
  const demosBooked    = demos?.[0]?.count ?? 0;

  return {
    statusCounts,
    totalLeads,
    outreachSent: typeof outreachSent === "number" ? outreachSent : weekSteps?.length ?? 0,
    replyRate,
    interestRate,
    demosBooked,
    harvestLogs: harvestLogs ?? [],
    recentLeads: recentLeads ?? [],
    todayLeads:  typeof todayLeads === "number" ? todayLeads : 0,
  };
}

export default async function Dashboard() {
  const {
    statusCounts, totalLeads, outreachSent,
    replyRate, interestRate, demosBooked,
    harvestLogs, recentLeads, todayLeads,
  } = await getDashboardData();

  const MRR_TARGET = 40000;
  const AVG_CONTRACT = 500;
  const closedWon = statusCounts["closed_won"] ?? 0;
  const currentMRR = closedWon * AVG_CONTRACT;
  const mrrPct = Math.min((currentMRR / MRR_TARGET) * 100, 100).toFixed(1);

  const KPIS = [
    { label: "Leads today",    value: todayLeads,   icon: Users,         color: "text-teal-400" },
    { label: "Outreach (7d)",  value: outreachSent, icon: Send,          color: "text-blue-400" },
    { label: "Reply rate",     value: `${replyRate}%`, icon: MessageCircle, color: "text-purple-400" },
    { label: "Interest rate",  value: `${interestRate}%`, icon: Activity, color: "text-amber-400" },
    { label: "Demos booked",   value: demosBooked,  icon: Calendar,      color: "text-green-400" },
    { label: "Closed won",     value: closedWon,    icon: CheckCircle,   color: "text-teal-400" },
  ];

  const STATUS_ORDER = [
    "pending_profile", "profiled", "outreach_ready",
    "in_sequence", "replied", "demo_booked", "closed_won",
  ];

  const industryBreakdown = recentLeads.reduce<Record<string, number>>((acc, l: any) => {
    if (l.industry) acc[l.industry] = (acc[l.industry] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-medium text-zinc-100">Command center</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {totalLeads.toLocaleString()} total leads · {closedWon} closed won · ${currentMRR.toLocaleString()} MRR
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-teal-400 animate-pulse" />
          <span className="text-xs text-zinc-500">Agents running</span>
        </div>
      </div>

      {/* MRR progress bar */}
      <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs text-zinc-500 font-mono uppercase tracking-wider">MRR progress</p>
            <p className="text-2xl font-medium text-zinc-100 mt-1">
              ${currentMRR.toLocaleString()}
              <span className="text-sm text-zinc-500 font-normal ml-2">/ $40,000 target</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-medium text-teal-400">{mrrPct}%</p>
            <p className="text-xs text-zinc-500 mt-1">{(MRR_TARGET - currentMRR).toLocaleString()} remaining</p>
          </div>
        </div>
        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-teal-500 rounded-full transition-all duration-700"
            style={{ width: `${mrrPct}%` }}
          />
        </div>
        <div className="flex justify-between mt-2">
          {[0, 10000, 20000, 30000, 40000].map(v => (
            <span key={v} className="text-[10px] text-zinc-600 font-mono">
              ${(v / 1000).toFixed(0)}k
            </span>
          ))}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
        {KPIS.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-3.5">
            <div className="flex items-center gap-2 mb-2">
              <Icon size={13} className={color} />
              <p className="text-[11px] text-zinc-500 font-mono">{label}</p>
            </div>
            <p className="text-xl font-medium text-zinc-100">{value}</p>
          </div>
        ))}
      </div>

      {/* Pipeline funnel + Agent grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <PipelineFunnel statusCounts={statusCounts} statusOrder={STATUS_ORDER} total={totalLeads} />
        </div>
        <div>
          <AgentGrid harvestLogs={harvestLogs} />
        </div>
      </div>

      {/* Recent leads */}
      <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between">
          <p className="text-xs text-zinc-400 font-mono uppercase tracking-wider">Recent leads</p>
          <a href="/leads" className="text-xs text-teal-400 hover:text-teal-300">View all →</a>
        </div>
        <div className="divide-y divide-zinc-800/40">
          {recentLeads.slice(0, 8).map((lead: any) => (
            <a
              key={lead.id}
              href={`/leads/${lead.id}`}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-800/40 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
                <span className="text-[11px] font-medium text-zinc-400">
                  {(lead.name ?? lead.company)?.[0]?.toUpperCase() ?? "?"}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-200 truncate">{lead.name ?? "—"}</p>
                <p className="text-[11px] text-zinc-500 truncate">{lead.company}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {lead.lead_profiles?.disc && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-400 font-mono">
                    {lead.lead_profiles.disc}
                  </span>
                )}
                <span className="text-[11px] text-zinc-600 font-mono">{lead.score}</span>
                <span className="text-[10px] text-zinc-600">{timeAgo(lead.created_at)}</span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
