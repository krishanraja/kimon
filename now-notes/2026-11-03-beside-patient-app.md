# 2026-11-03: Beside, the patient's own app rebuilt around one repeat action

**Status:** built on branch `claude/epic-feynman-bd1048`. It is waiting on Krish's design approval, which has not been given yet. Not deployed. The Apps Script change has not been redeployed.

**What changed**
- **The patient app now has three tabs: Today, Health and Medicines.** "I feel unwell" is in the header on every screen. Every screen has one primary action, sitting just above the tabs.
  - **Today** shows a week strip with each day's top number and a tablets mark, plus a Today card.
  - **Health** shows a 30-day chart (his own average, no invented zones), plus readings, a photo of a result, the weekly check, and the full record with Leffy.
  - **Medicines** shows the one list: taking, not sure yet, stopped. A correction is one decision followed by a "Save this change?" step.
- **Blood pressure is typed in on a keypad,** with a time that defaults to now and can be changed. Numbers that look swapped or unusual are checked but never altered. The confirmation screen says Saved only after the server confirms. Corrections and "not a real reading" keep the original row.
- **Writes are once-only.** Every write carries a stable opId, and Apps Script refuses a repeat (an Ops tab, plus a lock and a cache). The phone keeps a write before sending it. Its states are saved, queued, auth (kept until login), rejected or unsafe.
- **Medicines have one list,** the Medications tab, read by the patient app, the family editor, the doctor summary and Leffy. The family's older care-plan list and chat-learned facts stay "not confirmed". Leffy reads the confirmed list first. A medicine missing from the list is not taken to mean he doesn't take it. The list is not taken to mean today's dose was taken.
- **Readings feed one stream** for the family results card, the knowledge bank and Leffy. Duplicates add nothing, and a correction replaces the reading everywhere.
- **A photographed BP monitor reading** is filed as "Blood pressure".

**Evidence**
- 98 unit tests and 31/31 simulation checks pass.
- Real-app renders pass 60/60 layout checks: 20 states at 360x560, 375x548 and 390x664. The checks cover no scroll, at most one primary, targets at least 44px, and no cut-off titles.
- At 200% zoom the page scrolls instead of clipping. Keyboard focus reaches the primary action.

**Waiting on Krish**
- Design approval.
- Push.
- Apps Script redeploy. On first use this adds MeasuredAt/Id/Supersedes columns and an Ops tab to the live sheet.
- Vercel deploy.

**Next step:** with approval, deploy, then watch whether Kimon returns on his own over two weeks. The usability test script is in the release report and has not been sent.

**North Star check:** this targets "times a week Kimon adds something himself" directly, because his daily BP reading is now a 3-tap entry. The number is not measured yet (U4). `weeklyKimonEntries` now exists to count it from server-attributed rows. Until Kimon uses the deployed app, the number has not moved.

**Known limits, not fixed here**
- Anyone with the family passcode can choose "I'm Kimon", which skews attribution.
- `readCanon` returns only the last 100 Changelog rows.
- Photo reading accuracy is unmeasured.
