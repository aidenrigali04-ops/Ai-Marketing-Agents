/**
 * Agent 03 — Outreach Generator
 * Triggered by Agent 02 after psychological profiling.
 * Generates calibrated email + LinkedIn + SMS copy via Claude,
 * enrolls the lead in Instantly (email), Expandi (LinkedIn),
 * sends SMS 1 via Twilio, and creates sequence_steps rows
 * for Agent 04 to manage all follow-ups.
 *
 * Env vars:
 *   ANTHROPIC_API_KEY
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   INSTANTLY_API_KEY
 *   INSTANTLY_CAMPAIGN_ID
 *   EXPANDI_API_KEY
 *   EXPANDI_CAMPAIGN_ID
 *   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER
 */

import { task, logger } from "@trigger.dev/sdk/v3";
import Anthropic         from "@anthropic-ai/sdk";
import { supabase } from "../lib/supabase-client";
import twilio            from "twilio";
import { readFileSync }  from "fs";

const anthropic   = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

function loadSkills(...names: string[]): string {
  return names.map(n => {
    try   { return readFileSync(`/mnt/skills/user/${n}/SKILL.md`, "utf8"); }
    catch { return `# ${n}\n[Skill missing]`; }
  }).join("\n\n---\n\n");
}

// ─── OUTPUT SCHEMA ────────────────────────────────────────────
// Claude outputs structured JSON — no regex parsing needed

interface OutreachOutput {
  emails: Array<{ subject: string; body: string; day: number }>;
  linkedin: {
    connection_request: string;
    dm1: string; dm1_day: number;
    dm2: string; dm2_day: number;
  };
  sms: Array<{ text: string; day: number }>;
}

// ─── GENERATE COPY ────────────────────────────────────────────

async function generateCopy(
  lead:    Record<string, string>,
  profile: Record<string, unknown>,
  product: string,
  skills:  string
): Promise<OutreachOutput> {
  const prompt = `
You are a world-class direct response copywriter trained in Cialdini, Kahneman, Schwartz,
Fogg, Eyal, Hormozi, Sugarman, Ogilvy, Ariely, and Jay Abraham.

Lead: ${lead.name}, ${lead.title} at ${lead.company} (${lead.industry}, ${lead.company_size})
Profile: DISC=${profile.disc}, Awareness Level=${profile.awarenessLevel}
Primary fear: ${profile.primaryFear}
Ego identity: ${profile.egoIdentity}
Opening hook: ${profile.openingHook}
Do NOT: ${profile.doNot}
Product: ${product}

Write psychologically calibrated outreach. Respond ONLY with valid JSON — no markdown, no preamble:

{
  "emails": [
    { "subject": "...", "body": "...", "day": 0 },
    { "subject": "...", "body": "...", "day": 3 },
    { "subject": "...", "body": "...", "day": 7 }
  ],
  "linkedin": {
    "connection_request": "...(under 300 chars, no pitch)",
    "dm1": "...(under 400 chars, value-first)",
    "dm1_day": 2,
    "dm2": "...(under 350 chars, soft CTA)",
    "dm2_day": 5
  },
  "sms": [
    { "text": "...(under 140 chars, curiosity hook)", "day": 1 },
    { "text": "...(under 155 chars, social proof + opt-out)", "day": 5 }
  ]
}

Rules:
- Email bodies under 120 words each. Use [First Name] placeholder.
- Never start with "I" or "I hope this finds you well"
- Lead with their vertical-specific pain, not the product name
- Email 2 must include a specific case study with a number
- Email 3 is a respectful breakup — create scarcity without fake urgency
- SMS must end with "Reply STOP to opt out"
`.trim();

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 2400,
    system:     skills,
    messages:   [{ role: "user", content: prompt }],
  });

  const raw = response.content
    .filter(b => b.type === "text")
    .map(b => (b as any).text)
    .join("");

  return JSON.parse(raw.replace(/```json|```/g, "").trim()) as OutreachOutput;
}

// ─── INSTANTLY (EMAIL) ────────────────────────────────────────

