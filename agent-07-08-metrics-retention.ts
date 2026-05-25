/**
 * Agent 07 — Metrics Analyst
 * Runs every Friday at 5pm. Pulls weekly pipeline metrics from
 * Supabase, generates a narrative report via Claude, and posts
 * to Slack with key numbers and one concrete recommendation.
 *
 * Agent 08 — Retention Agent
 * Runs on the 1st of every month. Scores all active client
 * accounts 0-100, sends check-in messages to at-risk accounts,
 * flags upsell opportunities, and posts a summary to Slack.
 *
 * Env vars shared:
 *   ANTHROPIC_API_KEY
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   SLACK_WEBHOOK_URL
 *   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER
 *   SENDGRID_API_KEY
 *   SENDGRID_FROM_EMAIL
 */

import { schedules, logger } from "@trigger.dev/sdk/v3";
import Anthropic              from "@anthropic-ai/sdk";
import { createClient }       from "@supabase/supabase-js";
import twilio                 from "twilio";
import { readFileSync }       from "fs";

const anthropic    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase     = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

function loadSkills(...names: string[]): string {
  return names.map(n => {
    try   { return readFileSync(`/mnt/skills/user/${n}/SKILL.md`, "utf8"); }
    catch { return `# ${n}\n[Skill missing]`; }
  }).join("\n\n---\n\n");
}

async function postToSlack(text: string): Promise<void> {
  if (!process.env.SLACK_WEBHOOK_URL) return;
  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ text }),
  });
}

// ══════════════════════════════════════════════════════════════
// AGENT 07 — METRICS ANALYST
// ══════════════════════════════════════════════════════════════

export const metricsAnalystAgent = schedules.task({
  id:   "metrics-analyst-agent",
  cron: "0 17 * * FRI",   // Friday 5pm

  run: async () => {
    logger.info("Agent 07: Metrics Analyst starting");

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Pull all metrics in parallel
    const [
      newLeads,
      qualifiedLeads,
      outreachSent,
      replies,
      interestedReplies,
      demosBooked,
      closedWon,
      closedLost,
      unsubscribes,
      harvestRuns,
    ] = await Promise.all([
      supabase.from("leads").select("id", { count: "exact", head: true })
              .gte("created_at", weekAgo),
      supabase.from("leads").select("id", { count: "exact", head: true })
              .gte("created_at", weekAgo).gte("score", 40),
      supabase.from("sequence_steps").select("id", { count: "exact", head: true })
              .eq("status", "sent").gte("sent_at", weekAgo),
      supabase.from("reply_log").select("reply_type")
              .gte("classified_at", weekAgo),
      supabase.from("reply_log").select("id", { count: "exact", head: true })
              .eq("reply_type", "interested").gte("classified_at", weekAgo),
      supabase.from("leads").select("id", { count: "exact", head: true })
              .eq("status", "demo_booked").gte("updated_at", weekAgo),
      supabase.from("leads").select("id", { count: "exact", head: true })
              .eq("status", "closed_won").gte("updated_at", weekAgo),
      supabase.from("leads").select("id", { count: "exact", head: true })
              .eq("status", "closed_lost").gte("updated_at", weekAgo),
      supabase.from("leads").select("id", { count: "exact", head: true })
              .eq("status", "unsubscribed").gte("updated_at", weekAgo),
      supabase.from("harvest_log").select("leads_inserted, leads_found, leads_duped")
              .gte("run_at", weekAgo),
    ]);

    const totalReplies      = replies.data?.length                  ?? 0;
    const totalOutreach     = outreachSent.count                    ?? 0;
    const totalNewLeads     = newLeads.count                        ?? 0;
    const totalInserted     = harvestRuns.data?.reduce((s, r) => s + (r.leads_inserted ?? 0), 0) ?? 0;
    const totalFound        = harvestRuns.data?.reduce((s, r) => s + (r.leads_found    ?? 0), 0) ?? 0;
    const replyRate         = totalOutreach > 0
                                ? ((totalReplies / totalOutreach) * 100).toFixed(1)
                                : "0.0";
    const interestRate      = totalReplies > 0
                                ? (((interestedReplies.count ?? 0) / totalReplies) * 100).toFixed(1)
                                : "0.0";
    const demoToCloseRate   = (demosBooked.count ?? 0) > 0
                                ? (((closedWon.count ?? 0) / (demosBooked.count ?? 0)) * 100).toFixed(1)
                                : "0.0";

    const metricsBlock = `
WEEKLY METRICS (${new Date(weekAgo).toLocaleDateString()} – today)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Discovery:    ${totalFound} leads found · ${totalInserted} inserted · ${totalNewLeads} qualified
Outreach:     ${totalOutreach} steps sent · ${totalReplies} replies · ${replyRate}% reply rate
Interest:     ${interestedReplies.count ?? 0} interested (${interestRate}% of replies)
Pipeline:     ${demosBooked.count ?? 0} demos booked · ${closedWon.count ?? 0} closed won · ${closedLost.count ?? 0} lost
Unsubscribes: ${unsubscribes.count ?? 0}
Demo→Close:   ${demoToCloseRate}%
`.trim();

    logger.info("Metrics collected", { replyRate, interestRate, closedWon: closedWon.count });

    // Generate narrative with Claude
    const skills = loadSkills("vantera-brand-voice");
    const response = await anthropic.messages.create({
      model:      "claude-sonnet-4-20250514",
      max_tokens: 600,
      system:     skills,
      messages: [{
        role:    "user",
        content: `You are the Vantera growth analyst. Generate a concise Friday pipeline report for the team.

Raw metrics:
${metricsBlock}

Write 3-4 short paragraphs of plain text (no markdown headers, no bullet points):
1. Overall pulse — are we on track for $40k MRR?
2. What's working this week
3. The biggest bottleneck and why
4. One specific action to take next week (be concrete)

Keep it direct and honest. This is an internal team report.`,
      }],
    });

    const narrative = response.content.filter(b => b.type === "text").map((b: any) => b.text).join("");

    const slackMessage = `📊 *Vantera Weekly Pipeline Report — ${new Date().toLocaleDateString()}*

\`\`\`
${metricsBlock}
\`\`\`

${narrative}`;

    await postToSlack(slackMessage);
    logger.info("Agent 07 complete — report posted to Slack");

    return { reply_rate: replyRate, closed_won: closedWon.count, demos: demosBooked.count };
  },
});

