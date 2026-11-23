# 2026-11-23: For my doctor, exact tablets, and the record moves on after an appointment

**Status:** merged to main in krishanraja/kimon#15 and live (production serves `whats-new.js` and `for-doctor.js` with the photo changes, checked 23 Nov). A follow-up PR retires questions a specialist's review answers. No Apps Script redeploy is needed.

**What the live sheet showed (read-only audit, 23 November)**
- Kimon uses it every day: he logged blood pressure on 19 of the 20 days from 4 to 23 November (he missed one) and ticked his tablets with nearly every reading.
- **The tablet tick saved every medicine marked current**, including one he had said he takes only before a test. So the record showed it as taken daily for a week.
- **Double taps wrote two rows** (three days). The Today row and the button each ticked, and each disabled only itself. Stats were unaffected; the North Star count was inflated by two.
- **The record froze at the 16 November appointment.** The date passed with no result, no change of stage, and the appointment gap still "booked". The one quick question about it had been answered once and never came back.
- **His doctor brief left out what he records himself**: three weeks of home blood pressure since a medicine stopped, his tablets and his check-ins. It existed only in the family app.
- His use has narrowed to reading plus tablets. There has been no Leffy chat since 4 November, and only two of three weekly check-ins were done.
- His own answers show **ambiguous advice from his doctors**: he requested the angiogram himself, the stress test images were "not 100% clear", there's a cholesterol goal but no re-check recorded since the statin started, and no review plan.

**What changed**
- `dailyMeds()` (`public/js/meds-model.js`): the tick records only medicines taken every day. "When needed", "Short course" and "Before a test or procedure" are left out. The Today row names exactly what one tap ticks, the toast repeats it in full, and one shared guard means one tap writes one row. The late "did you take them?" tick uses the same rule.
- Blood pressure "since a medicine change" ignores changes to test-only medicines (`public/js/metrics.js`).
- **After an appointment date passes**, one quick question asks "do you have the results?" (`public/js/quick-checks.js`):
  - "Yes" closes the appointment gap and goes straight to "Photo of the results".
  - "Still waiting" asks again a week later.
  - "It was moved" records that. The deployed sheet refuses an empty date, so the family sets the new date from his record screen.
- **For my doctor** (`public/js/for-doctor.js`, Health tab):
  - His numbers: home blood pressure average and range, and since a medicine change; tablets ticked X of Y days; check-ins; medicines; where the appointment stands.
  - Questions to ask, each shown only when his record has the gap it closes. Each is grounded in the corpus's "Questions for the cardiologist":
    1. What the angiogram showed, especially the left main and LAD.
    2. When cholesterol is re-checked against his goal, and the next step if it is above.
    3. Whether he is being treated for prevention or for coronary disease, and why aspirin.
    4. His home blood pressure since the medicine stopped.
    5. Who reviews him, and when.
  - Each question has a "why it matters" line, and "I asked this" hides it (note tag `doctor-asked`, shown in the family feed and Leffy's bank).
  - "Share with my doctor" sends the whole page as text.
- Leffy's context carries his numbers and the same question list, with an instruction to start from it when he asks what to do next or reports vague advice. The family brief adds "From his own records" and "Questions he is bringing", and no longer shows a past appointment as upcoming.
- **What's new** (`public/js/whats-new.js`): a one-time bottom sheet with Leffy, two cards ("For my doctor" with "Show me", and "Tablets, exactly") and "Got it".
  - Close it with ×, Escape or a tap outside. It is seen once per item, per phone, and is never shown on a brand-new phone or to the family.
  - It traps focus, respects reduced motion, and works in light and dark.
  - Rule in README: any change he would notice adds one item.

**Evidence**
- 131/131 unit tests pass (7 new in `test/for-doctor.test.js`, invented data only). 33/33 simulation checks pass.
- Real-app run against the emulator, with an invented record shaped like the live sheet, at 360x560 (light) and 390x664 (dark):
  - What's new appears on first open, with no overflow; "Show me" opens For my doctor, and it does not appear after a reload.
  - Tapping the tablets row and the button together wrote **one** `meds-taken` row, without the test-only medicine.
  - With today's reading in, the quick question is the appointment. "Yes" closed G4 and opened the photo step.
  - "I asked this" wrote a `doctor-asked` note.
  - No page scroll on Health, For my doctor, the question page or Your numbers. No console errors.
  - The family brief includes his numbers and questions, and the test-only Medicare value did not leak.
- Nothing was written to the live sheet from this session.

**Next step:** Krish merges and deploys. Then watch the sheet for his appointment answer, a photo of the angiogram result, and `doctor-asked` notes.

**North Star check:** 16 entries by Kimon on 6 days in the week of 16 November, against a target of 2 (U1, on pace). This change aims at the second line, "his cardiologist finds his notes useful", by putting his own numbers and the right questions in front of his doctor.

**Same day, later: photo of a result, and the cardiologist's letter filed**
- Photo of a result now: real upload progress; one model call returns the rows plus Leffy's read (meaning, urgency, one question for the doctor); findings and red-flag rules set an urgency floor the model cannot lower; scan reports are filed one row per artery plus CAD-RADS and the Impression word for word; a Saved screen; Leffy's read saved as a `result-read` note. The real model has not been tested on a photo yet: the first real photo after the deploy is the check.
- Ruling (Krish, 2026-11-23): file the cardiologist's letter of 17 Nov (with the CT angiogram, stress echo and echo reports) as if Kimon uploaded it, and bring his record up to date with it, the rosuvastatin dose included.
- Written to the live sheet through the Google Sheets connector, attributed to Kimon with notes "From a PDF, read by AI": 10 TestResults rows (ids `doc-20261117-1` to `-10`), one `result-read` note, Questions Q4, Q5, Q6, Q7 answers, G4 closed, pathway stage "Treatment plan", Rosuvastatin 20 mg, and 8 Changelog rows. Read back after writing.
- **North Star caution:** those rows carry source Kimon, so this week's counter will include them. Exclude the `doc-20261117-*` rows and the 23 Nov 13:00Z notes and changes when measuring the week of 23 November.
- His For my doctor page now asks only what the letter leaves open: his cholesterol re-check against the new goal (LDL under 1.5) and why daily aspirin is right for him.
