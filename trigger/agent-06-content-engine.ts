/**
 * Agent 06 — Content Engine
 * Runs every Monday at 9am. Generates SEO blog post,
 * 5 LinkedIn posts, 2 case studies, and email newsletter.
 * Schedules LinkedIn posts via Buffer and alerts Slack.
 *
 * Env vars:
 *   ANTHROPIC_API_KEY
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   BUFFER_ACCESS_TOKEN / BUFFER_LINKEDIN_PROFILE_ID
 *   SLACK_WEBHOOK_URL
 */

import { schedules, logger } from "@trigger.dev/sdk/v3";
import Anthropic              from "@anthropic-ai/sdk";
import { supabase }           from "../lib/supabase-client";
import { readFileSync }       from "fs";
import { join }               from "path";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

// ─── VERTICAL ROTATION ───────────────────────────────────────

const VERTICALS = [
  "hvac",
  "property_management",
  "real_estate",
  "landscaping",
  "construction",
  "marketing_agency",
  "saas_agency",
];

function getThisWeeksVertical(): string {
  const weekNum = Math.ceil(new Date().getDate() / 7);
  return VERTICALS[(weekNum - 1) % VERTICALS.length];
}

// ─── GENERATE BLOG POST ───────────────────────────────────────

async function generateBlogPost(vertical: string, skills: string): Promise<string> {
  const response = await anthropic.messages.create(
    {
      model:      "claude-sonnet-4-5-20250929",
      max_tokens: 3000,
      system:     skills,
      messages: [{
        role:    "user",
        content: `Write an SEO blog post for the ${vertical} vertical targeting Vantera.

Pick the highest-priority keyword for this vertical from the content engine skill.
Follow the exact blog post structure from the skill file:
1. Hook (2-3 sentences)
2. Why this happens (150-200 words)
3. The real cost (150 words, include a $ amount)
4. The fix framework (400 words, solution-level not product-specific)
5. How Vantera handles this (250 words, concrete and specific)
6. CTA (1 sentence + [CALENDLY_LINK] placeholder)

Include at the very top:
TITLE: [the blog post title]
META: [150-160 char meta description with target keyword]
KEYWORD: [target keyword]

Write for service business owners. Short paragraphs. No jargon.`,
      }],
    },
    { timeout: 60000 }
  );

  return response.content
    .filter(b => b.type === "text")
    .map(b => (b as any).text)
    .join("");
}

// ─── GENERATE LINKEDIN POSTS ──────────────────────────────────

const FORMATS = [
  "Monday: Stat + insight. One surprising number, one-sentence insight, one takeaway. 3-4 lines. No hashtags.",
  "Tuesday: Story. A real or illustrative owner story. First sentence is specific. 6-8 lines.",
  "Wednesday: Before/after. Before [system]: [pain]. After: [specific result with number]. 5-7 lines.",
  "Thursday: Contrarian take. Challenge a common belief in the service business world. 4-6 lines.",
  "Friday: CTA. Direct offer, case study share, or tool tip. Ends with a clear next step. 4-6 lines.",
];

async function generateLinkedInPosts(vertical: string, skills: string): Promise<string[]> {
  const posts: string[] = [];

  for (const format of FORMATS) {
    const response = await anthropic.messages.create(
      {
        model:      "claude-sonnet-4-5-20250929",
        max_tokens: 400,
        system:     skills,
        messages: [{
          role:    "user",
          content: `Write one LinkedIn post for Vantera.
Vertical this week: ${vertical}
Format: ${format}
Tone: direct, peer-to-peer, no buzzwords, specific numbers.
No hashtags. Do not mention Vantera by name more than once.`,
        }],
      },
      { timeout: 30000 }
    );

    posts.push(
      response.content
        .filter(b => b.type === "text")
        .map(b => (b as any).text)
        .join("")
        .trim()
    );

    await new Promise(r => setTimeout(r, 3000));
  }

  return posts;
}

