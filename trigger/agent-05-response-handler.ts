/**
 * Agent 05 — Response Handler
 * Triggered by /api/webhooks/reply when Instantly, Twilio,
 * or Expandi detect a reply. Classifies via Claude, stops
 * the sequence, sends a response, and books demos.
 *
 * Env vars:
 *   ANTHROPIC_API_KEY
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   INSTANTLY_API_KEY
 *   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER
 *   SLACK_WEBHOOK_URL
 *   CALENDLY_LINK
 */

import { task, logger }  from "@trigger.dev/sdk/v3";
import Anthropic          from "@anthropic-ai/sdk";
import { supabase }       from "../lib/supabase-client";
import twilio             from "twilio";
import { readFileSync }   from "fs";
import { join }           from "path";

const anthropic    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const CALENDLY = process.env.CALENDLY_LINK ?? "https://calendly.com/vantera/demo";

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

// ─── CLASSIFY REPLY ───────────────────────────────────────────

interface Classification {
  type:           "interested" | "soft_interest" | "objection" | "wrong_person" | "unsubscribe";
  next_action:    "book_demo" | "schedule_followup" | "handle_objection" | "get_referral" | "stop";
  response_draft: string | null;
  objection_type: string | null;
  urgency:        "high" | "medium" | "low";
}

async function classifyReply(
  replyText: string,
  channel:   string,
  lead:      any,
  skills:    string
): Promise<Classification> {
  const response = await anthropic.messages.create(
    {
      model:      "claude-sonnet-4-5-20250929",
      max_tokens: 600,
      system: `${skills}

Classify this sales reply and generate an appropriate response.
Respond ONLY with valid JSON:
{
  "type": "interested | soft_interest | objection | wrong_person | unsubscribe",
  "next_action": "book_demo | schedule_followup | handle_objection | get_referral | stop",
  "response_draft": "your reply under 80 words, or null if stopping",
  "objection_type": "price | timing | competitor | size | null",
  "urgency": "high | medium | low"
}

If interested: response_draft should confirm + offer 2 time slots + Calendly link placeholder [CALENDLY].
If objection: use objection handling from the skill file.
If unsubscribe: response_draft must be null.
Sound like a real person.`,
      messages: [{
        role:    "user",
        content: `Lead: ${lead.name ?? "Unknown"}, ${lead.title ?? ""} at ${lead.company ?? ""}
Channel: ${channel}
Their reply: "${replyText}"`,
      }],
    },
    { timeout: 30000 }
  );

  const raw = response.content
    .filter(b => b.type === "text")
    .map(b => (b as any).text)
    .join("");

  return JSON.parse(raw.replace(/```json|```/g, "").trim()) as Classification;
}

// ─── STOP SEQUENCE ────────────────────────────────────────────

async function stopSequence(leadId: string, sequenceId: string | null): Promise<void> {
  if (sequenceId) {
    await supabase
      .from("sequence_steps")
      .update({ status: "cancelled", skip_reason: "lead_replied" })
      .eq("sequence_id", sequenceId)
      .eq("status", "pending");
  }

  await supabase
    .from("sequence_steps")
    .update({ status: "cancelled", skip_reason: "lead_replied" })
    .eq("lead_id", leadId)
    .eq("status", "pending");

  logger.info("Sequence stopped", { lead_id: leadId });
}

// ─── SEND EMAIL RESPONSE ─────────────────────────────────────

async function sendEmailResponse(lead: any, body: string): Promise<void> {
  if (!lead.email) return;

  const res = await fetch("https://api.instantly.ai/api/v1/emails/reply", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key:         process.env.INSTANTLY_API_KEY,
      to:              lead.email,
      body:            body.replace("[First Name]", lead.name?.split(" ")[0] ?? "there"),
      reply_to_thread: true,
    }),
  });

  if (!res.ok) logger.warn(`Instantly reply failed: ${res.status}`);
  else logger.info(`Email reply sent to ${lead.email}`);
}

// ─── SEND SMS RESPONSE ────────────────────────────────────────

