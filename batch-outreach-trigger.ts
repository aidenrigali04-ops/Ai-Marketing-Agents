/**
 * Batch Outreach Trigger
 * Run manually from Trigger.dev dashboard when you're ready
 * to send outreach to all leads already in the pipeline.
 *
 * HOW TO RUN:
 *   Trigger.dev → Tasks → batch-outreach-trigger → Trigger test run
 *   Leave payload empty → Submit
 *
 * OPTIONAL PAYLOAD:
 *   { "dry_run": true }          — preview without sending
 *   { "industry_filter": "hvac" } — one vertical only
 *   { "limit": 50 }              — max leads to process
 */

import { task, tasks, logger } from "@trigger.dev/sdk/v3";
import { supabase }             from "../lib/supabase-client";

const PRODUCT           = "Vantera — CRM and automation platform for service businesses";
const DELAY_BETWEEN_MS  = 45000; // 45 seconds between each lead

export const batchOutreachTrigger = task({
  id:          "batch-outreach-trigger",
  maxDuration: 3600, // 1 hour max for large batches

  retry: { maxAttempts: 1 },

  run: async (payload: {
    status_filter?:   string;
    industry_filter?: string;
    limit?:           number;
    dry_run?:         boolean;
  }) => {
    const dryRun = payload.dry_run    ?? false;
    const limit  = payload.limit      ?? 9999;

    logger.info("Batch Outreach Trigger starting", {
      dry_run:  dryRun,
      limit,
      status:   payload.status_filter   ?? "all uncontacted",
      industry: payload.industry_filter ?? "all",
    });

    // ── Leads needing profiling ──────────────────────────────
    let profileQuery = supabase
      .from("leads")
      .select("id, name, title, company, industry, company_size, pain_signals")
      .eq("status", "pending_profile")
      .limit(limit);

    if (payload.industry_filter) {
      profileQuery = profileQuery.eq("industry", payload.industry_filter);
    }

    const { data: needsProfile, error: profileErr } = await profileQuery;
    if (profileErr) throw profileErr;

    logger.info(`Leads needing profiling: ${needsProfile?.length ?? 0}`);

    // ── Leads needing outreach ───────────────────────────────
    let outreachQuery = supabase
      .from("leads")
      .select(`
        id, name, title, company, industry, company_size, pain_signals,
        lead_profiles (
          disc, awareness_level, top_triggers,
          primary_fear, ego_identity, decision_style,
          opening_hook, do_not
        )
      `)
      .in("status", ["profiled", "outreach_ready"])
      .limit(limit);

    if (payload.status_filter) {
      outreachQuery = outreachQuery.eq("status", payload.status_filter);
    }

    if (payload.industry_filter) {
      outreachQuery = outreachQuery.eq("industry", payload.industry_filter);
    }

    const { data: needsOutreach, error: outreachErr } = await outreachQuery;
    if (outreachErr) throw outreachErr;

    const readyForOutreach = (needsOutreach ?? []).filter(
      (l: any) => l.lead_profiles !== null
    );

    logger.info(`Leads ready for outreach: ${readyForOutreach.length}`);

    const total = (needsProfile?.length ?? 0) + readyForOutreach.length;

    if (total === 0) {
      logger.info("No leads to process");
      return { profiled: 0, outreach_triggered: 0, skipped: 0 };
    }

    logger.info(`Total: ${total} leads to process`, { dry_run: dryRun });

    let profiled  = 0;
    let triggered = 0;
    let skipped   = 0;

    // ── Trigger Agent 02 for unprofiledfiled leads ────────────
    for (const lead of needsProfile ?? []) {
      if (dryRun) {
        logger.info(`[DRY RUN] Would profile: ${lead.name ?? "?"} @ ${lead.company}`);
        skipped++;
        continue;
      }

      try {
        await tasks.trigger("lead-profiler-agent", {
          lead_id:      lead.id,
          name:         lead.name         ?? "",
          title:        lead.title        ?? "",
          company:      lead.company,
          industry:     lead.industry     ?? "",
          company_size: lead.company_size ?? "",
          pain_signals: lead.pain_signals ?? "",
        });

        profiled++;
        logger.info(`Profiler triggered: ${lead.company} (${profiled}/${needsProfile?.length})`);
      } catch (e) {
        logger.error(`Failed to trigger profiler: ${lead.company}`, { e });
        skipped++;
      }

      await new Promise(r => setTimeout(r, DELAY_BETWEEN_MS));
    }

    // ── Trigger Agent 03 for profiled leads ──────────────────
    for (const lead of readyForOutreach) {
      const profile = (lead as any).lead_profiles;

      if (!profile) { skipped++; continue; }

      if (dryRun) {
        logger.info(`[DRY RUN] Would send outreach: ${lead.name ?? "?"} @ ${lead.company} DISC:${profile.disc}`);
        skipped++;
        continue;
      }

      try {
        await tasks.trigger("outreach-generator-agent", {
          lead_id: lead.id,
          lead: {
            name:         lead.name         ?? "",
            title:        lead.title        ?? "",
            company:      lead.company,
            industry:     lead.industry     ?? "",
            company_size: lead.company_size ?? "",
          },
          profile: {
            disc:           profile.disc,
            awarenessLevel: profile.awareness_level,
            topTriggers:    profile.top_triggers,
            primaryFear:    profile.primary_fear,
            egoIdentity:    profile.ego_identity,
            decisionStyle:  profile.decision_style,
            openingHook:    profile.opening_hook,
            doNot:          profile.do_not,
          },
          product: PRODUCT,
        });

        triggered++;
        logger.info(`Outreach triggered: ${lead.company} DISC:${profile.disc} (${triggered}/${readyForOutreach.length})`);
      } catch (e) {
        logger.error(`Failed to trigger outreach: ${lead.company}`, { e });
        skipped++;
      }

      await new Promise(r => setTimeout(r, DELAY_BETWEEN_MS));
    }

    const summary = {
      profiler_triggered:  profiled,
      outreach_triggered:  triggered,
      skipped,
      total_processed:     profiled + triggered,
      dry_run:             dryRun,
    };

    logger.info("Batch complete", summary);
    return summary;
  },
});