async function enrollInInstantly(
  lead:   Record<string, string>,
  copy:   OutreachOutput
): Promise<void> {
  if (!lead.email) { logger.warn("No email — skipping Instantly enroll"); return; }

  const res = await fetch("https://api.instantly.ai/api/v1/lead/add", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key:     process.env.INSTANTLY_API_KEY,
      campaign_id: process.env.INSTANTLY_CAMPAIGN_ID,
      skip_if_in_workspace: true,           // dedup safety
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

  if (!res.ok) {
    const err = await res.text();
    logger.warn(`Instantly enroll failed: ${res.status}`, { err });
  } else {
    logger.info("Enrolled in Instantly campaign", { email: lead.email });
  }
}

// ─── EXPANDI (LINKEDIN) ───────────────────────────────────────

async function enrollInExpandi(
  lead:    Record<string, string>,
  copy:    OutreachOutput
): Promise<void> {
  if (!lead.linkedin_url) { logger.warn("No LinkedIn URL — skipping Expandi"); return; }

  const res = await fetch(
    `https://api.expandi.io/api/v1/campaigns/${process.env.EXPANDI_CAMPAIGN_ID}/prospects`,
    {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${process.env.EXPANDI_API_KEY}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        prospects: [{
          linkedin_url: lead.linkedin_url,
          first_name:   lead.name?.split(" ")[0] ?? "",
          last_name:    lead.name?.split(" ").slice(1).join(" ") ?? "",
          custom_placeholders: {
            connection_note: copy.linkedin.connection_request,
            message_1:       copy.linkedin.dm1,
            message_2:       copy.linkedin.dm2,
          },
        }],
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    logger.warn(`Expandi enroll failed: ${res.status}`, { err });
  } else {
    logger.info("Enrolled in Expandi campaign", { linkedin: lead.linkedin_url });
  }
}

// ─── TWILIO (SMS DAY 1) ───────────────────────────────────────

async function sendSmsDay1(
  lead: Record<string, string>,
  text: string
): Promise<void> {
  if (!lead.phone) { logger.warn("No phone — skipping SMS day 1"); return; }

  try {
    await twilioClient.messages.create({
      body: text.replace("[First Name]", lead.name?.split(" ")[0] ?? "there"),
      from: process.env.TWILIO_PHONE_NUMBER!,
      to:   lead.phone,
    });
    logger.info("SMS day 1 sent", { phone: lead.phone });
  } catch (e) {
    logger.warn("Twilio SMS failed", { e });
  }
}

// ─── SEQUENCE STEPS ───────────────────────────────────────────
// Creates rows in sequence_steps for Agent 04 to manage follow-ups

async function createSequenceSteps(
  sequenceId: string,
  leadId:     string,
  copy:       OutreachOutput,
  lead:       Record<string, string>
): Promise<void> {
  const now    = new Date();
  const dayMs  = 24 * 60 * 60 * 1000;
  const steps  = [];

  // Email steps (Instantly manages day 0, we track 2 + 3 for visibility)
  for (const email of copy.emails) {
    if (email.day === 0) continue; // day 0 sent by Instantly on enroll
    steps.push({
      sequence_id: sequenceId,
      lead_id:     leadId,
      step_number: email.day === 3 ? 2 : 3,
      channel:     "email",
      subject:     email.subject,
      content:     email.body,
      send_at:     new Date(now.getTime() + email.day * dayMs).toISOString(),
      status:      "pending",
    });
  }

  // LinkedIn steps (Expandi manages connection + dm1, we track dm2)
  if (lead.linkedin_url) {
    steps.push({
      sequence_id: sequenceId,
      lead_id:     leadId,
      step_number: 4,
      channel:     "linkedin",
      content:     copy.linkedin.dm2,
      send_at:     new Date(now.getTime() + copy.linkedin.dm2_day * dayMs).toISOString(),
      status:      "pending",
    });
  }

  // SMS step 2 (day 1 already sent, this tracks day 5)
  if (lead.phone && copy.sms[1]) {
    steps.push({
      sequence_id: sequenceId,
      lead_id:     leadId,
      step_number: 5,
      channel:     "sms",
      content:     copy.sms[1].text,
      send_at:     new Date(now.getTime() + copy.sms[1].day * dayMs).toISOString(),
      status:      "pending",
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
  id: "outreach-generator-agent",
  retry: { maxAttempts: 2, factor: 2, minTimeoutInMs: 3000 },

  run: async (payload: {
    lead_id: string;
    lead:    Record<string, string>;
    profile: Record<string, unknown>;
    product: string;
  }) => {
    logger.info("Agent 03: Outreach Generator starting", { lead_id: payload.lead_id });

    // Load skills
    const skills = loadSkills("vantera-brand-voice", "vantera-outreach-agent");

    // Pull full lead record (includes phone, email, linkedin from DB)
    const { data: leadRecord } = await supabase
      .from("leads")
      .select("*")
      .eq("id", payload.lead_id)
      .single();

    const lead = { ...payload.lead, ...leadRecord };

    // Generate copy
    logger.info("Generating outreach copy via Claude");
    const copy = await generateCopy(lead, payload.profile, payload.product, skills);

    // Store sequence in Supabase
    const { data: seqData, error: seqError } = await supabase
      .from("outreach_sequences")
      .insert({
        lead_id:       payload.lead_id,
        email_sequence: JSON.stringify(copy.emails),
        linkedin_seq:   JSON.stringify(copy.linkedin),
        sms_sequence:   JSON.stringify(copy.sms),
        product:        payload.product,
        status:         "sending",
      })
      .select("id")
      .single();

    if (seqError) throw seqError;

    // Update lead with sequence reference
    await supabase
      .from("leads")
      .update({ status: "outreach_ready", sequence_id: seqData.id })
      .eq("id", payload.lead_id);

    // Deliver in parallel — fire and continue even if one fails
    await Promise.allSettled([
      enrollInInstantly(lead, copy),
      enrollInExpandi(lead, copy),
      copy.sms[0] ? sendSmsDay1(lead, copy.sms[0].text) : Promise.resolve(),
    ]);

    // Create follow-up steps for Agent 04
    await createSequenceSteps(seqData.id, payload.lead_id, copy, lead);

    // Update sequence status
    await supabase
      .from("outreach_sequences")
      .update({ status: "sent" })
      .eq("id", seqData.id);

    logger.info("Agent 03 complete", {
      lead_id:    payload.lead_id,
      sequence_id: seqData.id,
      emails:     copy.emails.length,
      sms:        copy.sms.length,
      linkedin:   !!lead.linkedin_url,
    });

    return { sequence_id: seqData.id };
  },
});
