# API contract

## App API (Vercel, same origin, cookie auth)

- `POST /api/login {code, persona?}` checks the passcode (`ACCESS_CODE`, case-insensitive) and sets
  `kimon_session` (HttpOnly, Secure, 1 year) with a role. Returns `{role, askWho}`; `askWho` means the phone
  should ask who is using it. `POST /api/login {persona: 'kimon'|'family'}` switches a logged-in phone.
  `DELETE /api/login` logs out.
- `GET /api/session` returns `{authed, role, sheetConfigured, ai}` or 401.
- `GET /api/canon` returns the whole sheet canon (shape below); chat notes come without their stored DATA.
- `POST /api/write {action, payload, by}` proxies one sheet write (actions below). A Kimon session is always
  written as "Kimon".
- `POST /api/ask {message, thread[{role:'user'|'leffy', text}], threadId, rid, by, image?{data, type}}` streams
  NDJSON: `stage` progress, `delta` reply text as it is written, one `answer`, then `learned` when new facts
  were saved. `answer` = `{urgency, reply, doNow[], watchFor[], askTheDoctor[], evidence[{point, ref, title, url}],
  usedFromRecord[], replies[], learned[{topic, fact, replaces}], results[], limits}`.
- `GET /api/answer?rid=` recovers a reply the phone missed.
- `POST /api/photo {image:{data, type}}` returns `{kind, summary, unreadable, results[{date, test, result, lab,
  notes, duplicate, dateGuessed}]}`. Saves nothing; the phone writes confirmed rows with `testResult`.

Knowledge bank facts are `note` rows tagged `fact`: `FACT: <text>\nDATA: {"topic","from","replaces?"}`, and
`FACT REMOVED: <text>\nDATA: {"removes"}` when someone taps Forget.

## Sheet API (Apps Script, server-to-server only)

Base: `https://script.google.com/macros/s/AKfycbx2St8EsY9-VzrOldutPJnP-1lrxW7erN14cYzjhD91Yg0lgSGiyVgagFVdSVsLecXvtA/exec`
Auth: `secret` param (GET) or field (POST). Source of truth: `apps-script/Code.gs`.

- `GET ?secret=..&action=ping|read`
- `POST` (`Content-Type: text/plain`) `{secret, action, by, payload}`:
  `checkin {answers:{chest,breath,walking,energy,tablets,mood}, notes?}`,
  `note {text, tag?}`, `testResult {date, test, result, lab?, notes?}`,
  `question {id?, question?, askWhom?, priority?, status?, answer?}`,
  `gap {id?, gap?, whatAnswersIt?, stepToClose?, status?}`,
  `profile {key, value}`, `condition {name, ...}`, `medication {name, ...}`

Check-in enums: chest none|sometimes|often · breath none|on-exertion|at-rest ·
walking same|less|much-less · energy normal|lower|very-low ·
tablets yes|no|not-applicable · mood ok|low|very-low
