import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an AI assistant for an AI Marketing CRM. You have access to a Supabase database
with the following tables:
- leads: id, name, title, company, industry, email, phone, linkedin_url, score, status, source, created_at
- lead_profiles: lead_id, disc, awareness_level, top_triggers, primary_fear, ego_identity, opening_hook
- outreach_sequences: lead_id, status, created_at
- sequence_steps: lead_id, channel, status, send_at, sent_at
- reply_log: lead_id, channel, reply_text, reply_type, classified_at
- harvest_log: source, leads_found, leads_inserted, vertical, city, run_at
- content_library: week_of, vertical, status, created_at

Answer questions about the pipeline, leads, and agents. Be specific with numbers.
When you don't have data, say so clearly. Keep answers concise and actionable.
Format numbers clearly. Use markdown for structure when helpful.`;

export async function POST(req: NextRequest) {
  try {
    const { message, context } = await req.json();
    const db = createServiceClient();

    // Fetch relevant data based on the question
    const [
      { data: leadStats },
      { data: replyStats },
      { data: harvestStats },
    ] = await Promise.all([
      db.from("leads").select("status, score, industry, source, created_at"),
      db.from("reply_log").select("reply_type, classified_at"),
      db.from("harvest_log").select("leads_inserted, leads_found, vertical, run_at").order("run_at", { ascending: false }).limit(48),
    ]);

    const statusCounts = (leadStats ?? []).reduce<Record<string, number>>((acc, l) => {
      acc[l.status] = (acc[l.status] ?? 0) + 1;
      return acc;
    }, {});

    const industryCounts = (leadStats ?? []).reduce<Record<string, number>>((acc, l) => {
      if (l.industry) acc[l.industry] = (acc[l.industry] ?? 0) + 1;
      return acc;
    }, {});

    const totalReplies   = replyStats?.length ?? 0;
    const interested     = (replyStats ?? []).filter(r => r.reply_type === "interested").length;
    const totalInserted  = (harvestStats ?? []).reduce((s, h) => s + (h.leads_inserted ?? 0), 0);

    const dataContext = `
CURRENT DATABASE STATE:
Total leads: ${leadStats?.length ?? 0}
Leads by status: ${JSON.stringify(statusCounts)}
Leads by industry: ${JSON.stringify(industryCounts)}
Total replies: ${totalReplies}
Interested replies: ${interested}
Interest rate: ${totalReplies > 0 ? ((interested / totalReplies) * 100).toFixed(1) : 0}%
Total leads harvested: ${totalInserted}
Recent harvest sources: ${[...new Set(harvestStats?.map(h => h.vertical))].join(", ")}
`;

    const response = await anthropic.messages.create({
      model:      "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system:     SYSTEM_PROMPT + "\n\n" + dataContext,
      messages: [
        ...(context ?? []),
        { role: "user", content: message },
      ],
    });

    const text = response.content
      .filter(b => b.type === "text")
      .map(b => (b as any).text)
      .join("");

    return NextResponse.json({ response: text });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
