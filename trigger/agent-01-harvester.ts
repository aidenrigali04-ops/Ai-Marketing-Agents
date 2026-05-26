/**
 * Agent 01 — Prospect Harvester
 * Uses Outscraper (Google Maps) for discovery.
 * Returns phone, website, business name, rating.
 * Hunter.io enriches the email from company domain.
 *
 * Env vars:
 *   OUTSCRAPER_API_KEY   — app.outscraper.com → API Keys
 *   HUNTER_API_KEY       — hunter.io → API
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 */

import { schedules, tasks, logger } from "@trigger.dev/sdk/v3";
import { supabase } from "../lib/supabase-client";

// ─── TARGETS ─────────────────────────────────────────────────

const VERTICALS = [
  { industry: "hvac",          queries: ["HVAC company", "air conditioning repair", "heating cooling"] },
  { industry: "landscaping",   queries: ["landscaping company", "lawn care service"] },
  { industry: "construction",  queries: ["general contractor", "home remodeling"] },
  { industry: "property_mgmt", queries: ["property management company"] },
  { industry: "plumbing",      queries: ["plumbing company", "plumber"] },
];

const TARGET_CITIES = [
  "Phoenix AZ", "Dallas TX", "Atlanta GA",
  "Denver CO",  "Nashville TN", "Tampa FL",
  "Charlotte NC", "Austin TX", "Raleigh NC",
];

// ─── SCORING ─────────────────────────────────────────────────

function scoreLead(place: any): number {
  let score = 0;
  if (place.phone)                              score += 20; // reachable via SMS
  if (place.site)                               score += 15; // has website (for email enrichment)
  if (place.email)                              score += 25; // direct email found
  if ((place.reviews ?? 0) >= 10)              score += 10; // established
  if ((place.reviews ?? 0) >= 50)              score += 5;  // well-established
  if ((place.rating ?? 0) >= 4.0)              score += 5;  // decent reputation
  score += 20; // base score
  return Math.min(score, 100);
}

// ─── OUTSCRAPER SEARCH ───────────────────────────────────────
// Google Maps scraper — returns phone, website, email if listed
// Docs: https://app.outscraper.com/api-docs

async function searchOutscraper(query: string, city: string): Promise<any[]> {
  logger.info(`Outscraper: "${query}" in ${city}`);

  const searchQuery = encodeURIComponent(`${query} ${city}`);
  const url = `https://api.app.outscraper.com/maps/search?query=${searchQuery}&limit=20&language=en&region=US&async=false`;

  const res = await fetch(url, {
    headers: {
      "X-API-KEY": process.env.OUTSCRAPER_API_KEY!,
    },
  });

  if (!res.ok) {
    logger.warn(`Outscraper failed: ${res.status} ${await res.text()}`);
    return [];
  }

  const data = await res.json();
  // Outscraper returns { data: [[...results]] } for sync calls
  const results = data?.data?.[0] ?? data?.data ?? [];
  logger.info(`Outscraper returned ${results.length} results`);
  return results;
}

// ─── HUNTER EMAIL ENRICHMENT ─────────────────────────────────
// Finds email addresses from a company domain
// Docs: https://hunter.io/api-documentation

async function findEmailFromDomain(website: string): Promise<string | null> {
  if (!website || !process.env.HUNTER_API_KEY) return null;

  // Extract clean domain
  const domain = website
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0];

  if (!domain || domain.length < 4) return null;

  try {
    const res = await fetch(
      `https://api.hunter.io/v2/domain-search?domain=${domain}&limit=5&api_key=${process.env.HUNTER_API_KEY}`
    );

    if (!res.ok) return null;

    const data = await res.json();
    const emails: any[] = data?.data?.emails ?? [];

    if (emails.length === 0) return null;

    // Prefer high-confidence emails, then any email
    const best = emails
      .filter((e: any) => e.type === "personal" || e.confidence >= 70)
      .sort((a: any, b: any) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];

    return best?.value ?? emails[0]?.value ?? null;
  } catch {
    return null;
  }
}

// ─── MAP RESULT → LEAD ───────────────────────────────────────

