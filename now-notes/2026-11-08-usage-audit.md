# 2026-11-08: Usage audit, what Kimon enters now reaches every screen

**Status:** built, tested and pushed to `claude/usage-audit-data-population-dng1wg`. Not merged, not deployed. Everything here ships with a normal Vercel deploy; no Apps Script redeploy is needed.

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
- 116/116 unit tests pass (7 new in `test/insight.test.js`, invented data only). 33/33 simulation checks pass.
- Real-app run against the emulator with an invented copy of the live sheet's shape: tapping the tablets row writes `meds-taken`; an unchanged medicine writes `med-checked`; the Saved screen reads "5 days in a row. Your 7-day average is 123/79. Your appointment is in 8 days." Family tab renders with no page scroll and no clipping at 360x560 and 390x664.

**Waiting on Krish (only he or Kimon can settle these in the sheet)**
1. One medicine is listed as ongoing, but Kimon's own note describes it as two doses around his scan. Its time can now be set to "Before a test or procedure".
2. A supplement Kimon named in his notes is not on the medicines list. It can now be picked.
3. Knowledge gap G4 (cardiology appointment date) is still open, though his answers say he has seen the cardiologist. Questions Q4 and Q7 are still open.
4. No tablet ticks exist for 5 to 8 November. They were not backfilled: re-saving the list is not evidence he took that day's dose.

**Next step:** Krish merges and deploys, then checks on 16 November that the tablets stat on the family tab moves with Kimon's daily use.

**North Star check:** 44 entries by Kimon on 5 separate days in the week of 2 November, against a target of 1 (U1, on pace). His daily tablet confirmations from 5 to 8 November left no row, so the true figure is higher. From this deploy on they are counted.
