# Missed-Call Recovery — Operator Playbook

Everything that happens after someone replies. Read this before your first call, not during it.

---

## 1. The one thing that will bite you: A2P 10DLC

**Read this first because it changes your promises.**

You cannot legally send application-to-person business SMS on a US 10-digit number without registering with **A2P 10DLC** — a brand registration plus a campaign registration, submitted through your SMS provider to the carriers. This is not optional and carriers actively block unregistered traffic.

- **Brand approval:** fast. The Campaign Registry often approves a brand within minutes to ~3 days.
- **Campaign approval:** slow. Twilio's own docs say campaign review runs **10–15 days**. Some use cases clear in 2–7 business days.
- **Full carrier approval:** slower still. **Three to six weeks** is common end-to-end, because **AT&T runs an independent manual review that takes two to four weeks on its own.** Nobody can speed this up.
- **Cost:** brand registration is ~$4 (sole proprietor) to ~$48+ (standard brand), plus a **$15 campaign vetting fee**, plus roughly **$5–15/mo** ongoing on top of per-message costs.
- **Who registers:** the **client's** business is the brand. You need their legal entity name, EIN, and website. Get this on the first call.

**What this means for your pitch — say this out loud on the call:** *"Build takes me a few days. Carrier registration takes two to six weeks and it's out of everyone's hands — AT&T reviews these manually. I don't bill you until it's live."*

That last clause is the whole trick. **Don't start billing until the first text sends.** A client who paid $497 and got nothing for a month churns and tells other contractors. A client who paid nothing during the wait is just waiting. It costs you one month of revenue on client #1 and buys you a reference you can't otherwise get.

**Do this tomorrow, before you close anyone:** register your own brand and one campaign. It costs about $20 and it teaches you the form — the questions carriers ask about opt-in language are the ones you'll need to answer for every client afterward. Starting that clock now means client #1 isn't also your first-ever registration.

---

## 2. Pricing

| Tier | Monthly | What's in it |
|---|---|---|
| **Core** | **$497/mo** | Missed-call text-back, AI qualification, ticket to email/SMS, monthly report |
| **Plus** | **$797/mo** | Core + review requests after job completion + reactivation texts to old customers |
| **Setup** | **$500 one-time** | Waive it to close. It exists to be waived. |

**Why $497 and not $199:** the market for *software* is $97–299/mo, and you will lose that fight — those tools have brand recognition and a free trial. You're not selling software. You're selling **it is done, it works, and you never touch it**. Contractors pay for done. A price that sits just under $500 reads as a real service; $199 reads as another app they'll have to configure themselves.

**Never** price as a percentage of recovered revenue. It sounds fair and it's a nightmare: you'll spend every month arguing about attribution.

**First client only:** offer **$297/mo for the first 3 months, locked at $497 after, in exchange for a testimonial and permission to name them.** You need a local reference name more than you need $200. Say exactly that out loud — contractors respect the trade.

---

## 3. The call, in seven minutes

Don't demo first. Diagnose first, then demo.

**1. "How do calls get handled when everyone's on a job?"** — shut up and listen. They'll tell you the whole problem themselves.

**2. "Roughly how many calls a week do you figure you're missing?"** — they'll guess low. Fine. Take the number.

**3. "What's an average ticket for you?"** — take the number.

**4. Do the math out loud, conservatively.** "So 12 a week is about 52 a month. If we only recover 15% of those, that's 8 jobs at $480 — about $3,700." Use *their* numbers, and round down. Understating it is far more persuasive than a big claim.

**5. Now show the demo.** Screen-share it, type their business name into the field, hit Replay. Let them watch it once without narrating over it.

**6. "The honest version: carrier registration takes a week or two before we can send a single text. After that it just runs. $497 a month, cancel whenever, and I'll waive setup."**

**7. Shut up.** Whoever talks next loses. Let the silence do it.

**If they say yes,** you need before you hang up: legal business name, EIN, website, the number to forward, where tickets should go (email or a cell), their hours, their service area, and their trip/diagnostic fee. Collect it on the call — chasing it by email costs you a week.

---

## 4. Objections, with real answers

**"I already have an answering service."**
Good — those cost $2,800–4,500/mo equivalent for full coverage. This runs alongside for a fraction and catches what they drop. What does yours cost you?

**"My customers are older, they don't text."**
Fair concern, and worth testing rather than assuming. The text costs the customer nothing — if they'd rather call, they call back, and you've still put your name in front of them within 8 seconds instead of never. The ones who do text are pure upside.

