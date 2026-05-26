"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Users, GitBranch, Mail,
  FileText, Bot, Settings, Zap, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/supabase";

const NAV = [
  { href: "/",          label: "Dashboard",  icon: LayoutDashboard },
  { href: "/leads",     label: "Leads",      icon: Users },
  { href: "/pipeline",  label: "Pipeline",   icon: GitBranch },
  { href: "/outreach",  label: "Outreach",   icon: Mail },
  { href: "/content",   label: "Content",    icon: FileText },
  { href: "/agents",    label: "Agents",     icon: Bot },
];

const BOTTOM = [
  { href: "/mrr",       label: "MRR tracker", icon: TrendingUp },
  { href: "/settings",  label: "Settings",    icon: Settings },
];

export function Sidebar() {
  const path = usePathname();

  return (
    <aside className="w-56 h-screen flex flex-col bg-zinc-900 border-r border-zinc-800/60 shrink-0">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-zinc-800/60">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded bg-teal-500 flex items-center justify-center shrink-0">
            <Zap size={13} className="text-zinc-950" />
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-100 leading-none">AI Marketing</p>
            <p className="text-[11px] text-zinc-500 mt-0.5 leading-none">Agent CRM</p>
          </div>
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        <p className="px-2 pb-1.5 text-[10px] font-medium text-zinc-600 uppercase tracking-wider">
          Command
        </p>
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors",
              path === href
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
            )}
          >
            <Icon size={15} className="shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      {/* Bottom nav */}
      <div className="px-2 py-3 border-t border-zinc-800/60 space-y-0.5">
        {BOTTOM.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors",
              path === href
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
            )}
          >
            <Icon size={15} className="shrink-0" />
            {label}
          </Link>
        ))}
      </div>
    </aside>
  );
}
