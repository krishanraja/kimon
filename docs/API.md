# API contract

Base: `https://script.google.com/macros/s/AKfycbx2St8EsY9-VzrOldutPJnP-1lrxW7erN14cYzjhD91Yg0lgSGiyVgagFVdSVsLecXvtA/exec`
Auth: `secret` param (GET) or `secret` field (POST). Full spec, enums and
examples: see `api/apps-script/Code.gs` (server source of truth).

- `GET ?secret=..&action=ping` → `{ok:true,time}`
- `GET ?secret=..&action=read` → full canon:
  `{meta, profile, conditions[], medications[], testResults[], checkins[],
    questions[], gaps[], notes[], changelog[last 100],
    serverTimeUTC, serverTimeMelb}`
- `POST` as `Content-Type: text/plain` with `{secret, action, by, payload}`:
  - `checkin` `{answers:{chest,breath,walking,energy,tablets,mood}, notes?}`
    → `{ok, verdict}` (Stable|Changed|Act-now; deterioration-aware)
  - `note` `{text, tag?}` → append
  - `testResult` `{date YYYY-MM-DD, test, result, lab?, notes?}` → append
  - `question` `{id?, question?, askWhom?, priority?, status?, answer?}` → upsert
  - `gap` `{id?, gap?, whatAnswersIt?, stepToClose?, status?}` → upsert
  - `profile` `{key, value}` / `condition` `{name,...}` /
    `medication` `{name,...}` → overwrite, changelogged server-side

Check-in answer enums:
chest none|sometimes|often · breath none|on-exertion|at-rest ·
walking same|less|much-less · energy normal|lower|very-low ·
tablets yes|no|not-applicable · mood ok|low|very-low
