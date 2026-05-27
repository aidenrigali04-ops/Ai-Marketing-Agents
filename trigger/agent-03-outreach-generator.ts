/**
 * Agent 03 — Outreach Generator
 * Generates calibrated copy via Claude, then:
 *   - Email → Instantly.ai
 *   - LinkedIn → Waalaxy
 *   - SMS → Twilio
 *
 * Env vars:
 *   ANTHROPIC_API_KEY
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   INSTANTLY_API_KEY / INSTANTLY_CAMPAIGN_ID / INSTANTLY_FROM_EMAIL
 *   WAALAXY_API_KEY / WAALAXY_CAMPAIGN_ID
 *   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER
 *   HUNTER_API_KEY   (for email enrichment if still missing)
 */

import { task, logger } from "@trigger.dev/sdk/v3";
import Anthropic         from "@anthropic-ai/sdk";
import { supabase }      from "../lib/supabase-client";
import twilio            from "twilio";
import { readFileSync }  from "fs";
import { join }          from "path";

const anthropic    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// ─── SKILL LOADER ─────────────────────────────────────────────

function loadSkills(...names: string[]): string {
  return names.map(n => {
    try {
      return readFileSync(join(process.cwd(), "skills", `${n}.md`), "utf8");
    } catch {
      return `# ${n}\n[Skill missing — add to /skills/${n}.md]`;
    }
  }).join("\n\n---\n\n");
}

// ─── HUNTER EMAIL ENRICHMENT ─────────────────────────────────

