# HANDOVER: for the next AI taking over

## 2026-10-16 update
- Login is one passcode from Vercel env `ACCESS_CODE` (no default in code: the
  repo is public and the old defaults were readable by anyone). After the
  code the phone picks Kimon or family. Kimon lands on `/me` with a Full
  dashboard button; family lands on the family app.
- Ask is now "Ask Leffy", a chat (`public/js/chat.js`, `public/js/leffy.js`)
  with streamed replies, predicted reply pills, voice and photos.
- Knowledge bank (`public/js/knowledge-bank.js`) distils the whole sheet;
  learned facts are `Notes` tagged `fact`. No Apps Script redeploy needed:
  everything uses the existing `note` and `testResult` actions.
- Photo of a test result: `/api/photo` and the chat read it; people confirm
  before rows are written.
- `scripts/simulate.mjs` runs a month of Kimon and family use through the real
  Code.gs in an emulator and checks every row. Run it after any change to the
  data layer.

## 2026-10-13 update (supersedes "BROKEN" items below)
- App rebuilt in this repo (`public/`, `api/`) and deployed on Vercel at
  laurenthermos.com with access code login + 1-year cookie. Muse artifact is
  retired, which also retires the Android viewer and nav-overlap issues.
- Sheet secret now lives only in Vercel env `SHEET_API_SECRET` (server side).
- New: Ask (voice concern, evidence-grounded answer, logged to Notes tag
  `concern`), deterministic red-flag triage, one-tap check-ins, record deck,
  doctor brief. See README.md.
- Apps Script source moved from `api/apps-script/` to `apps-script/` (Vercel
  treats `api/` as functions). The deployed script is unchanged.

---


Date: 2026-10-13. Previous agent built all of the below; user asked to move it
to this repo and continue here.

## What this is
"Beside Kimon": a phone-only, zero-scroll, ADHD/overwhelm-friendly companion
web app for Krish's wife. Her father (67, Northcote, Melbourne) had a severe
coronary artery calcification finding (CT calcium score, Sep 2026) and is in
the cardiology referral pathway. She lives in a different country — all
caregiving is remote (phone/video). The app is a **data-backed medical
copilot**: structured check-ins with him → verdicts, a shareable brief for
clinicians, cardiologist questions, knowledge gaps, clinical perspective with
realistic dangers, reassurance. Evidence-grounded clinical guidance is wanted;
personalized prescriptions are not.

## What is DONE and verified
- [x] Sheet "Kimon Thermos - Medical" (`1Vs6UP0B9EtqOu0ZCPbFXfI-QcE5e9_Yf1Wo4scnvkww`)
      — 10 tabs created, headers frozen/styled, seeded from Aug–Sep 2026
      reports (bloods, lipids, calcium score) + 9 cardiology questions + 8
      knowledge gaps. Verified by reading back.
- [x] Apps Script API deployed and **verified live**: ping returns ok; two
      real test check-ins POSTed through it landed in the sheet with correct
      verdicts (all-baseline → "Stable"; worse walking → "Changed"); test
      rows then deleted. Code in `api/apps-script/` (secret redacted here).
- [x] Live API URL:
      `https://script.google.com/macros/s/AKfycbx2St8EsY9-VzrOldutPJnP-1lrxW7erN14cYzjhD91Yg0lgSGiyVgagFVdSVsLecXvtA/exec`
      (An earlier deployment URL `.../AKfycbwa7V8A44CZqxLUZE2y8UvBMWpENl_0R5FkHsmBFNPBX3UpfeLiIhngwdPGB34p_aXJbw/exec`
      is dead — wrong project, never had the code. Ignore it.)
- [x] App rebuilt against the API (Muse web artifact, slug `companion-app`).
      Reads sheet on load; check-ins/notes append; honest sync state.
- [x] A real symptom report from the patient (Oct 13: orthostatic dizziness a
      few seconds a couple of times/week; very mild palpitations, not weekly;
      exertional breathlessness sometimes) logged to sheet Notes
      (tag `symptom-report`). Note: dizziness-on-standing is NOT in his
      reports — new info for the GP.

## What is BROKEN / disputed — start here
1. **Android viewer shows "Something went wrong"** (user-reported, twice).
   That text exists nowhere in the app — it is the phone viewer's own load-
   failure screen. Prime suspect was boot-path stalls (render-blocking Google
   Fonts + unbounded sheet fetch on load); fix shipped: app renders from
   baked-in snapshot first, fonts async with fallbacks, sheet sync deferred
   with safety timer, all requests time-bounded (9s read / 15s save). Sandbox
   audit passed, but the Android viewer could not be reproduced — user says
   still broken. Next step: reproduce on a real phone; check whether the
   viewer is loading a cached/published copy (see 3); consider that the
   viewer itself may be at fault.
2. **Buttons underlapping the bottom nav** (user screenshot, check-in
   screen). Fix shipped (72px + safe-area clearance, verified in audit) but
   user said "you didnt bother fixing the UX" — treat as unverified, re-check
   on a real phone at 360x640.
3. **Share state**: the public link
   `https://muse.ai/s/companion-app-eb6mxv6xvxuvzi` may serve an older
   published build; newer builds need `artifact.share` to republish (only on
   the user's explicit request).

## Secrets map (values NOT in this repo — public!)
- API secret: in the deployed Apps Script project (Script Properties /
  hardcoded `APP_SECRET`), and at `~/workspace/companion-app-data/.app_secret`
  on the build machine. Inject at deploy; never commit.
- Sheet access for automation: via the connected Google Sheets connector on
  the build machine (`hatch_gws_cli sheets ...`).
- API code with secret baked: `~/workspace/companion-app-data/apps-script/Code.deploy.gs`
  (local only, do not publish).

## Key files on the build machine (~/workspace)
- `companion-app-data/seed.json` — full seed WITH patient data (private, never commit)
- `companion-app-data/API.md` — API contract + app requirements used for builds
- `companion-app-data/README.md` — deploy/test notes
- `user/files/` — the medical reports (private, never commit)
- App source: Muse artifact slug `companion-app`; export via artifact.export
  (static) to get a single HTML file.

## Immediate next steps
1. Fix the Android load failure (see Broken #1) — this is the top priority.
2. Re-verify nav clearance on a real phone (Broken #2).
3. Republish the share link once the user confirms (needs his explicit ask).
4. Ongoing: every new report/check-in goes to the sheet (append vs overwrite
   per `data/schema.json`); the app regenerates Brief/Summary/What-Next from
   canon at load, so it gets smarter as data grows.
