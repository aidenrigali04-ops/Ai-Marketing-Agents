/**
 * Agent 02 — Lead Profiler
 * Triggered by Agent 01 immediately after a new lead is inserted.
 * Runs the full 10-framework psychological profile via Claude,
 * stores the result, then fires Agent 03 (Outreach Generator).
 *
 * Also handles the Supabase webhook trigger (see edge function).
 *
 * Env vars required:
 *   ANTHROPIC_API_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { task, logger, tasks } from "@trigger.dev/sdk/v3";
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "../lib/supabase-client";
import { readFileSync } from "fs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });


// ─── SKILL LOADER ─────────────────────────────────────────────

function loadSkills(...names: string[]): string {
  return names
    .map((n) => {
      try {
        return readFileSync(`/mnt/skills/user/${n}/SKILL.md`, "utf8");
      } catch {
        logger.warn(`Skill not found: ${n}`);
        return `# ${n}\n[Skill missing — add to /mnt/skills/user/${n}/SKILL.md]`;
      }
    })
    .join("\n\n---\n\n");
}

// ─── PROFILE SYSTEM PROMPT ────────────────────────────────────

const PROFILE_SYSTEM = `
You are an elite behavioral psychologist trained in Cialdini, Kahneman, Schwartz,
Fogg, Eyal, Hormozi, Sugarman, Ariely, Ogilvy, and Jay Abraham.

Generate a precise psychological sales profile for the lead provided.
Respond ONLY with valid JSON — no markdown, no preamble, no extra text:

{
  "disc": "D|I|S|C",
  "awarenessLevel": 2,
  "topTriggers": [
    { "trigger": "trigger name", "rationale": "why for this specific person", "expert": "Cialdini" },
    { "trigger": "", "rationale": "", "expert": "" },
    { "trigger": "", "rationale": "", "expert": "" },
    { "trigger": "", "rationale": "", "expert": "" },
    { "trigger": "", "rationale": "", "expert": "" }
  ],
  "primaryFear": "their core role/business fear",
  "egoIdentity": "how they see themselves as a professional",
  "decisionStyle": "how they make purchasing decisions",
  "openingHook": "specific first-sentence strategy for outreach",
  "doNot": "the single biggest mistake to avoid with this person"
}

Base the profile on their title, industry, company size, pain signals, and Vantera's
context as a CRM + automation platform for service businesses.
`;

// ─── OUTREACH TRIGGER ─────────────────────────────────────────
// After profiling, immediately fire Agent 03
import { tasks } from "@trigger.dev/sdk/v3";

// ─── MAIN TASK ────────────────────────────────────────────────

export const leadProfilerAgent = task({
  id: "lead-profiler-agent",

  // Retry up to 3 times with exponential backoff
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 2_000,
    maxTimeoutInMs: 30_000,
  },

  run: async (payload: {
    lead_id:      string;
    name:         string;
    title:        string;
    company:      string;
    industry:     string;
    company_size: string;
    pain_signals: string;
    notes?:       string;
  }) => {
    logger.info("Agent 02: Lead Profiler starting", { lead_id: payload.lead_id });

    // Load skills
    const skills = loadSkills("vantera-brand-voice", "vantera-outreach-agent");
    const systemPrompt = PROFILE_SYSTEM + "\n\n---\n\nVantera context:\n" + skills;

    // Build user message
    const userMessage = [
      `Name: ${payload.name || "Unknown"}`,
      `Title: ${payload.title || "Unknown"}`,
      `Company: ${payload.company}`,
      `Industry: ${payload.industry}`,
      `Company size: ${payload.company_size || "Unknown"}`,
      `Pain signals: ${payload.pain_signals || "None provided"}`,
      `Notes: ${payload.notes || "None"}`,
    ].join("\n");

    // Call Claude
    logger.info("Calling Claude for psychological profile");
    const response = await anthropic.messages.create({
      model:      "claude-sonnet-4-20250514",
      max_tokens: 1400,
      system:     systemPrompt,
      messages:   [{ role: "user", content: userMessage }],
    });

    const raw = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    // Parse profile JSON
    let profile: {
      disc:           string;
      awarenessLevel: number;
      topTriggers:    Array<{ trigger: string; rationale: string; expert: string }>;
      primaryFear:    string;
      egoIdentity:    string;
      decisionStyle:  string;
      openingHook:    string;
      doNot:          string;
    };

    try {
      profile = JSON.parse(raw.replace(/```json|```/g, "").trim());
    } catch (e) {
      logger.error("Profile JSON parse failed", { raw: raw.slice(0, 500) });
      throw new Error(`Profile parse failed: ${(e as Error).message}`);
    }

    // Validate required fields
    if (!profile.disc || !profile.primaryFear || !profile.openingHook) {
      throw new Error(`Profile missing required fields: ${JSON.stringify(profile)}`);
    }

    // Store profile in Supabase
    const { error: upsertError } = await supabase
      .from("lead_profiles")
      .upsert({
        lead_id:        payload.lead_id,
        disc:           profile.disc,
        awareness_level: profile.awarenessLevel,
        top_triggers:   profile.topTriggers,
        primary_fear:   profile.primaryFear,
        ego_identity:   profile.egoIdentity,
        decision_style: profile.decisionStyle,
        opening_hook:   profile.openingHook,
        do_not:         profile.doNot,
        profiled_at:    new Date().toISOString(),
      });

    if (upsertError) throw upsertError;

    // Update lead status → profiled
    const { error: updateError } = await supabase
      .from("leads")
      .update({ status: "profiled" })
      .eq("id", payload.lead_id);

    if (updateError) throw updateError;

    logger.info("Profile stored", {
      lead_id: payload.lead_id,
      disc:    profile.disc,
      level:   profile.awarenessLevel,
    });

    // Fire Agent 03 immediately (Outreach Generator)
    await tasks.trigger("outreach-generator-agent", {
      lead_id: payload.lead_id,
      lead: {
        name:         payload.name,
        title:        payload.title,
        company:      payload.company,
        industry:     payload.industry,
        company_size: payload.company_size,
      },
      profile,
      product: "Vantera — CRM and automation platform for service businesses",
    });

    logger.info("Agent 03 (Outreach Generator) fired", { lead_id: payload.lead_id });

    return {
      lead_id: payload.lead_id,
      disc:    profile.disc,
      level:   profile.awarenessLevel,
      fear:    profile.primaryFear,
    };
  },
});
