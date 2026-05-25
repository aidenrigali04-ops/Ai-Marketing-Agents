/**
 * Agent 01 — Prospect Harvester (Apollo.io version)
 * Runs every 30 minutes. Uses Apollo.io REST API to find
 * service business owners by title + industry + city.
 * Apollo returns email, LinkedIn, and company data in one call.
 *
 * Replaces deprecated Clay v1 endpoint and broken Vibe endpoint.
 *
 * Env vars:
 *   APOLLO_API_KEY              — apollo.io → Settings → Integrations → API Keys
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 */

import { schedules, tasks, logger } from "@trigger.dev/sdk/v3";
import { supabase } from "../lib/supabase-client";

const VERTICALS = [
  { industry: "hvac",          keywords: ["HVAC", "Air Conditioning", "Heating"] },
  { industry: "landscaping",   keywords: ["Landscaping", "Lawn Care", "Irrigation"] },
  { industry: "construction",  keywords: ["General Contractor", "Remodeling", "Construction"] },
  { industry: "property_mgmt", keywords: ["Property Management", "Real Estate Management"] },
  { industry: "plumbing",      keywords: ["Plumbing", "Plumber"] },
];

const TARGET_CITIES = [
  "Phoenix, AZ", "Dallas, TX", "Atlanta, GA",
  "Denver, CO",  "Nashville, TN", "Tampa, FL",
  "Charlotte, NC", "Austin, TX", "Raleigh, NC",
];

const OWNER_TITLES = ["Owner", "Founder", "President", "CEO", "Managing Director"];

function scoreLead(person: any): number {
  let score = 0;
  if (person.email)                                         score += 25;
  if (person.linkedin_url)                                  score += 10;
  if (person.phone_numbers?.length > 0)                     score += 10;
  if (person.organization?.website_url)                     score += 10;
  const emp = person.organization?.estimated_num_employees ?? 0;
  if (emp >= 3 && emp <= 50)                                score += 15;
  if (person.title?.match(/owner|founder|president|ceo/i)) score += 20;
  return score;
}

async function searchApollo(vertical: typeof VERTICALS[0], city: string): Promise<any[]> {
  logger.info(`Apollo: ${vertical.industry} in ${city}`);

  const res = await fetch("https://api.apollo.io/v1/mixed_people/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
    body: JSON.stringify({
      api_key: process.env.APOLLO_API_KEY,
      q_organization_keyword_tags: vertical.keywords,
      person_titles: OWNER_TITLES,
      person_locations: [city],
      organization_num_employees_ranges: ["1,10", "11,50", "51,200"],
      contact_email_status: ["verified", "guessed"],
      per_page: 25,
      page: 1,
    }),
  });

  if (!res.ok) {
    logger.warn(`Apollo failed: ${res.status}`, { body: await res.text() });
    return [];
  }

  const data = await res.json();
  logger.info(`Apollo returned ${data.people?.length ?? 0} results`);
  return data.people ?? [];
}

function mapPerson(person: any, industry: string) {
  const org = person.organization ?? {};
  return {
    name:         `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim(),
    title:        person.title ?? "",
    company:      person.organization_name ?? org.name ?? "",
    industry,
    company_size: org.estimated_num_employees ? `${org.estimated_num_employees}` : "",
    email:        person.email ?? "",
    phone:        person.phone_numbers?.[0]?.raw_number ?? "",
    linkedin_url: person.linkedin_url ?? "",
    website:      org.website_url ?? "",
    pain_signals: (org.short_description ?? "").slice(0, 500),
    source:       "apollo" as const,
  };
}

async function isDuplicate(email: string, linkedin: string): Promise<boolean> {
  if (email) {
    const { count } = await supabase.from("leads").select("id", { count: "exact", head: true }).eq("email", email.toLowerCase());
    if ((count ?? 0) > 0) return true;
  }
  if (linkedin) {
    const { count } = await supabase.from("leads").select("id", { count: "exact", head: true }).eq("linkedin_url", linkedin);
    if ((count ?? 0) > 0) return true;
  }
  return false;
}

export const prospectHarvesterAgent = schedules.task({
  id:   "prospect-harvester-agent",
  cron: "*/30 * * * *",

  run: async () => {
    logger.info("Agent 01: Prospect Harvester starting");

    const runIndex = Math.floor(Date.now() / (30 * 60 * 1000));
    const vertical = VERTICALS[runIndex % VERTICALS.length];
    const city     = TARGET_CITIES[runIndex % TARGET_CITIES.length];

    logger.info(`Run: ${vertical.industry} in ${city}`);

    const people = await searchApollo(vertical, city);

    const scored = people
      .map(p => ({ ...mapPerson(p, vertical.industry), score: scoreLead(p) }))
      .filter(l => l.score >= 40 && l.company);

    logger.info(`Qualified: ${scored.length}/${people.length}`);

    let inserted = 0, duped = 0;

    for (const lead of scored) {
      if (await isDuplicate(lead.email, lead.linkedin_url)) { duped++; continue; }

      try {
        const { data, error } = await supabase
          .from("leads")
          .insert({ ...lead, score: lead.score, status: "pending_profile", enriched_at: new Date().toISOString() })
          .select("id").single();

        if (error) { if (error.code !== "23505") throw error; continue; }

        await tasks.trigger("lead-profiler-agent", {
          lead_id: data.id, name: lead.name, title: lead.title,
          company: lead.company, industry: lead.industry,
          company_size: lead.company_size, pain_signals: lead.pain_signals,
        });

        inserted++;
      } catch (e) {
        logger.error(`Insert failed: ${lead.company}`, { e });
      }

      await new Promise(r => setTimeout(r, 200));
    }

    await supabase.from("harvest_log").insert({
      source: "apollo", leads_found: people.length,
      leads_qualified: scored.length, leads_inserted: inserted,
      leads_duped: duped, vertical: vertical.industry, city,
    });

    logger.info("Agent 01 done", { inserted, duped });
    return { inserted, duped };
  },
});
