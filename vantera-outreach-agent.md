---
name: vantera-outreach-agent
description: >
  Outreach strategy, sequence timing, DISC-to-channel mapping, opening hook rules,
  objection handling scripts, and demo booking flow for Vantera's cold outreach agents.
  Used by: Lead Profiler (02), Outreach Generator (03), Follow-up Sequencer (04), Response Handler (05).
  Core principle: every message leads with the prospect's specific pain, not Vantera's features.
  The sequence has ONE goal: book a 20-minute demo call.
---

# Vantera Outreach Agent

## Core principle

Every outreach message must:
1. Lead with their specific pain (not a generic pain)
2. Prove you understand their world (vertical-specific language)
3. Ask for ONE thing only: a 20-minute call

Never pitch features. Pitch outcomes. Never describe Vantera. Describe the prospect's future.

---

## Sequence timing

### Email sequence
| Step | Day | Purpose | Length |
|---|---|---|---|
| Email 1 | 0 | Hook — their specific pain | < 100 words |
| Email 2 | 3 | Case study from their vertical | < 120 words |
| Email 3 | 7 | Breakup + scarcity / permission | < 80 words |

### LinkedIn sequence
| Step | Day | Purpose | Length |
|---|---|---|---|
| Connection request | 0 | No pitch — shared interest hook | < 300 chars |
| DM 1 | 2 | Value lead — insight or resource | < 400 chars |
| DM 2 | 5 | Soft CTA — reference email sent | < 350 chars |

### SMS sequence
| Step | Day | Purpose | Length |
|---|---|---|---|
| SMS 1 | 1 | Curiosity hook | ≤ 140 chars |
| SMS 2 | 5 | Social proof + CTA | ≤ 155 chars + opt-out |

---

## DISC-to-channel priority map

| DISC type | Channel 1 | Channel 2 | Channel 3 | Tone |
|---|---|---|---|---|
| D (Dominant) | Email | SMS | LinkedIn | Direct. ROI first. No rapport. Bottom line in sentence 1. |
| I (Influential) | LinkedIn | Email | SMS | Story + vision + social proof. High energy. |
| S (Steady) | Email only | — | LinkedIn (late) | Trust + safety. Zero pressure. Long delays between steps. |
| C (Conscientious) | Email | LinkedIn | Never SMS first | Data + methodology. Precise. Show research. |

**S-type note:** Do NOT send SMS to S-types until they've replied to at least one email.
**C-type note:** Do NOT use casual language or humor. Be methodical and specific.

---

## Opening hook rules (non-negotiable)

**NEVER start with:**
- "I" (as first word)
- "My name is"
- "I hope this finds you well"
- "I wanted to reach out"
- "Vantera" (product name in first sentence)
- "I came across your profile"
- "Quick question" (overused, signals mass email)

**ALWAYS:**
- Reference something specific: their reviews, a job posting, a recent LinkedIn post,
  seasonal timing for their vertical, or a vertical-specific pain point
- First sentence should make them think "how do they know that?"
- Use their first name once — not twice, not in the subject line

**Opening hook formulas by vertical:**

HVAC:
> "Most HVAC owners I talk to lose 2–3 calls a week they never know about."

Landscaping:
> "February is when landscaping companies decide if this season will be better than last."

Property Management:
> "Your tenants submitted 4 maintenance requests this week. Your vendor knows about 2 of them."

Construction:
> "The most common reason construction projects lose referrals isn't the work — it's the silence between updates."

Real Estate:
> "A lead that doesn't get a response in 5 minutes is 80% less likely to convert. Most brokerages respond in 47 hours."

---

## Subject line formulas

High-performing patterns for service business owners:

- Question with a number: "Do you know how many calls you missed last week?"
- Vertical-specific pain: "HVAC owners and missed calls"
- Intrigue with specificity: "What [CompanyName] customers say when they leave"
- Direct: "20 minutes → [specific outcome for their vertical]"
- Peers: "How [similar company] added $4k/mo in recurring revenue"

**Avoid:** "Following up," "Quick question," "Checking in," "Partnership opportunity,"
"I'd love to connect," any subject line > 50 characters