function mapToLead(place: any, industry: string) {
  return {
    name:         place.owner ?? place.full_name ?? null,
    title:        "Owner",
    company:      place.name ?? place.title ?? "",
    industry,
    company_size: null,
    email:        place.email ?? place.email_1 ?? null,
    phone:        place.phone ?? place.phone_1 ?? null,
    linkedin_url: null,
    website:      place.site ?? place.website ?? null,
    pain_signals: [
      place.reviews ? `${place.reviews} Google reviews` : "",
      place.rating  ? `${place.rating} star rating` : "",
      place.category ?? "",
    ].filter(Boolean).join(". "),
    source: "outscraper" as const,
  };
}

// ─── DEDUP ───────────────────────────────────────────────────

async function isDuplicate(company: string, phone: string | null, email: string | null): Promise<boolean> {
  if (email) {
    const { count } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("email", email.toLowerCase().trim());
    if ((count ?? 0) > 0) return true;
  }
  if (phone) {
    const { count } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("phone", phone);
    if ((count ?? 0) > 0) return true;
  }
  if (company) {
    const { count } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .ilike("company", company);
    if ((count ?? 0) > 0) return true;
  }
  return false;
}

// ─── INSERT + FIRE AGENT 02 ───────────────────────────────────

async function insertAndProfile(lead: ReturnType<typeof mapToLead> & { score: number }) {
  const { data, error } = await supabase
    .from("leads")
    .insert({
      ...lead,
      score:       lead.score,
      status:      "pending_profile",
      enriched_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return;
    throw error;
  }

  await tasks.trigger("lead-profiler-agent", {
    lead_id:      data.id,
    name:         lead.name ?? "",
    title:        lead.title,
    company:      lead.company,
    industry:     lead.industry,
    company_size: lead.company_size ?? "",
    pain_signals: lead.pain_signals ?? "",
  });

  logger.info(`Inserted + profiler fired: ${lead.company} | phone: ${!!lead.phone} | email: ${!!lead.email}`);
}

// ─── MAIN CRON ────────────────────────────────────────────────

export const prospectHarvesterAgent = schedules.task({
  id:   "prospect-harvester-agent",
  cron: "*/30 * * * *",

  run: async () => {
    logger.info("Agent 01: Prospect Harvester starting (Outscraper + Hunter)");

    const runIndex = Math.floor(Date.now() / (30 * 60 * 1000));
    const vertical = VERTICALS[runIndex % VERTICALS.length];
    const city     = TARGET_CITIES[runIndex % TARGET_CITIES.length];
    const query    = vertical.queries[runIndex % vertical.queries.length];

    logger.info(`Run: "${query}" in ${city}`);

    const places = await searchOutscraper(query, city);

    if (places.length === 0) {
      await supabase.from("harvest_log").insert({
        source: "outscraper", leads_found: 0, leads_qualified: 0,
        leads_inserted: 0, leads_duped: 0, vertical: vertical.industry, city,
      });
      return { inserted: 0, duped: 0 };
    }

    // Map results
    const mapped = places
      .map(p => mapToLead(p, vertical.industry))
      .filter(l => l.company); // must have company name

    // Enrich email via Hunter if missing
    logger.info(`Enriching emails for ${mapped.filter(l => !l.email && l.website).length} leads without email`);

    for (const lead of mapped) {
      if (!lead.email && lead.website) {
        const foundEmail = await findEmailFromDomain(lead.website);
        if (foundEmail) {
          lead.email = foundEmail;
          logger.info(`Hunter found email for ${lead.company}: ${foundEmail}`);
        }
        // Small delay to respect Hunter rate limits
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // Score + filter
    const scored = mapped
      .map(l => ({ ...l, score: scoreLead(l) }))
      .filter(l => l.score >= 40);

    logger.info(`Qualified (≥40): ${scored.length}/${places.length}`);

    let inserted = 0, duped = 0;

    for (const lead of scored) {
      if (await isDuplicate(lead.company, lead.phone, lead.email)) { duped++; continue; }

      try {
        await insertAndProfile(lead);
        inserted++;
      } catch (e) {
        logger.error(`Insert failed: ${lead.company}`, { e });
      }

      await new Promise(r => setTimeout(r, 150));
    }

    await supabase.from("harvest_log").insert({
      source:          "outscraper",
      leads_found:     places.length,
      leads_qualified: scored.length,
      leads_inserted:  inserted,
      leads_duped:     duped,
      vertical:        vertical.industry,
      city,
    });

    logger.info("Agent 01 done", { inserted, duped });
    return { inserted, duped };
  },
});
