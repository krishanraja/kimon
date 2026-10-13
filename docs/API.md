# API contract

## App API (Vercel, same origin, cookie auth)

- `POST /api/login {code}` sets `kimon_session` (HttpOnly, Secure, 1 year). `DELETE /api/login` logs out.
- `GET /api/session` returns `{authed, sheetConfigured, ai}` or 401.
- `GET /api/canon` returns the whole sheet canon (shape below).
- `POST /api/write {action, payload, by}` proxies one sheet write (actions below).
- `POST /api/ask {concern, by}` returns `{triage, answer, contacts, source, saved}`;
  `answer` = `{urgency, headline, whatItLikelyMeans, doNow[], watchFor[],
  askTheDoctor[], evidence[{point, ref, title, url}], usedFromRecord[], limits}`.

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
