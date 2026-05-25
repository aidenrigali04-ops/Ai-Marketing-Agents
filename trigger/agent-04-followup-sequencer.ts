/**
 * Agent 04 — Follow-up Sequencer
 * Runs daily at 8am. Finds all sequence_steps due today,
 * sends via the right channel (Instantly / Twilio / Expandi),
 * and marks each step complete. Skips leads that have replied.
 *
 * Env vars:
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   INSTANTLY_API_KEY
 *   EXPANDI_API_KEY
 *   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER
 */

import { schedules, logger } from "@trigger.dev/sdk/v3";
import { supabase } from "../lib/supabase-client";
import twilio                from "twilio";

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// ─── SEND VIA INSTANTLY ───────────────────────────────────────
// Force-sends an email via Instantly's manual send endpoint
// Used for follow-ups that Instantly's sequence didn't cover

async function sendViaInstantly(step: any, lead: any): Promise<boolean> {
  const res = await fetch("https://api.instantly.ai/api/v1/emails/send", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key:        process.env.INSTANTLY_API_KEY,
      to:             lead.email,
      from:           process.env.INSTANTLY_FROM_EMAIL,
      subject:        step.subject,
      body:           step.content?.replace("[First Name]", lead.name?.split(" ")[0] ?? "there"),
      campaign_id:    process.env.INSTANTLY_CAMPAIGN_ID,
      reply_to_thread: true,    // keep same thread as email 1
    }),
  });

  if (!res.ok) {
    logger.warn(`Instantly send failed for step ${step.id}: ${res.status}`);
    return false;
  }
  return true;
}

// ─── SEND VIA TWILIO (SMS) ────────────────────────────────────

async function sendViaTwilio(step: any, lead: any): Promise<boolean> {
  if (!lead.phone) {
    logger.warn(`No phone for lead ${lead.id} — skipping SMS step`);
    return false;
  }

  try {
    await twilioClient.messages.create({
      body: step.content?.replace("[First Name]", lead.name?.split(" ")[0] ?? "there"),
      from: process.env.TWILIO_PHONE_NUMBER!,
      to:   lead.phone,
    });
    return true;
  } catch (e: any) {
    logger.warn(`Twilio send failed for step ${step.id}: ${e.message}`);
    return false;
  }
}

// ─── SEND VIA EXPANDI (LINKEDIN) ─────────────────────────────
// Triggers manual message send for a prospect already in campaign

async function sendViaExpandi(step: any, lead: any): Promise<boolean> {
  if (!lead.linkedin_url) {
    logger.warn(`No LinkedIn URL for lead ${lead.id} — skipping LinkedIn step`);
    return false;
  }

  const res = await fetch(
    `https://api.expandi.io/api/v1/campaigns/${process.env.EXPANDI_CAMPAIGN_ID}/messages/send`,
    {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${process.env.EXPANDI_API_KEY}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        linkedin_url: lead.linkedin_url,
        message:      step.content?.replace("[First Name]", lead.name?.split(" ")[0] ?? "there"),
      }),
    }
  );

  if (!res.ok) {
    logger.warn(`Expandi send failed for step ${step.id}: ${res.status}`);
    return false;
  }
  return true;
}

// ─── MAIN CRON ────────────────────────────────────────────────

export const followUpSequencerAgent = schedules.task({
  id:   "follow-up-sequencer-agent",
  cron: "0 8 * * *",   // daily 8am

  run: async () => {
    logger.info("Agent 04: Follow-up Sequencer starting");

    const now = new Date().toISOString();

    // All pending steps due now or earlier, with lead data joined
    const { data: steps, error } = await supabase
      .from("sequence_steps")
      .select(`
        *,
        leads (
          id, name, email, phone, linkedin_url, status
        )
      `)
      .eq("status", "pending")
      .lte("send_at", now)
      .order("send_at", { ascending: true })
      .limit(200);   // safety cap per run

    if (error) throw error;
    if (!steps || steps.length === 0) {
      logger.info("No follow-ups due — done");
      return { sent: 0, skipped: 0 };
    }

    logger.info(`${steps.length} steps due`);

    let sent    = 0;
    let skipped = 0;
    let failed  = 0;

    for (const step of steps) {
      const lead = (step as any).leads;

      // Skip if lead has replied or unsubscribed
      if (!lead || ["replied", "unsubscribed", "bounced", "closed_won", "closed_lost"]
          .includes(lead.status)) {
        await supabase
          .from("sequence_steps")
          .update({ status: "skipped", skip_reason: `lead_status:${lead?.status}` })
          .eq("id", step.id);
        skipped++;
        continue;
      }

      // Skip if no contact info for this channel
      if (step.channel === "email"    && !lead.email)        { skipped++; continue; }
      if (step.channel === "sms"      && !lead.phone)        { skipped++; continue; }
      if (step.channel === "linkedin" && !lead.linkedin_url) { skipped++; continue; }

      // Send via appropriate channel
      let success = false;
      try {
        if (step.channel === "email")    success = await sendViaInstantly(step, lead);
        if (step.channel === "sms")      success = await sendViaTwilio(step, lead);
        if (step.channel === "linkedin") success = await sendViaExpandi(step, lead);
      } catch (e) {
        logger.error(`Step ${step.id} threw unexpectedly`, { e });
        failed++;
        continue;
      }

      // Mark step result
      await supabase
        .from("sequence_steps")
        .update({
          status:  success ? "sent" : "failed",
          sent_at: success ? new Date().toISOString() : null,
          skip_reason: success ? null : "send_failed",
        })
        .eq("id", step.id);

      if (success) sent++;
      else failed++;

      // Small delay between sends to avoid rate limits
      await new Promise(r => setTimeout(r, 300));
    }

    logger.info("Agent 04 complete", { sent, skipped, failed });
    return { sent, skipped, failed };
  },
});