async function enrichEmail(website: string): Promise<string | null> {
  if (!website || !process.env.HUNTER_API_KEY) return null;
  const domain = website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  if (!domain || domain.length < 4) return null;
  try {
    const res = await fetch(
      `https://api.hunter.io/v2/domain-search?domain=${domain}&limit=5&api_key=${process.env.HUNTER_API_KEY}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const emails = data?.data?.emails ?? [];
    const best = emails.sort((a: any, b: any) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
    return best?.value ?? null;
  } catch {
    return null;
  }
}

// ─── GENERATE COPY ────────────────────────────────────────────

interface OutreachCopy {
  emails: Array<{ subject: string; body: string; day: number }>;
  linkedin: {
    connection_request: string;
    dm1: string; dm1_day: number;
    dm2: string; dm2_day: number;
  };
  sms: Array<{ text: string; day: number }>;
}

async function generateCopy(
  lead: Record<string, string>,
  profile: Record<string, unknown>,
  product: string,
  skills: string
): Promise<OutreachCopy> {
  const prompt = `
Lead: ${lead.name || "Owner"}, ${lead.title} at ${lead.company} (${lead.industry})
Profile: DISC=${profile.disc}, Awareness=${profile.awarenessLevel}
Fear: ${profile.primaryFear}
Ego: ${profile.egoIdentity}
Opening hook: ${profile.openingHook}
Do NOT: ${profile.doNot}
Product: ${product}

Write psychologically calibrated outreach. Respond ONLY with valid JSON:
{
  "emails": [
    { "subject": "...", "body": "...(under 120 words, use [First Name] placeholder)", "day": 0 },
    { "subject": "...", "body": "...(vertical case study with specific number)", "day": 3 },
    { "subject": "...", "body": "...(respectful breakup)", "day": 7 }
  ],
  "linkedin": {
    "connection_request": "...(under 300 chars, no pitch)",
    "dm1": "...(under 400 chars, value first)",
    "dm1_day": 2,
    "dm2": "...(under 350 chars, soft CTA)",
    "dm2_day": 5
  },
  "sms": [
    { "text": "...(under 140 chars, curiosity hook, no pitch)", "day": 1 },
    { "text": "...(under 155 chars, social proof + Reply STOP to opt out)", "day": 5 }
  ]
}`;

  const response = await anthropic.messages.create({
    model:      "claude-sonnet-4-5-20250929",
    max_tokens: 2400,
    system:     skills,
    messages:   [{ role: "user", content: prompt }],
  });

  const raw = response.content
    .filter(b => b.type === "text")
    .map(b => (b as any).text)
    .join("");

  return JSON.parse(raw.replace(/```json|```/g, "").trim()) as OutreachCopy;
}

// ─── INSTANTLY (EMAIL) ────────────────────────────────────────

async function enrollInstantly(lead: Record<string, string>, copy: OutreachCopy): Promise<void> {
  if (!lead.email) {
    logger.warn("No email — skipping Instantly");
    return;
  }

  const res = await fetch("https://api.instantly.ai/api/v1/lead/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key:     process.env.INSTANTLY_API_KEY,
      campaign_id: process.env.INSTANTLY_CAMPAIGN_ID,
      skip_if_in_workspace: true,
      leads: [{
        email:        lead.email,
        first_name:   lead.name?.split(" ")[0] ?? "",
        last_name:    lead.name?.split(" ").slice(1).join(" ") ?? "",
        company_name: lead.company,
        custom_variables: {
          subject_1: copy.emails[0]?.subject ?? "",
          body_1:    copy.emails[0]?.body    ?? "",
          subject_2: copy.emails[1]?.subject ?? "",
          body_2:    copy.emails[1]?.body    ?? "",
          subject_3: copy.emails[2]?.subject ?? "",
          body_3:    copy.emails[2]?.body    ?? "",
        },
      }],
    }),
  });

  if (!res.ok) logger.warn(`Instantly failed: ${res.status} ${await res.text()}`);
  else logger.info(`Instantly enrolled: ${lead.email}`);
}

// ─── WAALAXY (LINKEDIN) ───────────────────────────────────────
// Docs: https://help.waalaxy.com/en/articles/8442463-waalaxy-api

// Map DISC type to Waalaxy campaign ID
const WAALAXY_CAMPAIGNS: Record<string, string> = {
  D: process.env.WAALAXY_CAMPAIGN_D!,
  I: process.env.WAALAXY_CAMPAIGN_I!,
  S: process.env.WAALAXY_CAMPAIGN_S!,
  C: process.env.WAALAXY_CAMPAIGN_C!,
};

async function enrollWaalaxy(
  lead: Record<string, string>,
  profile: Record<string, unknown>
): Promise<void> {
  if (!lead.linkedin_url) {
    logger.warn("No LinkedIn URL — skipping Waalaxy");
    return;
  }

  const disc       = (profile.disc as string) ?? "I";
  const campaignId = WAALAXY_CAMPAIGNS[disc] ?? WAALAXY_CAMPAIGNS["I"];

  if (!campaignId) {
    logger.warn(`No Waalaxy campaign ID for DISC type: ${disc}`);
    return;
  }

  const res = await fetch("https://api.waalaxy.com/v1/prospects", {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${process.env.WAALAXY_API_KEY}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      linkedin_url: lead.linkedin_url,
      first_name:   lead.name?.split(" ")[0] ?? "",
      last_name:    lead.name?.split(" ").slice(1).join(" ") ?? "",
      company_name: lead.company,
      campaign_id:  campaignId,
    }),
  });

  if (!res.ok) {
    logger.warn(`Waalaxy enroll failed: ${res.status} ${await res.text()}`);
  } else {
    logger.info(`Waalaxy enrolled: ${lead.linkedin_url} → DISC-${disc} campaign`);
  }
}
// ─── TWILIO (SMS) ─────────────────────────────────────────────

async function sendSmsDay1(lead: Record<string, string>, text: string): Promise<void> {
  if (!lead.phone) { logger.warn("No phone — skipping SMS"); return; }

  try {
    await twilioClient.messages.create({
      body: text.replace("[First Name]", lead.name?.split(" ")[0] ?? "there"),
      from: process.env.TWILIO_PHONE_NUMBER!,
      to:   lead.phone,
    });
    logger.info(`SMS sent to ${lead.phone}`);
  } catch (e: any) {
    logger.warn(`Twilio SMS failed: ${e.message}`);
  }
}

// ─── SEQUENCE STEPS ───────────────────────────────────────────

async function createSequenceSteps(
  sequenceId: string,
  leadId:     string,
  copy:       OutreachCopy,
  lead:       Record<string, string>
): Promise<void> {
  const now   = new Date();
  const dayMs = 86400000;
  const steps = [];

  // Email follow-ups (day 0 sent by Instantly on enroll)
  for (const email of copy.emails.filter(e => e.day > 0)) {
    steps.push({
      sequence_id: sequenceId, lead_id: leadId,
      step_number: email.day === 3 ? 2 : 3, channel: "email",
      subject: email.subject, content: email.body,
      send_at: new Date(now.getTime() + email.day * dayMs).toISOString(),
      status: "pending",
    });
  }

  // LinkedIn DM 2
  if (lead.linkedin_url) {
    steps.push({
      sequence_id: sequenceId, lead_id: leadId,
      step_number: 4, channel: "linkedin",
      content: copy.linkedin.dm2,
      send_at: new Date(now.getTime() + copy.linkedin.dm2_day * dayMs).toISOString(),
      status: "pending",
    });
  }

  // SMS day 5
  if (lead.phone && copy.sms[1]) {
    steps.push({
      sequence_id: sequenceId, lead_id: leadId,
      step_number: 5, channel: "sms",
      content: copy.sms[1].text,
      send_at: new Date(now.getTime() + copy.sms[1].day * dayMs).toISOString(),
      status: "pending",
    });
  }

  if (steps.length > 0) {
    const { error } = await supabase.from("sequence_steps").insert(steps);
    if (error) logger.warn("sequence_steps insert error", { error });
    else logger.info(`Created ${steps.length} follow-up steps`);
  }
}

// ─── MAIN TASK ────────────────────────────────────────────────

export const outreachGeneratorAgent = task({
  id:    "outreach-generator-agent",
  retry: { maxAttempts: 2, factor: 2, minTimeoutInMs: 3000 },

  run: async (payload: {
    lead_id: string;
    lead:    Record<string, string>;
    profile: Record<string, unknown>;
    product: string;
  }) => {
    logger.info("Agent 03: Outreach Generator starting", { lead_id: payload.lead_id });

    const skills = loadSkills("vantera-brand-voice", "vantera-outreach-agent");

    // Pull full lead record from DB
    const { data: leadRecord } = await supabase
      .from("leads")
      .select("*")
      .eq("id", payload.lead_id)
      .single();

    const lead = { ...payload.lead, ...leadRecord };

    // Last-chance email enrichment if still missing
    if (!lead.email && lead.website) {
      logger.info("Attempting Hunter email enrichment...");
      const foundEmail = await enrichEmail(lead.website);
      if (foundEmail) {
        lead.email = foundEmail;
        await supabase.from("leads").update({ email: foundEmail }).eq("id", payload.lead_id);
        logger.info(`Email enriched: ${foundEmail}`);
      }
    }

    // Log what contact channels we have
    logger.info("Contact channels available", {
      email:    !!lead.email,
      phone:    !!lead.phone,
      linkedin: !!lead.linkedin_url,
    });

    // Generate copy
    const copy = await generateCopy(lead, payload.profile, payload.product, skills);

    // Store sequence
    const { data: seqData, error: seqError } = await supabase
      .from("outreach_sequences")
      .insert({
        lead_id:        payload.lead_id,
        email_sequence: JSON.stringify(copy.emails),
        linkedin_seq:   JSON.stringify(copy.linkedin),
        sms_sequence:   JSON.stringify(copy.sms),
        product:        payload.product,
        status:         "sending",
      })
      .select("id")
      .single();

    if (seqError) throw seqError;

    await supabase
      .from("leads")
      .update({ status: "outreach_ready", sequence_id: seqData.id })
      .eq("id", payload.lead_id);

    // Deliver across all available channels in parallel
    await Promise.allSettled([
      lead.email        ? enrollInstantly(lead, copy) : Promise.resolve(),
      lead.linkedin_url ? enrollWaalaxy(lead, copy)   : Promise.resolve(),
      lead.phone && copy.sms[0] ? sendSmsDay1(lead, copy.sms[0].text) : Promise.resolve(),
    ]);

    // Create follow-up schedule
    await createSequenceSteps(seqData.id, payload.lead_id, copy, lead);

    await supabase
      .from("outreach_sequences")
      .update({ status: "sent" })
      .eq("id", seqData.id);

    logger.info("Agent 03 complete", {
      lead_id:    payload.lead_id,
      email_sent: !!lead.email,
      sms_sent:   !!lead.phone,
      linkedin:   !!lead.linkedin_url,
    });

    return { sequence_id: seqData.id };
  },
});
