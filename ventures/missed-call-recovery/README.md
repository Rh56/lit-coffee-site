# Missed-Call Recovery — service business in a box

A productized service for home-service contractors: when a call to their
business number goes unanswered, the caller gets a text back in seconds, an
AI qualifies the job, and a finished ticket lands with the owner.

Sold at $497/mo. Built once, configured per client.

## What's here

| File | What it is |
|---|---|
| `PLAYBOOK.md` | Pricing, call script, objection handling, build architecture, compliance rules, scaling sequence. Read §1 first — carrier registration timing governs everything you can promise. |
| `callback-demo.html` | The sales asset. Source for the published demo — an interactive simulation of a missed call becoming a booked job, plus an ROI calculator. |

## Deliberately not in this repo

The prospect list — real business names, emails, and phone numbers — is kept
out of version control, in line with `.githooks/pre-commit`, which refuses
commits containing real contact details. That file lives locally as
`LEHIGH-VALLEY-OUTREACH.md`.

Everything in `callback-demo.html` uses the 555-01xx fiction range and a
made-up business name, so it passes the same check.

## Status

- [x] Market research and niche selection
- [x] Demo built and published
- [x] First 10 prospects qualified (Lehigh Valley, PA)
- [x] Outreach emails drafted
- [ ] Emails sent
- [ ] A2P 10DLC brand registered — **start this early, it gates go-live by weeks**
- [ ] One-page service agreement
- [ ] The system itself (Twilio webhook → qualification loop → ticket delivery)
- [ ] First client