// ══════════════════════════════════════════════════════════════
// AGENT 08 — RETENTION AGENT
// ══════════════════════════════════════════════════════════════

export const retentionAgent = schedules.task({
  id:   "retention-agent",
  cron: "0 9 1 * *",   // 1st of every month, 9am

  run: async () => {
    logger.info("Agent 08: Retention Agent starting");

    const skills = loadSkills("vantera-brand-voice", "vantera-retention-upsell");

    // Pull all active paying accounts
    const { data: accounts, error } = await supabase
      .from("accounts")
      .select("id, name, plan, mrr, slug")
      .eq("status", "active");

    if (error) throw error;
    if (!accounts || accounts.length === 0) {
      logger.info("No active accounts to process");
      return;
    }

    logger.info(`Processing ${accounts.length} accounts`);

    const results = { thriving: 0, healthy: 0, watch: 0, at_risk: 0, upsell_flags: 0 };

    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo    = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo   = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const reportMonth     = new Date().toISOString().substring(0, 7);

    for (const account of accounts) {
      // Pull activity signals for this account
      const [logins, automations, records, staffUsers, portalViews] = await Promise.all([
        supabase.from("user_sessions").select("id", { count: "exact", head: true })
                .eq("account_id", account.id).gte("created_at", fourteenDaysAgo),
        supabase.from("automation_runs").select("id", { count: "exact", head: true })
                .eq("account_id", account.id).gte("created_at", sevenDaysAgo),
        supabase.from("records").select("id", { count: "exact", head: true })
                .eq("account_id", account.id).neq("stage", "closed"),
        supabase.from("users").select("id", { count: "exact", head: true })
                .eq("account_id", account.id),
        supabase.from("portal_sessions").select("id", { count: "exact", head: true })
                .eq("account_id", account.id).gte("created_at", thirtyDaysAgo),
      ]);

      // Calculate health score
      let score = 0;
      if ((logins.count       ?? 0) > 0)  score += 20;
      if ((automations.count  ?? 0) > 0)  score += 20;
      if ((records.count      ?? 0) > 0)  score += 15;
      if ((staffUsers.count   ?? 0) > 1)  score += 10;
      if ((portalViews.count  ?? 0) > 0)  score += 5;
      // NPS and payment status would add 15 + 15 — add when those tables exist

      const healthStatus = score >= 80 ? "thriving"
                         : score >= 60 ? "healthy"
                         : score >= 40 ? "watch"
                         :               "at_risk";

      results[healthStatus as keyof typeof results]++;

      // Store retention report
      await supabase.from("retention_reports").upsert({
        account_id:           account.id,
        health_score:         score,
        health_status:        healthStatus,
        portal_logins_14d:    logins.count      ?? 0,
        automations_fired_7d: automations.count ?? 0,
        active_records:       records.count     ?? 0,
        staff_users:          staffUsers.count  ?? 0,
        report_month:         reportMonth,
      });

      // ── AT-RISK: send check-in SMS + create task ──────────
      if (healthStatus === "at_risk") {
        // Pull owner contact from accounts table
        const { data: owner } = await supabase
          .from("account_owners")
          .select("name, phone, email")
          .eq("account_id", account.id)
          .single();

        if (owner?.phone) {
          try {
            await twilioClient.messages.create({
              body: `Hey ${owner.name?.split(" ")[0] ?? "there"} — just checking in on your Vantera setup. How's everything working for you? Any questions I can help with?`,
              from: process.env.TWILIO_PHONE_NUMBER!,
              to:   owner.phone,
            });
            logger.info(`At-risk check-in SMS sent to ${account.name}`);
          } catch (e: any) {
            logger.warn(`Check-in SMS failed for ${account.name}: ${e.message}`);
          }
        }

        // Create internal task
        await supabase.from("tasks").insert({
          account_id: account.id,
          title:      `[RETENTION] At-risk — health score ${score}/100`,
          priority:   "high",
          due_date:   new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          created_by: "retention-agent",
          notes:      `Logins: ${logins.count ?? 0} | Automations: ${automations.count ?? 0} | Records: ${records.count ?? 0}`,
        });
      }

      // ── UPSELL FLAG: thriving + not on enterprise ─────────
      if (healthStatus === "thriving" && account.plan !== "enterprise") {
        results.upsell_flags++;

        // Generate personalised upsell message via Claude
        const upsellResponse = await anthropic.messages.create({
          model:      "claude-sonnet-4-20250514",
          max_tokens: 200,
          system:     skills,
          messages: [{
            role:    "user",
            content: `Write a short, casual upsell check-in message (under 60 words) for:
Account: ${account.name}
Current plan: ${account.plan} ($${account.mrr}/mo)
Health score: ${score}/100 — they are thriving
Goal: Start an upgrade conversation to ${account.plan === "starter" ? "Team ($397/mo)" : "Enterprise ($797/mo)"}
Lead with a specific win they've had, then introduce the upgrade naturally. Don't be pushy.`,
          }],
        });

        const upsellMsg = upsellResponse.content
          .filter(b => b.type === "text").map((b: any) => b.text).join("").trim();

        // Store upsell opportunity as a task
        await supabase.from("tasks").insert({
          account_id: account.id,
          title:      `[UPSELL] Upgrade opportunity — ${account.plan} → ${account.plan === "starter" ? "team" : "enterprise"}`,
          priority:   "medium",
          due_date:   new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          created_by: "retention-agent",
          notes:      upsellMsg,
        });
      }
    }

    // Post monthly summary to Slack
    const summary = `🛡 *Vantera Monthly Retention Report — ${reportMonth}*

*${accounts.length} active accounts scored:*
• Thriving (80-100): ${results.thriving}
• Healthy (60-79): ${results.healthy}
• Watch (40-59): ${results.watch}
• At-risk (<40): ${results.at_risk} ← check-in SMS sent

*${results.upsell_flags}* upsell opportunities flagged → review tasks in Supabase.`;

    await postToSlack(summary);
    logger.info("Agent 08 complete", results);
    return results;
  },
});
