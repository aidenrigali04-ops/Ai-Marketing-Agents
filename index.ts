export type LeadStatus =
  | "pending_profile"
  | "profiled"
  | "outreach_ready"
  | "in_sequence"
  | "replied"
  | "demo_booked"
  | "closed_won"
  | "closed_lost"
  | "unsubscribed"
  | "bounced";

export type DISCType = "D" | "I" | "S" | "C";

export type Industry =
  | "hvac"
  | "landscaping"
  | "construction"
  | "property_mgmt"
  | "plumbing"
  | "real_estate"
  | "agency";

export type LeadSource = "apollo" | "clay" | "vibe_prospecting" | "manual" | "csv";

export interface Lead {
  id:           string;
  name:         string | null;
  title:        string | null;
  company:      string;
  industry:     Industry | null;
  company_size: string | null;
  email:        string | null;
  phone:        string | null;
  linkedin_url: string | null;
  website:      string | null;
  pain_signals: string | null;
  score:        number;
  source:       LeadSource | null;
  status:       LeadStatus;
  sequence_id:  string | null;
  reply_type:   string | null;
  replied_at:   string | null;
  enriched_at:  string | null;
  created_at:   string;
  updated_at:   string;
}

export interface LeadProfile {
  id:              string;
  lead_id:         string;
  disc:            DISCType | null;
  awareness_level: number | null;
  top_triggers:    Trigger[] | null;
  primary_fear:    string | null;
  ego_identity:    string | null;
  decision_style:  string | null;
  opening_hook:    string | null;
  do_not:          string | null;
  profiled_at:     string;
}

export interface Trigger {
  trigger:   string;
  rationale: string;
  expert:    string;
}

export interface OutreachSequence {
  id:             string;
  lead_id:        string;
  email_sequence: string | null;
  linkedin_seq:   string | null;
  sms_sequence:   string | null;
  product:        string;
  status:         string;
  created_at:     string;
}

export interface SequenceStep {
  id:          string;
  sequence_id: string;
  lead_id:     string;
  step_number: number;
  channel:     "email" | "sms" | "linkedin";
  content:     string | null;
  subject:     string | null;
  send_at:     string;
  sent_at:     string | null;
  status:      "pending" | "sent" | "failed" | "skipped" | "cancelled";
  skip_reason: string | null;
}

export interface ReplyLog {
  id:             string;
  lead_id:        string;
  sequence_id:    string | null;
  channel:        string | null;
  reply_text:     string | null;
  reply_type:     string | null;
  next_action:    string | null;
  response_draft: string | null;
  objection_type: string | null;
  classified_at:  string;
}

export interface HarvestLog {
  id:              string;
  run_at:          string;
  source:          string | null;
  leads_found:     number;
  leads_qualified: number;
  leads_inserted:  number;
  leads_duped:     number;
  vertical:        string | null;
  city:            string | null;
  error:           string | null;
}

export interface ContentItem {
  id:             string;
  week_of:        string;
  vertical:       string;
  blog_post:      string | null;
  linkedin_posts: string | null;
  case_studies:   string | null;
  status:         "pending_review" | "approved" | "published";
  created_at:     string;
}

export interface AgentInfo {
  id:          string;
  name:        string;
  icon:        string;
  trigger:     string;
  cronLabel:   string;
  metricKey:   string;
  metricLabel: string;
  color:       string;
}

export interface PipelineSummary {
  status:       string;
  total:        number;
  high_quality: number;
  avg_score:    number;
}

export interface LeadWithProfile extends Lead {
  lead_profiles: LeadProfile | null;
}

export interface LeadDetail extends Lead {
  lead_profiles:       LeadProfile | null;
  outreach_sequences:  (OutreachSequence & { sequence_steps: SequenceStep[] }) | null;
  reply_log:           ReplyLog[];
}
