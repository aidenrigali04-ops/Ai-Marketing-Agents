
/**
 * Agent 01 — Prospect Harvester (Google Places version)
 * Runs every 30 minutes. Uses Google Places API (New) to find
 * service businesses by type + city. Free tier covers ~28,000
 * searches/month — more than enough for this use case.
 *
 * Env vars:
 *   GOOGLE_PLACES_API_KEY      — console.cloud.google.com → Places API (New)
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 */

import { schedules, tasks, logger } from "@trigger.dev/sdk/v3";
import { supabase } from "../lib/supabase-client";

// ─── TARGETS ─────────────────────────────────────────────────

const VERTICALS = [
  {
    industry: "hvac",
    queries: ["HVAC company", "air conditioning repair", "heating and cooling company"],
  },
  {
    industry: "landscaping",
    queries: ["landscaping company", "lawn care service", "lawn maintenance"],
  },
  {
    industry: "construction",
    queries: ["general contractor", "home remodeling contractor", "construction company"],
  },
  {
    industry: "property_mgmt",
    queries: ["property management company", "property manager"],
  },
  {
    industry: "plumbing",
    queries: ["plumbing company", "plumber service"],
  },
];

const TARGET_CITIES = [
  "Phoenix AZ",    "Dallas TX",    "Atlanta GA",
  "Denver CO",     "Nashville TN", "Tampa FL",
  "Charlotte NC",  "Austin TX",    "Raleigh NC",
];

// ─── SCORING ─────────────────────────────────────────────────

function scoreLead(place: any): number {
  let score = 0;
  if (place.nationalPhoneNumber)              score += 20; // phone = reachable
  if (place.websiteUri)                        score += 20; // has website
  if ((place.userRatingCount ?? 0) >= 10)      score += 15; // established business
  if ((place.userRatingCount ?? 0) >= 50)      score += 10; // well-established
  if ((place.rating ?? 0) >= 4.0)             score += 10; // good reputation
  if ((place.rating ?? 0) < 4.5)              score += 5;  // room for improvement (pain signal)
  score += 20; // base score for being a real business
  return Math.min(score, 100);
}

// ─── GOOGLE PLACES SEARCH ────────────────────────────────────
// Uses the new Places API (v1) Text Search endpoint
// Docs: https://developers.google.com/maps/documentation/places/web-service/text-search

async function searchPlaces(query: string, city: string): Promise<any[]> {
  logger.info(`Places search: "${query}" in ${city}`);

  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type":    "application/json",
      "X-Goog-Api-Key":  process.env.GOOGLE_PLACES_API_KEY!,
      "X-Goog-FieldMask": [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.nationalPhoneNumber",
        "places.websiteUri",
        "places.rating",
        "places.userRatingCount",
        "places.businessStatus",
      ].join(","),
    },
    body: JSON.stringify({
      textQuery:       `${query} in ${city}`,
      maxResultCount:  20,
      languageCode:    "en",
      regionCode:      "US",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    logger.warn(`Places API failed: ${res.status}`, { err });
    return [];
  }

  const data = await res.json();
  const places = (data.places ?? []).filter(
    (p: any) => p.businessStatus === "OPERATIONAL" || !p.businessStatus
  );

  logger.info(`Places returned ${places.length} results`);
  return places;
}

// ─── MAP PLACE → LEAD ─────────────────────────────────────────

function mapPlaceToLead(place: any, industry: string, query: string) {
  // Extract city/state from formatted address
  const addressParts = (place.formattedAddress ?? "").split(",");
  const city = addressParts.slice(-3, -1).join(",").trim();

  return {
    name:         null,              // Google Places doesn't give owner name
    title:        "Owner",           // assume owner for now — Agent 02 will profile
    company:      place.displayName?.text ?? "",
    industry,
    company_size: null,
    email:        null,              // not available from Places API
    phone:        place.nationalPhoneNumber ?? null,
    linkedin_url: null,
    website:      place.websiteUri ?? null,
    pain_signals: [
      place.userRatingCount ? `${place.userRatingCount} reviews, ${place.rating ?? "no"} rating` : "",
      query,
    ].filter(Boolean).join(". "),
    source: "google_places" as const,
  };
}

// ─── DEDUP ───────────────────────────────────────────────────

async function isDuplicate(company: string, phone: string | null): Promise<boolean> {
  // Check by company name first
  if (company) {
    const { count } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .ilike("company", company);
    if ((count ?? 0) > 0) return true;
  }
  // Then by phone
  if (phone) {
    const { count } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("phone", phone);
    if ((count ?? 0) > 0) return true;
  }
  return false;
}

// ─── INSERT + FIRE AGENT 02 ───────────────────────────────────

async function insertAndProfile(
  lead: ReturnType<typeof mapPlaceToLead> & { score: number }
) {
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

  // Fire Agent 02 immediately for this lead
  await tasks.trigger("lead-profiler-agent", {
    lead_id:      data.id,
    name:         lead.name ?? "",
    title:        lead.title,
    company:      lead.company,
    industry:     lead.industry,
    company_size: lead.company_size ?? "",
    pain_signals: lead.pain_signals ?? "",
  });

  logger.info(`Inserted + profiler fired: ${lead.company}`);
}

// ─── MAIN CRON ────────────────────────────────────────────────

export const prospectHarvesterAgent = schedules.task({
  id:   "prospect-harvester-agent",
  cron: "*/30 * * * *",

  run: async () => {
    logger.info("Agent 01: Prospect Harvester starting (Google Places)");

    // Rotate vertical + city on each run
    const runIndex = Math.floor(Date.now() / (30 * 60 * 1000));
    const vertical = VERTICALS[runIndex % VERTICALS.length];
    const city     = TARGET_CITIES[runIndex % TARGET_CITIES.length];

    // Pick one query from this vertical for this run
    const query = vertical.queries[runIndex % vertical.queries.length];

    logger.info(`Run: "${query}" in ${city}`);

    const places = await searchPlaces(query, city);

    if (places.length === 0) {
      logger.info("No results from Places API");
      await supabase.from("harvest_log").insert({
        source: "google_places", leads_found: 0, leads_qualified: 0,
        leads_inserted: 0, leads_duped: 0,
        vertical: vertical.industry, city,
      });
      return { inserted: 0, duped: 0 };
    }

    // Score + filter
    const scored = places
      .map(p => ({ ...mapPlaceToLead(p, vertical.industry, query), score: scoreLead(p) }))
      .filter(l => l.score >= 40 && l.company);

    logger.info(`Qualified (≥40): ${scored.length}/${places.length}`);

    let inserted = 0, duped = 0;

    for (const lead of scored) {
      if (await isDuplicate(lead.company, lead.phone)) { duped++; continue; }

      try {
        await insertAndProfile(lead);
        inserted++;
      } catch (e) {
        logger.error(`Insert failed: ${lead.company}`, { e });
      }

      // Small delay to be polite to the API
      await new Promise(r => setTimeout(r, 100));
    }

    await supabase.from("harvest_log").insert({
      source:          "google_places",
      leads_found:     places.length,
      leads_qualified: scored.length,
      leads_inserted:  inserted,
      leads_duped:     duped,
      vertical:        vertical.industry,
      city,
    });

    logger.info("Agent 01 done", { inserted, duped, vertical: vertical.industry, city });
    return { inserted, duped };
  },
});
