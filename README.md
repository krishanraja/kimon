# Beside Kimon: evidence-backed cardiac care companion

A phone-first web app for a family supporting their father (67, Melbourne)
through a severe coronary artery calcification finding and the cardiology
pathway, mostly from overseas. Live at **https://laurenthermos.com**
(Vercel project `kimon`), behind a family access code.

## What it does

- **Ask**: tap the mic (or type), voice a worry, get an answer on the spot:
  urgency, what is likely going on, what to do now, what to watch for, exact
  questions for his doctor, and the evidence behind it. Grounded in his live
  record from the sheet plus `knowledge/cac-evidence-corpus.md`. Every
  concern and answer is logged to the sheet (`Notes`, tag `concern`).
- **Red flags never wait for AI**: `public/js/triage.js` is a deterministic
  rule set (heart attack, stroke, collapse, breathless at rest...) that runs
  in the browser as she types and again on the server. The model can raise
  urgency, never lower it.
- **Check-in**: six one-tap questions to ask him on a call, verdict computed
  by the sheet API (Stable / Changed / Act-now).
- **His record**: key numbers, recent concerns, cardiologist questions (tap to
  mark asked), knowledge gaps, and a one-tap brief to paste to his doctor.
- No scrolling anywhere: every screen is a card deck that fits the phone.

## Architecture

```
Phone (public/: static, no build)  --cookie-->  Vercel functions (api/)
                                                 |  login: ACCESS_CODE -> signed HttpOnly cookie (1 year)
                                                 |  canon/write: proxy with SHEET_API_SECRET (server only)
                                                 |  ask: triage -> model (AI Gateway or Anthropic) -> log
                                                 v
                              Apps Script Web App (apps-script/Code.gs)
                                                 v
                              Google Sheet "Kimon Thermos - Medical"  <-- CANON
```

The sheet is the single source of truth. The browser never sees the sheet
secret; the previous Muse build baked it into the page, this one does not.

## Vercel environment variables

| Name | Required | Notes |
|---|---|---|
| `SESSION_SECRET` | yes | 32+ random chars; signs the login cookie |
| `SHEET_API_SECRET` | yes | the `APP_SECRET` value in the deployed Apps Script |
| `ACCESS_CODE` | no | defaults to `kimon`; changing it logs everyone out |
| `SHEET_API_URL` | no | defaults to the live Apps Script `/exec` URL |
| `ANTHROPIC_API_KEY` | no | if set, Ask calls Anthropic directly |
| `AI_GATEWAY_API_KEY` | no | otherwise Vercel AI Gateway via the deployment's OIDC token |

With no AI reachable, Ask still answers from the triage rules and care guide.

## Develop

```
npm test                                   # triage rules
MOCK_SHEET=1 node scripts/dev-server.mjs   # app + fake sheet on :3000, code "kimon"
```

## Privacy: this repo is public

NEVER commit patient PII, the API secret, or the medical reports. Patient data
lives only in the sheet and is fetched at runtime behind the access code.
Profile fields like Medicare, address, phone and DOB are stripped before
anything is sent to the model.