**"I don't want a robot talking to my customers."**
It doesn't pretend to be a person and it doesn't close anything. It gets the address, the problem, and the urgency, then hands you a ticket. You still do all the work. I'll show you every message before it goes live and you can rewrite any of them.

**"Sounds expensive."**
Compared to what? One recovered job covers it. If it recovers less than one job a month, cancel — I don't lock anyone in.

**"Send me some information."**
Usually a soft no. Answer: "I'll do better — give me 90 seconds right now and I'll show you what your customer actually sees." If they won't, send the demo link and put them in the 4-day follow-up.

**"How do I know it's working?"**
You get a monthly report with every recovered call and what it booked. And you'll notice — your guys will start asking who booked all these jobs.

---

## 5. The build (what I do once they say yes)

One stack, every client, no exceptions. **Bespoke builds are what made this feel like a lot of work last time.** The whole model depends on client #2 through #20 being a configuration file, not a project.

```
Their existing business number
  └─ conditional call forwarding on no-answer/busy
       └─ Twilio number (per client)
            └─ webhook → your service
                 ├─ instant SMS back (<10s, templated per trade)
                 ├─ AI qualification loop (Claude API, trade-specific prompt)
                 ├─ ticket → client's email + SMS
                 └─ log → per-client dashboard
```

Per client, only these change: phone number, business name, trade template, hours, service area, ticket destination, diagnostic fee. **That's a JSON config, not a codebase.** Build it that way from client #1 or you'll be maintaining ten forks by Christmas.

Your real costs per client: Twilio number ~$1.15/mo, SMS ~$0.008 each, 10DLC ~$5–15/mo, LLM calls a few dollars. Call it **$15–25/mo against $497.** The margin is the whole point — protect it by never customizing.

**Build order:**
1. Config schema + one hardcoded client
2. Twilio inbound webhook + instant templated reply
3. Qualification loop with a trade prompt
4. Ticket delivery
5. Dashboard (last — clients ask for it, rarely open it)

Ship 1–4 and you can take a paying client. The dashboard can come in month two.

---

## 6. Scaling

The sequence that works:

**Clients 1–3: charge less, learn.** Your first client is a research project that happens to pay. Expect surprises in their call flow.

**Client 3: get the testimonial and the number.** "We booked $4,200 in jobs we'd have lost" from a named Bethlehem contractor is worth more than any demo. Now your cold emails stop being cold.

**Clients 4–10: same trade, different town.** You now know plumbing. Do not add HVAC, roofing, and garage doors at once. Take your plumbing build to Allentown, Easton, Reading, Quakertown. Same script, same config, zero new thinking.

**Client 10+: hire the sending out, not the building.** A VA sends the emails and books the calls. You take the calls and the builds. That's when it turns into real sleep-money.

**Realistic pace:** 10 clients at $497 is ~$5k MRR, which is roughly a **6–12 month** build at part-time effort. Anyone telling you 30 days is selling a course.

---

## 7. Rules that keep this legal and alive

- **Every automated text must identify the business and offer opt-out.** First message ends with "Reply STOP to opt out." Honor STOP instantly and permanently — this is TCPA, and the penalties are per-message.
- **Only text people who called you first.** Inbound callers are a defensible consent basis. Never import a purchased list into this system. Ever.
- **Don't let the AI quote firm prices or promise arrival times.** Ranges and windows only, always "subject to confirmation." A bot that promises $200 and a 6pm arrival creates an obligation your client has to eat.
- **Escalate real emergencies to a human immediately.** Gas smell, active flooding, sparking panel, no heat in a freeze → the bot's only job is to say "call 911 / shut off X" and ring the on-call human. Write these rules per trade before you go live.
- **Get it in writing.** One page: what you do, $497/mo, 30-day cancellation either side, they own their number and their customer data. You don't need a lawyer for a one-pager, but do write it down.

---

## 8. What to have me build next

Say the word and I'll do these — each is a few hours:

1. **The actual system** — Twilio webhook, config schema, qualification loop, ticket delivery. The thing you sell.
2. **A one-page contract** you can send the moment someone says yes.
3. **A second demo for a different trade** (HVAC or roofing) so you're not showing a plumbing story to a roofer.
4. **The next 40 prospects** — same qualification method, Allentown / Easton / Reading / Quakertown.
5. **A per-client dashboard** for the monthly report.

Highest value first: **#2 and #1.** If someone says yes on Tuesday and you have no contract and no system, you lose them.
