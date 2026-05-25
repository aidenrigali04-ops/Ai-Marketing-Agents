/**
 * Agent 01 — Prospect Harvester
 * Runs every 30 minutes. Pulls from Clay + Vibe Prospecting,
 * scores leads, deduplicates against Supabase, inserts new
 * qualified leads, then fires Agent 02 for each one.
 *
 * Env vars required:
 *   CLAY_API_KEY             — clay.com → Settings → API Keys
 *   VIBE_API_KEY             — vibeprospecting.explorium.ai → API
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   TRIGGER_API_KEY          — to trigger Agent 02 tasks
 */

import { schedules, tasks, logger } from "@trigger.dev/sdk/v3";
import { supabase } from "../lib/supabase-client";

// ─── TARGETS ─────────────────────────────────────────────────
// Rotated on each run so we cover all verticals + cities
// without hammering the same search every 30 min

const VERTICALS = [
  { industry: "hvac",              naics: "238220", keywords: ["hvac", "air conditioning", "heating"] },
  { industry: "landscaping",       naics: "561730", keywords: ["landscaping", "lawn care", "irrigation"] },
  { industry: "construction",      naics: "236110", keywords: ["remodeling", "general contractor"] },
  { industry: "property_mgmt",     naics: "531311", keywords: ["property management", "real estate management"] },
  { industry: "plumbing",          naics: "238220", keywords: ["plumbing", "plumber"] },
];

const TARGET_CITIES = [
  "Phoenix, AZ", "Dallas, TX", "Atlanta, GA",
  "Denver, CO",  "Nashville, TN", "Tampa, FL",
  "Charlotte, NC", "Austin, TX",  "Raleigh, NC",
];

const TARGET_SIZES = ["1-10", "11-50", "51-200"];

// ─── SCORING ─────────────────────────────────────────────────

interface RawLead {
  name?: string;
  title?: string;
  company: string;
  industry: string;
  company_size?: string;
  email?: string;
  phone?: string;
  linkedin_url?: string;
  website?: string;
  pain_signals?: string;
  source: "clay" | "vibe_prospecting";
}

function scoreLead(lead: RawLead): number {
  let score = 0;
  if (lead.website)                                score += 10;
  if (lead.email)                                  score += 20;
  if (lead.linkedin_url)                           score += 10;
  if (lead.phone)                                  score += 10;
  const size = lead.company_size || "";
  if (size.includes("1-10") || size.includes("11-50")) score += 15;
  if (lead.pain_signals?.toLowerCase().includes("missed")) score += 20;
  if (lead.title?.match(/owner|founder|president|ceo/i))   score += 15;
  return score;
}

// ─── CLAY PULLER ─────────────────────────────────────────────
// Finds owner/president contacts at companies matching vertical + city
// Clay API docs: https://docs.clay.com/api-reference

async function pullFromClay(
  vertical: typeof VERTICALS[0],
  city: string
): Promise<RawLead[]> {
  logger.info(`Clay pull: ${vertical.industry} in ${city}`);

  // Step 1: Find companies in this vertical + city
  const bizRes = await fetch("https://api.clay.com/v1/sources/search-businesses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.CLAY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filters: {
        industry_keywords: vertical.keywords,
        locations: [city],
        employee_count_ranges: TARGET_SIZES,
      },
      limit: 25,
    }),
  });

  if (!bizRes.ok) {
    const err = await bizRes.text();
    logger.warn(`Clay business search failed: ${bizRes.status}`, { err });
    return [];
  }

  const bizData = await bizRes.json();
  const companies: Array<{ domain: string; name: string }> = bizData.results || [];

  if (companies.length === 0) {
    logger.info("Clay returned 0 businesses for this query");
    return [];
  }

  // Step 2: Enrich each company → find owner contact
  const leads: RawLead[] = [];

  for (const company of companies.slice(0, 15)) {
    try {
      const contactRes = await fetch(
        "https://api.clay.com/v1/sources/find-contacts-at-company",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.CLAY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            company_domain: company.domain,
            title_keywords: ["Owner", "Founder", "President", "CEO", "Managing Director"],
            max_results: 1,
            enrich_email: true,
            enrich_phone: true,
            enrich_linkedin: true,
          }),
        }
      );

      if (!contactRes.ok) continue;
      const contactData = await contactRes.json();
      const contact = contactData.results?.[0];
      if (!contact) continue;

      leads.push({
        name:         contact.full_name,
        title:        contact.title,
        company:      company.name || contact.company_name,
        industry:     vertical.industry,
        company_size: contact.company_employee_count,
        email:        contact.email,
        phone:        contact.phone,
        linkedin_url: contact.linkedin_url,
        website:      company.domain ? `https://${company.domain}` : undefined,
        pain_signals: contact.company_description || "",
        source:       "clay",
      });

      // Clay rate limit — 2 req/sec safe
      await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      logger.warn(`Clay contact enrichment failed for ${company.domain}`, { e });
    }
  }

  logger.info(`Clay returned ${leads.length} enriched contacts`);
  return leads;
}