// ─── GENERATE CASE STUDIES ────────────────────────────────────

async function generateCaseStudies(vertical: string, skills: string): Promise<string[]> {
  const response = await anthropic.messages.create(
    {
      model:      "claude-sonnet-4-5-20250929",
      max_tokens: 600,
      system:     skills,
      messages: [{
        role:    "user",
        content: `Write 2 case study snippets for ${vertical} businesses.
Each must have at least one specific number (revenue, percentage, or time saved).
Follow the case study structure from the skill file.
Separate the two with ---
Keep each under 7 sentences. These will be used in outreach emails.`,
      }],
    },
    { timeout: 30000 }
  );

  const raw = response.content
    .filter(b => b.type === "text")
    .map(b => (b as any).text)
    .join("");

  return raw.split("---").map(s => s.trim()).filter(Boolean);
}

// ─── BUFFER SCHEDULING ────────────────────────────────────────

function getScheduledTime(dayOffset: number): string {
  const monday = new Date();
  monday.setDate(monday.getDate() - monday.getDay() + 1);
  monday.setHours(9, 0, 0, 0);
  monday.setDate(monday.getDate() + dayOffset);
  return monday.toISOString();
}

async function scheduleToBuffer(posts: string[]): Promise<{ scheduled: number; failed: number }> {
  let scheduled = 0;
  let failed    = 0;

  for (let i = 0; i < posts.length; i++) {
    const res = await fetch("https://api.bufferapp.com/1/updates/create.json", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        access_token:    process.env.BUFFER_ACCESS_TOKEN!,
        "profile_ids[]": process.env.BUFFER_LINKEDIN_PROFILE_ID!,
        text:            posts[i],
        scheduled_at:    getScheduledTime(i),
        now:             "false",
      }).toString(),
    });

    if (res.ok) { scheduled++; logger.info(`Buffer post ${i + 1} scheduled`); }
    else        { failed++;    logger.warn(`Buffer post ${i + 1} failed: ${res.status}`); }

    await new Promise(r => setTimeout(r, 300));
  }

  return { scheduled, failed };
}

// ─── SLACK ALERT ──────────────────────────────────────────────

async function alertSlack(vertical: string, contentId: string): Promise<void> {
  if (!process.env.SLACK_WEBHOOK_URL) return;

  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `📝 *Weekly content ready for review*\nVertical: *${vertical}*\nContent ID: \`${contentId}\`\nReview in Supabase → content_library → update status to published when ready.`,
    }),
  });
}

// ─── MAIN CRON ────────────────────────────────────────────────

export const contentEngineAgent = schedules.task({
  id:          "content-engine-agent",
  cron:        "0 9 * * MON",
  maxDuration: 900, // 15 minutes

  run: async () => {
    logger.info("Agent 06: Content Engine starting");

    const vertical = getThisWeeksVertical();
    const weekOf   = new Date().toISOString().split("T")[0];

    logger.info(`This week: ${vertical} | week of ${weekOf}`);

    const skills = loadSkills("vantera-brand-voice", "vantera-content-engine");

    logger.info("Generating blog post...");
    const blogPost = await generateBlogPost(vertical, skills);

    logger.info("Generating LinkedIn posts...");
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

    logger.info("Content stored", { id: contentData.id });

    // Schedule to Buffer
    logger.info("Scheduling to Buffer...");
    const bufferResult = await scheduleToBuffer(linkedinPosts);

    // Alert Slack
    await alertSlack(vertical, contentData.id);

    logger.info("Agent 06 complete", {
      vertical,
      blog_words:       blogPost.split(" ").length,
      linkedin_posts:   linkedinPosts.length,
      buffer_scheduled: bufferResult.scheduled,
      buffer_failed:    bufferResult.failed,
      case_studies:     caseStudies.length,
    });

    return {
      content_id:      contentData.id,
      vertical,
      linkedin_posted: bufferResult.scheduled,
    };
  },
});
