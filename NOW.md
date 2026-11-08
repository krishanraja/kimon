---
repo: krishanraja/kimon
product: Beside
as_of: 2026-10-23
head: 817008c
lifecycle: live
production_url: none
state_doc: README.md
history_log: docs/history/LOG.md
truth_files: [docs/NORTH_STAR.md]
authority_order: [docs/NORTH_STAR.md, README.md]
steward: https://github.com/krishanraja/ai-harness/blob/main/docs/steward/RUNBOOK.md
---

# Beside: where it is right now

## What it is

Beside: a phone-first app that helps a family support their father through a cardiology pathway, mostly from overseas.

## Who it is for and why it matters for Mindmake

One family. It shows what an evidence-first companion app looks like when the stakes are personal.

## Where it is right now (as of 2026-11-08)

<!-- north-star-state {"week_of": "2026-11-02", "week_target": 1, "current": 44, "current_as_of": "2026-11-08", "current_source": "Live sheet rows attributed to Kimon by the server, counted with weeklyKimonEntries", "urgency": 1, "urgency_reason": "at or above this week's target"} --> **North Star number: U1, on pace.** 44 of 1, U1, ahead by 43. Times a week Kimon adds something to Beside himself: 44 entries on 5 separate days in the week of 2 November, including a blood pressure reading every day from 4 to 8 November. Next week's target is 2. One proposal a week that would raise the ceiling.

Lifecycle: live. The detail is in `README.md`.

## What changed recently

- 2026-11-08 **Usage audit: what Kimon enters now reaches the family, Leffy and his own screens.** He was re-saving each medicine unchanged every day instead of ticking his tablets, which recorded nothing; the tablets row now ticks them, and an unchanged medicine is logged as checked. The family tab shows his readings, his 7-day average, his streak and how readings compare since his last medicine change. Loose ends in his record become one-tap quick questions on his Today screen. See `now-notes/2026-11-08-usage-audit.md`.

- 2026-11-03 **Kimon's app rebuilt around one repeat action: typed-in blood pressure, one medicines list, once-only saving.** In production. The Apps Script redeploy is done: readings have saved to the sheet since 4 November. See `now-notes/2026-11-03-beside-patient-app.md`.

- 2026-10-23 **The North Star now has a number, a weekly ladder and an urgency rating.** Ruling (Krish, 2026-10-23): every repository chases one aggressive number on a weekly ladder, and urgency U1 to U5 sets how hard it pushes. The number is in `docs/NORTH_STAR.md`; contract: ai-harness `contract/north-star-metric.md`.

## What is next and what is waiting on Krish

- After the deploy, Kimon settles seven loose ends in his record himself, one tap each. Check the sheet once he has opened the app.
- Measure the North Star number again on Monday 16 November (target 2).
- North Star check (2026-10-23): holds.

## Read next

- `docs/NORTH_STAR.md`: the North Star, its number and its weekly ladder.
- `README.md`: what this repository is and how it runs.

## Do not trust

Nothing at the moment.