async function sendSmsResponse(lead: any, body: string): Promise<void> {
  if (!lead.phone) return;
  try {
    await twilioClient.messages.create({
      body: body.replace("[First Name]", lead.name?.split(" ")[0] ?? "there"),
      from: process.env.TWILIO_PHONE_NUMBER!,
      to:   lead.phone,
    });
    logger.info(`SMS reply sent to ${lead.phone}`);
  } catch (e: any) {
    logger.warn(`Twilio reply failed: ${e.message}`);
  }
}

// ─── SLACK ALERT ──────────────────────────────────────────────

async function alertSlack(lead: any, replyText: string, channel: string): Promise<void> {
  if (!process.env.SLACK_WEBHOOK_URL) return;

  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: [
        "🔥 *Interested reply*",
        `*Lead:* ${lead.name ?? "Unknown"} — ${lead.title ?? ""} @ ${lead.company ?? ""}`,
        `*Channel:* ${channel}`,
        `*Message:* "${replyText}"`,
        `*Calendly sent:* ${CALENDLY}`,
      ].join("\n"),
    }),
  });
}

// ─── MAIN TASK ────────────────────────────────────────────────

export const responseHandlerAgent = task({
  id:          "response-handler-agent",
  maxDuration: 120,

  queue: {
    name:             "claude-api-queue",
    concurrencyLimit: 2,
  },

  retry: { maxAttempts: 2, factor: 2, minTimeoutInMs: 5000 },

  run: async (payload: {
    lead_id:     string;
    reply_text:  string;
    channel:     "email" | "sms" | "linkedin";
    sequence_id: string | null;
  }) => {
    logger.info("Agent 05: Response Handler starting", {
      lead_id: payload.lead_id,
      channel: payload.channel,
    });

    // Pull lead
    const { data: lead } = await supabase
      .from("leads")
      .select("*")
      .eq("id", payload.lead_id)
      .single();

    if (!lead) throw new Error(`Lead ${payload.lead_id} not found`);

    const skills = loadSkills("vantera-brand-voice", "vantera-outreach-agent");

    // Classify reply
    const classification = await classifyReply(
      payload.reply_text,
      payload.channel,
      lead,
      skills
    );

    logger.info("Reply classified", {
      type:    classification.type,
      action:  classification.next_action,
      urgency: classification.urgency,
    });

    // Stop sequence
    await stopSequence(payload.lead_id, payload.sequence_id);

    // Update lead status
    const newStatus =
      classification.type === "unsubscribe"  ? "unsubscribed" :
      classification.type === "interested"   ? "demo_booked"  :
      "replied";

    await supabase
      .from("leads")
      .update({
        status:     newStatus,
        reply_type: classification.type,
        replied_at: new Date().toISOString(),
      })
      .eq("id", payload.lead_id);

    // Log reply
    await supabase.from("reply_log").insert({
      lead_id:        payload.lead_id,
      sequence_id:    payload.sequence_id,
      channel:        payload.channel,
      reply_text:     payload.reply_text,
      reply_type:     classification.type,
      next_action:    classification.next_action,
      response_draft: classification.response_draft,
      objection_type: classification.objection_type,
    });

    // Send response
    if (classification.response_draft && classification.type !== "unsubscribe") {
      let responseText = classification.response_draft;

      if (classification.next_action === "book_demo") {
        responseText = responseText.replace("[CALENDLY]", CALENDLY);
        if (!responseText.includes(CALENDLY)) {
          responseText += `\n\nBook a time: ${CALENDLY}`;
        }
      }

      if (payload.channel === "email") await sendEmailResponse(lead, responseText);
      if (payload.channel === "sms")   await sendSmsResponse(lead, responseText);
      // LinkedIn replies handled manually — flagged in Slack below
    }

    // Slack alert for interested replies
    if (classification.type === "interested") {
      await alertSlack(lead, payload.reply_text, payload.channel);
    }

    logger.info("Agent 05 complete", {
      lead_id:   payload.lead_id,
      type:      classification.type,
      responded: !!classification.response_draft,
    });

    return {
      type:        classification.type,
      next_action: classification.next_action,
      responded:   !!classification.response_draft,
    };
  },
});