// ─── VIBE PROSPECTING PULLER ─────────────────────────────────
// Fetches businesses with buying intent signals + recent events
// Vibe API docs: https://vibeprospecting.explorium.ai/docs

async function pullFromVibe(
  vertical: typeof VERTICALS[0],
  city: string
): Promise<RawLead[]> {
  logger.info(`Vibe pull: ${vertical.industry} in ${city}`);

  // Step 1: Fetch businesses matching our criteria
  const bizRes = await fetch("https://vibeprospecting.explorium.ai/api/v1/fetch-entities", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.VIBE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      entity_type: "businesses",
      filters: {
        naics_category: { values: [vertical.naics] },
        company_size:   { values: TARGET_SIZES },
        city_region:    { values: [city] },
        company_country_code: { values: ["US"] },
        website_keywords: { values: vertical.keywords },
      },
      number_of_results: 25,
    }),
  });

  if (!bizRes.ok) {
    const err = await bizRes.text();
    logger.warn(`Vibe fetch-entities failed: ${bizRes.status}`, { err });
    return [];
  }

  const bizData = await bizRes.json();
  const businesses = bizData.results || [];

  if (businesses.length === 0) {
    logger.info("Vibe returned 0 businesses");
    return [];
  }

  // Step 2: Enrich to get prospect (owner) contact data
  const sessionId = bizData.session_id;
  const tableName = bizData.table_name;

  const prospectRes = await fetch(
    "https://vibeprospecting.explorium.ai/api/v1/enrich-prospects",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.VIBE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: sessionId,
        table_name: tableName,
        enrichments: ["enrich-prospects-contacts", "enrich-prospects-profiles"],
        parameters: { contact_types: ["email", "phone"] },
        sample_size: 25,
        estimate_cost: true,
      }),
    }
  );

  if (!prospectRes.ok) {
    logger.warn(`Vibe enrich failed: ${prospectRes.status}`);
    return [];
  }

  const prospectData = await prospectRes.json();
  const prospects = prospectData.results || [];

  const leads: RawLead[] = prospects
    .filter((p: any) => p.job_level?.match(/owner|c-suite|president|founder/i))
    .map((p: any) => ({
      name:         `${p.first_name || ""} ${p.last_name || ""}`.trim(),
      title:        p.job_title,
      company:      p.company_name,
      industry:     vertical.industry,
      company_size: p.company_size,
      email:        p.email,
      phone:        p.phone,
      linkedin_url: p.linkedin_url,
      website:      p.company_website,
      pain_signals: p.company_description || "",
      source:       "vibe_prospecting" as const,
    }));

  logger.info(`Vibe returned ${leads.length} qualified prospects`);
  return leads;
}

// ─── DEDUP CHECK ─────────────────────────────────────────────

