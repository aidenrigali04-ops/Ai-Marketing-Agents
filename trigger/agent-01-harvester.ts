/**
 * Agent 01 — Prospect Harvester (Apify version)
 * Runs every 30 minutes. Uses Apify Google Maps Scraper
 * to find service businesses with phone, website, email.
 * Hunter.io enriches email from domain if not found directly.
 *
 * Env vars:
 *   APIFY_API_TOKEN              — apify.com → Settings → Integrations → API tokens
 *   HUNTER_API_KEY               — hunter.io → Dashboard → API
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 */

import { schedules, tasks, logger } from "@trigger.dev/sdk/v3";
import { supabase }                  from "../lib/supabase-client";

// ─── TARGETS ─────────────────────────────────────────────────

const VERTICALS = [
  { industry: "hvac",             queries: ["HVAC company", "air conditioning repair", "heating cooling service"] },
  { industry: "landscaping",      queries: ["landscaping company", "lawn care service"] },
  { industry: "construction",     queries: ["general contractor", "home remodeling company"] },
  { industry: "property_mgmt",    queries: ["property management company"] },
  { industry: "plumbing",         queries: ["plumbing company", "plumber"] },
  { industry: "marketing_agency", queries: ["marketing agency", "digital marketing agency", "SEO agency"] },
  { industry: "saas_agency",      queries: ["software company", "SaaS startup"] },
];

const TARGET_CITIES = [
  "Phoenix AZ",    "Dallas TX",     "Atlanta GA",
  "Denver CO",     "Nashville TN",  "Tampa FL",
  "Charlotte NC",  "Austin TX",     "Raleigh NC",
];

// ─── SCORING ─────────────────────────────────────────────────

function scoreLead(place: any): number {
  let score = 40; // base — every real business qualifies
  if (place.phone)                          score += 20;
  if (place.website)                        score += 15;
  if (place.email)                          score += 25;
  if ((place.reviewsCount ?? 0) >= 10)     score += 10;
  if ((place.reviewsCount ?? 0) >= 50)     score += 5;
  if ((place.rating ?? 0) >= 4.0)          score += 5;
  return Math.min(score, 100);
}

// ─── APIFY GOOGLE MAPS SCRAPER ───────────────────────────────
// Actor: compass/crawler-google-places
// Docs: https://apify.com/compass/crawler-google-places
// Uses run-sync endpoint — waits for results in one call

async function searchApify(query: string, city: string): Promise<any[]> {
  logger.info(`Apify search: "${query}" in ${city}`);

  const searchString = `${query} in ${city}`;

  const res = await fetch(
    `https://api.apify.com/v2/acts/compass~crawler-google-places/run-sync-get-dataset-items?token=${process.env.APIFY_API_TOKEN}&timeout=120`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        searchStringsArray:          [searchString],
        maxCrawledPlacesPerSearch:   20,
        language:                    "en",
        countryCode:                 "us",
        includeReviews:              false,
        includePeopleAlsoSearchFor:  false,
      }),
    }
  );

  if (!res.ok) {
    logger.warn(`Apify failed: ${res.status} ${await res.text()}`);
    return [];
  }

  const data = await res.json();
  const results = Array.isArray(data) ? data : [];
  logger.info(`Apify returned ${results.length} results`);
  return results;
}

// ─── HUNTER EMAIL ENRICHMENT ─────────────────────────────────

async function enrichEmail(website: string): Promise<string | null> {
  if (!website || !process.env.HUNTER_API_KEY) return null;

  const domain = website
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];

  if (!domain || domain.length < 4) return null;

  try {
    const res = await fetch(
      `https://api.hunter.io/v2/domain-search?domain=${domain}&limit=5&api_key=${process.env.HUNTER_API_KEY}`
    );
    if (!res.ok) return null;
    const data  = await res.json();
    const emails = data?.data?.emails ?? [];
    const best   = emails.sort((a: any, b: any) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
    return best?.value ?? null;
  } catch {
    return null;
  }
}

// ─── MAP RESULT → LEAD ───────────────────────────────────────

function mapToLead(place: any, industry: string) {
  return {
    name:         null,
    title:        "Owner",
    company:      place.title ?? place.name ?? "",
    industry,
    company_size: null,
    email:        place.email        ?? null,
    phone:        place.phone        ?? null,
    linkedin_url: null,
    website:      place.website      ?? null,
    pain_signals: [
      place.reviewsCount ? `${place.reviewsCount} Google reviews` : "",
      place.rating       ? `${place.rating} star rating`          : "",
      place.categoryName ?? "",
    ].filter(Boolean).join(". "),
    source: "apify" as const,
  };
}

// ─── DEDUP ───────────────────────────────────────────────────

async function isDuplicate(
  company: string,
  phone:   string | null,
  email:   string | null
): Promise<boolean> {
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

async function insertAndProfile(
  lead: ReturnType<typeof mapToLead> & { score: number }
): Promise<void> {
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
    if (error.code === "23505") return; // duplicate — safe to skip
    throw error;
  }

  await tasks.trigger("lead-profiler-agent", {
    lead_id:      data.id,
    name:         lead.name         ?? "",
    title:        lead.title,
    company:      lead.company,
    industry:     lead.industry     ?? "",
    company_size: lead.company_size ?? "",
    pain_signals: lead.pain_signals ?? "",
  });

  logger.info(`Inserted + Agent 02 fired: ${lead.company} | phone: ${!!lead.phone} | email: ${!!lead.email}`);
}

// ─── MAIN CRON ────────────────────────────────────────────────

export const prospectHarvesterAgent = schedules.task({
  id:          "prospect-harvester-agent",
  cron:        "*/30 * * * *",
  maxDuration: 300,

  run: async () => {
    logger.info("Agent 01: Prospect Harvester starting (Apify)");

    const runIndex = Math.floor(Date.now() / (30 * 60 * 1000));
    const vertical = VERTICALS[runIndex % VERTICALS.length];
    const city     = TARGET_CITIES[runIndex % TARGET_CITIES.length];
    const query    = vertical.queries[runIndex % vertical.queries.length];

    logger.info(`Run: "${query}" in ${city}`);

    const places = await searchApify(query, city);

    if (places.length === 0) {
      logger.warn("No results from Apify");
      await supabase.from("harvest_log").insert({
        source: "apify", leads_found: 0, leads_qualified: 0,
        leads_inserted: 0, leads_duped: 0,
        vertical: vertical.industry, city,
      });
      return { inserted: 0, duped: 0 };
    }

    // Map + enrich email where missing
    const mapped = places
      .map(p => mapToLead(p, vertical.industry))
      .filter(l => l.company);

    logger.info(`Enriching emails for ${mapped.filter(l => !l.email && l.website).length} leads`);

    for (const lead of mapped) {
      if (!lead.email && lead.website) {
        const found = await enrichEmail(lead.website);
        if (found) {
          lead.email = found;
          logger.info(`Hunter found email for ${lead.company}`);
        }
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // Score + filter
    const scored = mapped
      .map(l => ({ ...l, score: scoreLead(l) }))
      .filter(l => l.score >= 40);

    logger.info(`Qualified: ${scored.length}/${places.length}`);

    let inserted = 0;
    let duped    = 0;

    for (const lead of scored) {
      if (await isDuplicate(lead.company, lead.phone, lead.email)) {
        duped++;
        continue;
      }

      try {
        await insertAndProfile(lead);
        inserted++;
      } catch (e) {
        logger.error(`Insert failed: ${lead.company}`, { e });
      }

      await new Promise(r => setTimeout(r, 150));
    }

    await supabase.from("harvest_log").insert({
      source:          "apify",
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
