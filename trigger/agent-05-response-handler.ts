/**
 * Agent 05 — Response Handler
 * Triggered by the /api/webhooks/reply route when Instantly,
 * Twilio, or Expandi detect a reply.
 * Classifies the reply via Claude, stops the sequence,
 * sends an appropriate response, and routes interested
 * leads to a demo booking confirmation.
 *
 * Env vars:
 *   ANTHROPIC_API_KEY
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER
 *   INSTANTLY_API_KEY
 *   CALENDLY_LINK  (e.g. https://calendly.com/vantera/demo)
 *   TEAM_EMAIL     (e.g. team@vantera.app — shown as sender)
 */

import { task, logger } from "@trigger.dev/sdk/v3";
import Anthropic         from "@anthropic-ai/sdk";
import { supabase } from "../lib/supabase-client";
import twilio            from "twilio";
import { readFileSync }  from "fs";

const anthropic    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const CALENDLY = process.env.CALENDLY_LINK ?? "https://calendly.com/vantera/demo";

function loadSkills(...names: string[]): string {
  return names.map(n => {
    try   { return readFileSync(`/mnt/skills/user/${n}/SKILL.md`, "utf8"); }
    catch { return `# ${n}\n[Skill missing]`; }
  }).join("\n\n---\n\n");
}

// ─── CLASSIFY REPLY ───────────────────────────────────────────

interface Classification {
  type:           "interested" | "soft_interest" | "objection" | "wrong_person" | "unsubscribe";
  next_action:    "book_demo" | "schedule_followup" | "handle_objection" | "get_referral" | "stop";
  response_draft: string | null;
  objection_type: string | null;
  urgency:        "high" | "medium" | "low";
  time_slot_ask?: string;
}

async function classifyReply(
  replyText: string,
  channel:   string,
  lead:      any,
  skills:    string
): Promise<Classification> {
  const response = await anthropic.messages.create({
    model:      "claude-sonnet-4-20250514",
    max_tokens: 800,
    system: `${skills}

Classify this sales reply and generate an appropriate response.
Respond ONLY with valid JSON:
{
  "type": "interested | soft_interest | objection | wrong_person | unsubscribe",
  "next_action": "book_demo | schedule_followup | handle_objection | get_referral | stop",
  "response_draft": "your reply under 80 words, or null if stopping",
  "objection_type": "price | timing | competitor | size | null",
  "urgency": "high | medium | low",
  "time_slot_ask": "suggested availability ask if booking demo, or null"
}

If type is 'interested': response_draft should confirm enthusiasm + offer 2 specific time slots + Calendly link.
If type is 'objection': use objection handling scripts from the skill file.
If type is 'soft_interest': acknowledge + set a specific follow-up time.
If type is 'wrong_person': thank them + ask for the right person's contact.
If type is 'unsubscribe': do not generate a response_draft (null).

Always sound like a real person, not a bot.`,
    messages: [{
      role:    "user",
      content: `Lead: ${lead.name}, ${lead.title} at ${lead.company} (${lead.industry})
Channel: ${channel}
Their reply: "${replyText}"`,
    }],
  });

  const raw = response.content
    .filter(b => b.type === "text")
    .map(b => (b as any).text)
    .join("");

  return JSON.parse(raw.replace(/```json|```/g, "").trim()) as Classification;
}

// ─── STOP SEQUENCE ────────────────────────────────────────────

async function stopSequence(leadId: string, sequenceId: string | null): Promise<void> {
  // Cancel all pending steps
  if (sequenceId) {
    await supabase
      .from("sequence_steps")
      .update({ status: "cancelled", skip_reason: "lead_replied" })
      .eq("sequence_id", sequenceId)
      .eq("status", "pending");
  }

  // Also cancel by lead_id as backup
  await supabase
    .from("sequence_steps")
    .update({ status: "cancelled", skip_reason: "lead_replied" })
    .eq("lead_id", leadId)
    .eq("status", "pending");

  logger.info("Sequence stopped", { lead_id: leadId });
}

// ─── SEND RESPONSE (EMAIL) ────────────────────────────────────

async function sendEmailResponse(lead: any, body: string): Promise<void> {
  if (!lead.email) return;

  const res = await fetch("https://api.instantly.ai/api/v1/emails/reply", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key:  process.env.INSTANTLY_API_KEY,
      to:       lead.email,
      body:     body.replace("[First Name]", lead.name?.split(" ")[0] ?? "there"),
      reply_to_thread: true,
    }),
  });

  if (!res.ok) logger.warn(`Instantly reply failed: ${res.status}`);
  else logger.info("Email reply sent", { email: lead.email });
}

// ─── SEND RESPONSE (SMS) ─────────────────────────────────────

async function sendSmsResponse(lead: any, body: string): Promise<void> {
  if (!lead.phone) return;
  try {
    await twilioClient.messages.create({
      body: body.replace("[First Name]", lead.name?.split(" ")[0] ?? "there"),
      from: process.env.TWILIO_PHONE_NUMBER!,
      to:   lead.phone,
    });
    logger.info("SMS reply sent", { phone: lead.phone });
  } catch (e: any) {
    logger.warn(`Twilio reply failed: ${e.message}`);
  }
}

// ─── MAIN TASK ────────────────────────────────────────────────

export const responseHandlerAgent = task({
  id:    "response-handler-agent",
  retry: { maxAttempts: 2, factor: 2, minTimeoutInMs: 2000 },

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

    // Pull lead + profile
    const { data: lead } = await supabase
      .from("leads")
      .select("*, lead_profiles(*)")
      .eq("id", payload.lead_id)
      .single();

    if (!lead) throw new Error(`Lead ${payload.lead_id} not found`);

    const skills = loadSkills("vantera-brand-voice", "vantera-outreach-agent");

    // Classify the reply
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

    // Stop the sequence immediately (for all reply types)
    await stopSequence(payload.lead_id, payload.sequence_id);

    // Update lead status
    const newStatus = classification.type === "unsubscribe" ? "unsubscribed"
                    : classification.type === "interested"  ? "demo_booked"
                    : "replied";

    await supabase
      .from("leads")
      .update({
        status:     newStatus,
        reply_type: classification.type,
        replied_at: new Date().toISOString(),
      })
      .eq("id", payload.lead_id);

    // Log the classified reply
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

    // Send response if we have one (not for unsubscribes)
    if (classification.response_draft && classification.type !== "unsubscribe") {
      // Inject Calendly link if booking a demo
      let responseText = classification.response_draft;
      if (classification.next_action === "book_demo") {
        responseText += `\n\nBook directly: ${CALENDLY}`;
      }

      if (payload.channel === "email")    await sendEmailResponse(lead, responseText);
      if (payload.channel === "sms")      await sendSmsResponse(lead, responseText);
      // LinkedIn replies are handled manually (flagged in Slack via Agent 07)
    }

    // Alert team for high-urgency interested replies via Slack
    if (classification.type === "interested" && process.env.SLACK_WEBHOOK_URL) {
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `🔥 *Interested reply* from *${lead.name}* (${lead.title} @ ${lead.company})\n*Channel:* ${payload.channel}\n*Their message:* "${payload.reply_text}"\n*Response sent.* Calendly link included.\n*Lead:* <https://your-supabase-dashboard/leads/${lead.id}|View lead>`,
        }),
      });
    }

    logger.info("Agent 05 complete", {
      lead_id:    payload.lead_id,
      type:       classification.type,
      responded:  !!classification.response_draft,
    });

    return {
      type:       classification.type,
      next_action: classification.next_action,
      responded:  !!classification.response_draft,
    };
  },
});