async function isExistingLead(lead: RawLead): Promise<boolean> {
  // Check by email first (most reliable)
  if (lead.email) {
    const { count } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("email", lead.email);
    if ((count ?? 0) > 0) return true;
  }

  // Then by LinkedIn URL
  if (lead.linkedin_url) {
    const { count } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("linkedin_url", lead.linkedin_url);
    if ((count ?? 0) > 0) return true;
  }

  // Then by company + name combo
  if (lead.name && lead.company) {
    const { count } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .ilike("company", lead.company)
      .ilike("name", lead.name);
    if ((count ?? 0) > 0) return true;
  }

  return false;
}

// ─── INSERT + FIRE AGENT 02 ───────────────────────────────────

async function insertAndProfile(lead: RawLead & { score: number }): Promise<void> {
  const { data, error } = await supabase
    .from("leads")
    .insert({
      name:         lead.name,
      title:        lead.title,
      company:      lead.company,
      industry:     lead.industry,
      company_size: lead.company_size,
      email:        lead.email,
      phone:        lead.phone,
      linkedin_url: lead.linkedin_url,
      website:      lead.website,
      pain_signals: lead.pain_signals,
      score:        lead.score,
      source:       lead.source,
      status:       "pending_profile",
      enriched_at:  new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    // Ignore unique constraint violations (race condition dedup)
    if (error.code === "23505") return;
    throw error;
  }

  // Fire Agent 02 immediately for this lead
  await tasks.trigger("lead-profiler-agent", {
    lead_id:      data.id,
    name:         lead.name || "",
    title:        lead.title || "",
    company:      lead.company,
    industry:     lead.industry || "",
    company_size: lead.company_size || "",
    pain_signals: lead.pain_signals || "",
  });

  logger.info(`Inserted + fired profiler for: ${lead.name} @ ${lead.company}`);
}

// ─── MAIN CRON TASK ──────────────────────────────────────────

export const prospectHarvesterAgent = schedules.task({
  id:   "prospect-harvester-agent",
  cron: "*/30 * * * *",        // every 30 minutes

  run: async () => {
    logger.info("Agent 01: Prospect Harvester — 30-min run starting");

    // Rotate vertical + city on each run using current minute
    const now       = new Date();
    const runIndex  = Math.floor(now.getTime() / (30 * 60 * 1000));
    const vertical  = VERTICALS[runIndex % VERTICALS.length];
    const city      = TARGET_CITIES[runIndex % TARGET_CITIES.length];

    logger.info(`This run: ${vertical.industry} in ${city}`);

    let allLeads: RawLead[] = [];

    // Pull from both sources in parallel
    const [clayLeads, vibeLeads] = await Promise.allSettled([
      pullFromClay(vertical, city),
      pullFromVibe(vertical, city),
    ]);

    if (clayLeads.status === "fulfilled")  allLeads.push(...clayLeads.value);
    if (vibeLeads.status === "fulfilled") allLeads.push(...vibeLeads.value);

    logger.info(`Total raw leads: ${allLeads.length}`);

    // Score + filter
    const scoredLeads = allLeads
      .map((l) => ({ ...l, score: scoreLead(l) }))
      .filter((l) => l.score >= 40);          // minimum viable score

    logger.info(`Qualified (score ≥ 40): ${scoredLeads.length}`);

    // Dedup + insert
    let inserted = 0;
    let duped    = 0;

    for (const lead of scoredLeads) {
      const exists = await isExistingLead(lead);
      if (exists) { duped++; continue; }

      try {
        await insertAndProfile(lead);
        inserted++;
      } catch (e) {
        logger.error(`Insert failed for ${lead.company}`, { e });
      }
    }

    // Log this run
    await supabase.from("harvest_log").insert({
      source:          "clay+vibe",
      leads_found:     allLeads.length,
      leads_qualified: scoredLeads.length,
      leads_inserted:  inserted,
      leads_duped:     duped,
      vertical:        vertical.industry,
      city,
    });

    logger.info("Agent 01 run complete", {
      found:     allLeads.length,
      qualified: scoredLeads.length,
      inserted,
      duped,
      vertical:  vertical.industry,
      city,
    });

    return { inserted, duped, vertical: vertical.industry, city };
  },
});
