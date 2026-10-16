# Beside: evidence-backed cardiac care companion

A phone-first web app for a family supporting their father (67, Melbourne)
through a severe coronary artery calcification finding and the cardiology
pathway, mostly from overseas. Live at **https://laurenthermos.com**
(Vercel project `kimon`), behind one family passcode (Vercel env `ACCESS_CODE`).

## Who sees what

One passcode for everyone. After it, the phone asks once who is using it:

- **Kimon** lands on his own home screen (`/me`). A "Full dashboard" button
  opens the family app (`/?full=1`), with "My home" to come back. Everything
  he adds is attributed to "Kimon" by the server, whatever the phone says.
- **Family** lands on the family app as before.

Each person picks their own name from the family list (Vercel env `PEOPLE`,
kept out of this public repo), or "Someone else" with their name and what
they call Kimon. Leffy and the app then speak to that person: Kimon hears
"you"; someone who calls him Dad hears "your dad" (and sees "Ask Dad");
someone who calls him Kim hears "Kim". Anyone not on the list hears
"Kimon" unless they pick otherwise. Each person has their own chat history.
Settings can switch a phone between people. An optional `KIMON_CODE` logs
straight in as Kimon. Changing `ACCESS_CODE` logs every phone out.

## What it does

- **Ask Leffy**: a chat with Leffy, an animated Greek-Australian heart
  helper (`public/js/leffy.js`). Type, talk, or tap a predicted reply pill.
  Replies stream in as he "talks"; each one carries urgency, what to do, what
  to watch for, questions for the doctor and its sources. Grounded in his
  live record, the knowledge bank and `knowledge/cac-evidence-corpus.md`.
  Every message and reply is logged to the sheet (`Notes`, tag `concern`).
- **Photo of a test result**: camera or photo library, from Kimon's home,
  the chat, or Results. The photo is shrunk on the phone, read by the model,
  shown back for checking, and only the confirmed rows are written to
  `TestResults` (noted "From a photo, read by AI"). Rows already in the
  record are flagged and skipped. The photo itself is not stored.
- **Knowledge bank** (`public/js/knowledge-bank.js`): rebuilt from the whole
  sheet on every read, so it never forgets older entries. Derived knowledge
  (symptom timelines, habits and tablets kept, result trends, check-in
  verdicts) plus facts Leffy learns in chats, saved one per row as `Notes`
  tagged `fact`. "What Leffy knows" lists it, and any learned fact can be
  forgotten. It is fed to every Leffy reply.
- **Red flags never wait for AI**: `public/js/triage.js` is a deterministic
  rule set (heart attack, stroke, collapse, breathless at rest...) that runs
  in the browser as she types and again on the server. The model can raise
  urgency, never lower it.
- **Check-in**: six one-tap questions to ask him on a call, verdict computed
  by the sheet API (Stable / Changed / Act-now).
- **His record**: key numbers, recent concerns, cardiologist questions (tap to
  mark asked), knowledge gaps, and a one-tap brief to paste to his doctor.
- **Dad tab (family)**: monitor what Kimon logs (alerts first, habits and
  tablets this week, his body check, what he said), send him nudges, and set
  his care plan (daily habits, tablets).
- **Kimon's own app (`/me`)**: big text. One small thing a day from the care
  plan, tick tablets, log a symptom any time (red flags show "Call 000"), a
  weekly 5-question body check designed for honest answers, "Tell the family"
  by voice, and "Photo of a result". Everything he logs is shared with family.
- Voice: recorded on the phone, transcribed on the server (OpenAI
  gpt-4o-transcribe, then whisper-1, then AI Gateway).
- No page scrolling: every screen fits the phone. The chat thread is the one
  place that scrolls, as chats do.

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
| `ACCESS_CODE` | yes | the one passcode; no default (the repo is public); changing it logs everyone out |
| `KIMON_CODE` | no | optional second code that opens straight as Kimon |
| `PEOPLE` | no | family list, JSON: `[{"name":"Kimon","aliases":["Kim"],"patient":true},{"name":"...","aliases":["..."],"calls":"Dad"}]`; `calls` is what that person calls Kimon |
| `OPENAI_API_KEY` | no | best transcription (gpt-4o-transcribe) |
| `SHEET_API_URL` | no | defaults to the live Apps Script `/exec` URL |
| `ANTHROPIC_API_KEY` | no | if set, Ask calls Anthropic directly |
| `AI_GATEWAY_API_KEY` | no | otherwise Vercel AI Gateway via the deployment's OIDC token |

With no AI reachable, Leffy still answers from the triage rules and care guide.

## Develop

```
npm test                                             # unit tests
node scripts/simulate.mjs                            # a month of Kimon + family use, checked row by row
MOCK_SHEET=1 MOCK_AI=1 node scripts/dev-server.mjs   # app on :3000, passcode "local"
```

`MOCK_SHEET=1` runs the real `apps-script/Code.gs` against an in-memory sheet
(`scripts/gas-emulator.mjs`), with Google Sheets' own typing of dates and
numbers, so local runs exercise the deployed sheet logic. `MOCK_AI=1` swaps
the model for a scripted one (`scripts/mock-ai.mjs`). Both use invented data.

## Privacy: this repo is public

NEVER commit patient PII, the API secret, or the medical reports. Patient data
lives only in the sheet and is fetched at runtime behind the access code.
Profile fields like Medicare, address, phone and DOB are stripped before
anything is sent to the model.
