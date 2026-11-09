# 2026-11-08: Usage audit, what Kimon enters now reaches every screen

**Status:** merged to main in krishanraja/kimon#12 and live in production (Vercel build of `cd1c808` is READY; `quick-checks.js` serves from www.laurenthermos.com). No Apps Script redeploy is needed.

**What the live sheet showed (read-only audit, 8 November)**
- Kimon has saved a blood pressure reading every day from 4 to 8 November, all through the app, all attributed to him by the server. Once-only saving works: no duplicate rows.
- **His daily tablets ritual was being lost.** After each reading he opened Medicines and re-saved each medicine unchanged. The sheet ignores a save with no change, so it left no row anywhere a reader could see. His tablets were ticked only once (4 November), so the family saw "1/7 days tablets taken" and his week strip showed no ticks.
- **The family tab never showed his readings,** and "last seen" counted only notes, so it ran days behind. Its "days he did his one thing" stat was stuck at 0/7: his current app has no way to log a habit.
- The family feed said "Nothing from Kimon yet" while he was logging every day.
- Medicines he described in his own notes could not be added: the pick list had no entry for them, and no time option for a short course or a pre-scan dose.

**What changed**
- Today: while tablets are still to do, tapping the tablets row ticks them (the same save as the button). Once ticked, it opens the list.
- Medicines: confirming a medicine with no change now saves a visible "checked" note (`med-checked`) instead of a silent no-op.
- One shared function, `bpInsight` in `public/js/metrics.js`: latest reading, 7-day average and range, days in a row, and the average since the last medicine status change compared with before it. Facts only, no zones.
- Family tab: a blood pressure card (latest, 7-day average, streak, since-change line) and a "days with a reading" stat. The habit stat hides unless a habit was logged. "Last seen" now counts readings, check-ins and record changes. With nothing to flag, one quiet line replaces the empty feed card.
- Kimon's Saved screen: days in a row, his 7-day average once he has three readings, and his next appointment countdown inside 14 days.
- Leffy's knowledge bank carries the same lines.
- The North Star counter also counts his answers, gap closures and profile changes, once per save.
- The medicine pick list adds four medicines and two times ("Short course", "Before a test or procedure").

**Evidence**
- 123/123 unit tests pass (14 new in `test/insight.test.js` and `test/quick-checks.test.js`, invented data only).
- Quick questions walked end to end in the real app at 360x560: all seven fit with no scroll, every answer target is at least 44px tall, and the emulated sheet showed the expected Medications, KnowledgeGaps, Questions and Notes rows. 33/33 simulation checks pass.
- Real-app run against the emulator with an invented copy of the live sheet's shape: tapping the tablets row writes `meds-taken`; an unchanged medicine writes `med-checked`; the Saved screen reads "5 days in a row. Your 7-day average is 123/79. Your appointment is in 8 days." Family tab renders with no page scroll and no clipping at 360x560 and 390x664.

**Loose ends Kimon now settles himself, one tap each (`public/js/quick-checks.js`)**
Once today's reading and tablets are done, Today's main button becomes "One quick question". **At most one a day** (Ruling, Krish, 2026-11-09: one per day, not a batch), tablets first because those days slip from memory soonest. Three or four plain answers, one tap saves and returns to Today, and "Skip for now" hides it until tomorrow. Each question is worked out from the sheet on every load, so it disappears as soon as anyone settles it, and nothing is asked twice: days he already answered about are never asked again (a `quick-check` note records each answer).
1. A medicine listed "When needed" asks when he takes it. "Only before a test or scan" sets that time on the list.
2. A medicine he named in his own notes but not on the list asks, in his own word for it, whether he takes it now. The answer adds it as taking, finished or not sure.
3. An open cardiology appointment gap asks whether he has seen the heart specialist. "Yes" closes it.
4. Two open doctor questions (medicine changes, how often reviewed) offer one-tap answers. The medicine-changes answer offers the change already on his list.
5. Days this week with a reading but no tablet tick ask whether he took them. "Yes, every day" ticks those days, marked as ticked later; "I missed some" stays honest.
His answers show in the family feed and in Leffy's knowledge bank.

On the live sheet this is expected to raise seven questions, so about a week of one a day. Nothing was written to the live sheet from this session.

**Next step:** after the deploy, check the sheet each day for one new `quick-check` note; over about a week the medicines list, G4, Q4 and Q7 settle. On 16 November, check the tablets stat on the family tab moves with his daily use.

**North Star check:** 44 entries by Kimon on 5 separate days in the week of 2 November, against a target of 1 (U1, on pace). His daily tablet confirmations from 5 to 8 November left no row, so the true figure is higher. From this deploy on they are counted.
