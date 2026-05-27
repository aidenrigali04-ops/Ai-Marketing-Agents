/**
 * Agent 06 — Content Engine
 * Runs every Monday at 9am. Generates SEO blog post,
 * 5 LinkedIn posts, 2 case study snippets, and an email
 * newsletter draft. Schedules LinkedIn posts via Buffer
 * and stores everything in content_library.
 *
 * Env vars:
 *   ANTHROPIC_API_KEY
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   BUFFER_ACCESS_TOKEN
 *   BUFFER_LINKEDIN_PROFILE_ID
 *   SLACK_WEBHOOK_URL           (for blog post review alert)
 *   CMS_WEBHOOK_URL             (optional — POST to trigger CMS publish)
 */

import { schedules, logger } from "@trigger.dev/sdk/v3";
import Anthropic              from "@anthropic-ai/sdk";
import { supabase } from "../lib/supabase-client";
import { readFileSync }       from "fs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

import { join } from "path";

function loadSkills(...names: string[]): string {
  return names.map(n => {
    try {
      return readFileSync(join(process.cwd(), "skills", `${n}.md`), "utf8");
    } catch {
      return `# ${n}\n[Skill file not found — add to /skills/${n}.md in your repo]`;
    }
  }).join("\n\n---\n\n");
}

// ─── VERTICAL ROTATION ───────────────────────────────────────

const VERTICALS = ["hvac", "property_management", "real_estate", "landscaping", "construction",  "marketing_agency", "saas_agency];

function getThisWeeksVertical(): string {
  const weekNum = Math.ceil(new Date().getDate() / 7);
  return VERTICALS[(weekNum - 1) % VERTICALS.length];
}

// ─── GENERATE CONTENT ────────────────────────────────────────

async function generateBlogPost(vertical: string, skills: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 3000,
    system:     skills,
    messages: [{
      role:    "user",
      content: `Write this week's SEO blog post for the ${vertical} vertical.

Pick the highest-priority keyword from the content engine skill file for this vertical.
Follow the exact blog post structure from the skill file exactly:
1. Hook (2-3 sentences)
2. Why this happens (150-200 words)
3. The real cost (150 words, with a specific $ amount)
4. The fix — framework (400 words, solution-level not product-specific)
5. How Vantera handles this (250 words, specific and concrete)
6. CTA (1 sentence + [CALENDLY_LINK] placeholder)

Also include at the top:
- TITLE: [the blog post title]
- META: [150-160 char meta description including target keyword]
- KEYWORD: [target keyword]

Write for service business owners, not marketers. Short paragraphs.`,
    }],
  });
  return response.content.filter(b => b.type === "text").map((b: any) => b.text).join("");
}

async function generateLinkedInPosts(vertical: string, skills: string): Promise<string[]> {
  const FORMATS = [
    "Monday — Stat + insight: one surprising number → insight → takeaway. 3-4 lines. No hashtags.",
    "Tuesday — Story: a real or illustrative owner story. First sentence is specific. 6-8 lines.",
    "Wednesday — Before/after: 'Before [system]: [pain]. After: [result with number].' 5-7 lines.",
    "Thursday — Contrarian take: challenge a common belief in the service business world. 4-6 lines.",
    "Friday — CTA post: direct offer, case study, or tool tip. Ends with clear next step. 4-6 lines.",
  ];

  const posts: string[] = [];

  for (const format of FORMATS) {
    const response = await anthropic.messages.create({
      model:      "claude-sonnet-4-20250514",
      max_tokens: 400,
      system:     skills,
      messages: [{
        role:    "user",
        content: `Write one LinkedIn post for Vantera.
Primary vertical this week: ${vertical}
Format: ${format}
Tone: direct, peer-to-peer, no buzzwords, specific numbers where possible.
Do not use hashtags. Do not mention Vantera by name more than once (if at all).`,
      }],
    });
    posts.push(response.content.filter(b => b.type === "text").map((b: any) => b.text).join("").trim());
    await new Promise(r => setTimeout(r, 500)); // avoid rate limits
  }

  return posts;
}