---

## Email 2 — vertical case study templates

Each case study must include:
- Business type + size (specific, not generic)
- One specific problem they had
- One specific outcome with a number
- The time it took

**HVAC example:**
> "An HVAC owner in Phoenix — 8 techs, mostly residential — was losing an average of 4 calls/day
> when his team was in the field. After setting up automated text-back, he closed 9 jobs in the
> first month that came from those previously-missed calls. That's roughly $6,800 in revenue he
> would have lost."

**Landscaping example:**
> "A landscaping company in Nashville sent 0 quote follow-ups manually — it just didn't happen.
> We set up a 3-step email + text sequence to fire automatically when an estimate was sent.
> Their close rate on estimates went from 22% to 41% in 60 days."

---

## Objection handling scripts

| Objection | Response |
|---|---|
| "We already use [Jobber/ServiceTitan/HubSpot]" | "Makes sense — most teams do. The main thing we do differently is the white-label client portal and the stage-aware automations. Are those things you've had to build manually in [tool]?" |
| "Not interested" | "Totally fair. Can I ask — is it the timing or just not the right fit for where you're at?" |
| "Too expensive" | "Understood. For context — one missed job for an HVAC company is usually $400–$800. If the text-back catches 2 extra calls a month, it pays for itself. But I get it if the math doesn't work right now." |
| "We're too small" | "That's actually where the Starter plan is built for — solo or with 1-2 techs. Keeps it simple, no setup complexity." |
| "Send me info" | "Happy to. What's most relevant for you — the automation side, the client portal, or the missed call piece?" (prevent ghosting by getting a specific answer first) |
| "Call me" | Respond immediately with 2 specific time slots + Calendly link as backup |
| "Not a good time" | "No problem — when would be better? I'll put something in the calendar for then." |

---

## Demo booking flow

Triggered on any positive reply (interest confirmed):

1. **Acknowledge briefly** — 1 sentence max
2. **Offer 2 specific time slots** — never send an open calendar link first
   - "Are you free [Day, Time] or [Day, Time]?"
3. **Include Calendly as backup** — "Or grab any open slot here: [link]"
4. **Set expectation** — "It's 20 minutes. I'll show you exactly how [their vertical] teams use it."
5. **Confirm 24h before** — automated SMS reminder: "Just confirming our call tomorrow at [time] — [Calendly link] if you need to reschedule."

---

## Sequence stop triggers

Stop all outreach immediately if:
- Any reply received (any reply — hand to Response Handler Agent 05)
- "Unsubscribe," "remove me," "stop," "opt out" detected in reply
- Email hard bounce (update `leads.status = 'bounced'`)
- LinkedIn connection request declined twice
- Lead already exists in Supabase `accounts` table (already a customer)

---

## Reply classification (for Agent 05)

| Reply type | Signal words | Action |
|---|---|---|
| Interested | "yes," "interested," "tell me more," "let's chat," "book," "call" | Trigger demo booking flow |
| Soft interest | "maybe," "possibly," "later," "follow up in X" | Schedule follow-up at requested time |
| Objection | "too expensive," "already have," "not interested" | Run objection handler + ask clarifying question |
| Wrong person | "not my decision," "contact [name]" | Thank + ask for referral + update lead record |
| Unsubscribe | "remove," "stop," "unsubscribe," "not interested at all" | Stop immediately, update `leads.status = 'unsubscribed'` |

---

## Vantera-specific talking points (use in any channel)

- **Missed call text-back:** "Most HVAC owners lose 2–3 jobs a week to missed calls. We text back in 90 seconds automatically — most clients see a direct ROI in week one."
- **White-label portal:** "Your clients see your logo, your colors, your brand on every update — not ours. It looks like you built it."
- **Stage automation:** "When a job moves to 'Completed,' it automatically sends an invoice link and a review request — no one has to remember to do it."
- **Maintenance plans / renewals:** "Landscaping companies typically add $3–5k/mo in recurring revenue once the automated renewal sequence is running."
- **Setup time:** "Most teams are live in a day. It's not a 3-month implementation."
