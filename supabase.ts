import { createBrowserClient } from "@supabase/ssr";
import { createServerClient as _createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// ── Browser client (client components) ───────────────────────
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON);
}

// ── Server client (server components + API routes) ────────────
export async function createServerClient() {
  const cookieStore = await cookies();
  return _createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: {
      getAll()                 { return cookieStore.getAll(); },
      setAll(cookiesToSet)     {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {}
      },
    },
  });
}

// ── Service-role client (API routes — bypasses RLS) ───────────
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
export function createServiceClient() {
  return createSupabaseClient(
    SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ── Helpers ───────────────────────────────────────────────────

export const STATUS_LABELS: Record<string, string> = {
  pending_profile: "Pending profile",
  profiled:        "Profiled",
  outreach_ready:  "Outreach ready",
  in_sequence:     "In sequence",
  replied:         "Replied",
  demo_booked:     "Demo booked",
  closed_won:      "Closed won",
  closed_lost:     "Closed lost",
  unsubscribed:    "Unsubscribed",
  bounced:         "Bounced",
};

export const STATUS_COLORS: Record<string, string> = {
  pending_profile: "bg-zinc-700 text-zinc-300",
  profiled:        "bg-blue-900/40 text-blue-400",
  outreach_ready:  "bg-purple-900/40 text-purple-400",
  in_sequence:     "bg-amber-900/40 text-amber-400",
  replied:         "bg-teal-900/40 text-teal-400",
  demo_booked:     "bg-green-900/40 text-green-400",
  closed_won:      "bg-green-900/60 text-green-300",
  closed_lost:     "bg-red-900/40 text-red-400",
  unsubscribed:    "bg-zinc-800 text-zinc-500",
  bounced:         "bg-zinc-800 text-zinc-500",
};

export const DISC_COLORS: Record<string, string> = {
  D: "text-red-400 bg-red-900/30",
  I: "text-amber-400 bg-amber-900/30",
  S: "text-green-400 bg-green-900/30",
  C: "text-blue-400 bg-blue-900/30",
};

export const DISC_LABELS: Record<string, string> = {
  D: "Dominant",
  I: "Influential",
  S: "Steady",
  C: "Conscientious",
};

export const INDUSTRY_LABELS: Record<string, string> = {
  hvac:          "HVAC",
  landscaping:   "Landscaping",
  construction:  "Construction",
  property_mgmt: "Property mgmt",
  plumbing:      "Plumbing",
  real_estate:   "Real estate",
  agency:        "Agency",
};

export function cn(...classes: (string | undefined | false | null)[]) {
  return classes.filter(Boolean).join(" ");
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  return `${days}d ago`;
}