async function generateCaseStudies(vertical: string, skills: string): Promise<string[]> {
  const response = await anthropic.messages.create({
    model:      "claude-sonnet-4-20250514",
    max_tokens: 600,
    system:     skills,
    messages: [{
      role:    "user",
      content: `Write 2 case study snippets for ${vertical} businesses.
Follow the case study structure from the skill file exactly.
Each must have at least one specific number (revenue, percentage, time saved).
Separate the two with ---
These will be used in outreach emails and the blog — keep them punchy and credible.`,
    }],
  });
  const raw = response.content.filter(b => b.type === "text").map((b: any) => b.text).join("");
  return raw.split("---").map(s => s.trim()).filter(Boolean);
}

// ─── BUFFER SCHEDULING ────────────────────────────────────────

function getScheduledTime(dayOffset: number): string {
  // Schedule Mon–Fri at 9am ET
  const date = new Date();
  const monday = new Date(date);
  monday.setDate(date.getDate() - date.getDay() + 1);  // this Monday
  monday.setHours(9, 0, 0, 0);
  monday.setDate(monday.getDate() + dayOffset);
  return monday.toISOString();
}

async function scheduleToBuffer(posts: string[]): Promise<{ scheduled: number; failed: number }> {
  let scheduled = 0;
  let failed    = 0;

  for (let i = 0; i < posts.length; i++) {
    const scheduledAt = getScheduledTime(i);   // Mon=0, Tue=1, ... Fri=4

    const res = await fetch("https://api.bufferapp.com/1/updates/create.json", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        access_token:        process.env.BUFFER_ACCESS_TOKEN!,
        "profile_ids[]":     process.env.BUFFER_LINKEDIN_PROFILE_ID!,
        text:                posts[i],
        scheduled_at:        scheduledAt,
        now:                 "false",
      }).toString(),
    });

    if (res.ok) {
      scheduled++;
      logger.info(`Scheduled LinkedIn post ${i + 1} for ${scheduledAt}`);
    } else {
      failed++;
      logger.warn(`Buffer scheduling failed for post ${i + 1}: ${res.status}`);
    }

    await new Promise(r => setTimeout(r, 300));
  }

  return { scheduled, failed };
}

// ─── SLACK ALERT FOR BLOG REVIEW ─────────────────────────────

async function alertTeamForBlogReview(vertical: string, contentId: string): Promise<void> {
  if (!process.env.SLACK_WEBHOOK_URL) return;
  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `📝 *Weekly content ready for review*\nVertical: *${vertical}*\nContent ID: \`${contentId}\`\nReview in Supabase → content_library table, then update status to 'published' to trigger CMS post.`,
    }),
  });
}

// ─── MAIN CRON ────────────────────────────────────────────────

export const contentEngineAgent = schedules.task({
  id:   "content-engine-agent",
  cron: "0 9 * * MON",   // every Monday 9am

  run: async () => {
    logger.info("Agent 06: Content Engine starting");

    const vertical = getThisWeeksVertical();
    const weekOf   = new Date().toISOString().split("T")[0];
    logger.info(`This week: ${vertical}, week of ${weekOf}`);

    const skills = loadSkills("vantera-brand-voice", "vantera-content-engine");

    // Generate all content in sequence (Claude rate limits)
    logger.info("Generating blog post...");
    const blogPost = await generateBlogPost(vertical, skills);

    logger.info("Generating 5 LinkedIn posts...");
    const linkedinPosts = await generateLinkedInPosts(vertical, skills);

    logger.info("Generating case studies...");
    const caseStudies = await generateCaseStudies(vertical, skills);

    // Store in Supabase
    const { data: contentData, error } = await supabase
      .from("content_library")
      .upsert({
        week_of:        weekOf,
        vertical,
        blog_post:      blogPost,
        linkedin_posts: linkedinPosts.join("\n\n---POST---\n\n"),
        case_studies:   caseStudies.join("\n\n---CASE---\n\n"),
        status:         "pending_review",
      })
      .select("id")
      .single();

    if (error) throw error;

    // Schedule LinkedIn posts via Buffer
    logger.info("Scheduling to Buffer...");
    const bufferResult = await scheduleToBuffer(linkedinPosts);

    // Alert team for blog review
    await alertTeamForBlogReview(vertical, contentData.id);

    logger.info("Agent 06 complete", {
      vertical,
      blog_words:      blogPost.split(" ").length,
      linkedin_posts:  linkedinPosts.length,
      buffer_scheduled: bufferResult.scheduled,
      buffer_failed:   bufferResult.failed,
      case_studies:    caseStudies.length,
    });

    return {
      content_id:      contentData.id,
      vertical,
      linkedin_posted: bufferResult.scheduled,
    };
  },
});
