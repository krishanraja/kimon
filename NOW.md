---
repo: krishanraja/kimon
product: Beside
as_of: 2026-11-23
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

## Where it is right now (as of 2026-11-23)

<!-- north-star-state {"week_of": "2026-11-16", "week_target": 2, "current": 16, "current_as_of": "2026-11-23", "current_source": "Live sheet rows attributed to Kimon by the server, counted by weeklyKimonEntries rules (read via the Google Sheets connector)", "urgency": 1, "urgency_reason": "at or above this week's target"} --> **North Star number: U1, on pace.** 16 of 2, ahead by 14. Times a week Kimon adds something to Beside himself: 16 entries on 6 days in the week of 16 November (2 of them double taps, fixed now). He logged blood pressure on 19 of the 20 days from 4 to 23 November. This week (target 2) has 3 so far. One proposal a week that would raise the ceiling.

Lifecycle: live. The detail is in `README.md`.

## What changed recently

- 2026-11-23 **For my doctor, exact tablets, and the record moves on after an appointment.** Usage audit of the live sheet: daily use, but the tablet tick recorded a test-only medicine as daily, double taps wrote two rows, and the record froze at the 16 November appointment with no result. Kimon's Health tab now has "For my doctor": his numbers and the questions worth asking next, worked out from gaps in his record. Leffy and the family brief use the same list. A one-time "What's new" sheet tells him. See `now-notes/2026-11-23-for-my-doctor.md`.

- 2026-11-08 **Usage audit: what Kimon enters now reaches the family, Leffy and his own screens.** He was re-saving each medicine unchanged every day instead of ticking his tablets, which recorded nothing; the tablets row now ticks them, and an unchanged medicine is logged as checked. The family tab shows his readings, his 7-day average, his streak and how readings compare since his last medicine change. Loose ends in his record become one-tap quick questions on his Today screen. See `now-notes/2026-11-08-usage-audit.md`.

- 2026-11-03 **Kimon's app rebuilt around one repeat action: typed-in blood pressure, one medicines list, once-only saving.** In production. The Apps Script redeploy is done: readings have saved to the sheet since 4 November. See `now-notes/2026-11-03-beside-patient-app.md`.

- 2026-10-23 **The North Star now has a number, a weekly ladder and an urgency rating.** Ruling (Krish, 2026-10-23): every repository chases one aggressive number on a weekly ladder, and urgency U1 to U5 sets how hard it pushes. The number is in `docs/NORTH_STAR.md`; contract: ai-harness `contract/north-star-metric.md`.

## What is next and what is waiting on Krish

- Live since 23 Nov (krishanraja/kimon#15). Kimon sees "What's new" on his next open. The first real photo of a result is the check that the real model fills Leffy's read.
- The cardiologist's letter of 17 Nov is filed in his record (see the now-note). When measuring the week of 23 Nov, leave out the `doc-20261117-*` rows: Krish filed them for him.
- Watch the sheet for his answer to the appointment question, and a photo of the angiogram result.
- Watch for `doctor-asked` notes: the sign his doctor visits are using the list.
- Measure the North Star again on Monday 30 November (target 3).
- North Star check (2026-11-23): holds.

## Read next

- `docs/NORTH_STAR.md`: the North Star, its number and its weekly ladder.
- `README.md`: what this repository is and how it runs.

## Do not trust

Nothing at the moment.
