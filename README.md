# Kimon — data-backed medical copilot

A phone-only companion web app for a daughter supporting her father (67,
Melbourne) through a cardiac diagnosis and cardiology referral — from another
country. The **Google Sheet is the single source of truth**; the app reads it
on load and every interaction writes back to it.

## Architecture

```
Wife's phone (static web app, shareable link)
        |  HTTPS (secret-gated JSON)
        v
Apps Script Web App (bound to the sheet, Execute as owner, Anyone w/ secret)
        |  SpreadsheetApp
        v
Google Sheet "Kimon Thermos - Medical"  <-- CANON
  10 tabs: Meta, Profile, Conditions, Medications, TestResults,
           CheckIns, Questions, KnowledgeGaps, Notes, Changelog
```

- **Overwrite** (changelogged): Profile, Conditions, Medications, Questions,
  KnowledgeGaps — every overwrite logs old→new in Changelog.
- **Append-only**: TestResults, CheckIns, Notes, Changelog.
- The app renders instantly from a baked-in snapshot, then the sheet overwrites
  it when the API answers. Writes show saved/failed state; failures queue.

## Repo layout

- `api/apps-script/` — the API source (`Code.gs`, `appsscript.json`).
  Deploy: paste into the sheet's bound script (Extensions → Apps Script),
  Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
- `data/schema.json` — sheet schema (headers + modes). No patient data.
- `docs/API.md` — full API contract.
- `web/` — the app itself lives as a Muse web artifact (slug `companion-app`);
  see `web/README.md` for how to export it.

## Privacy — read this

This repo is **public**. NEVER commit:
- patient PII (name, DOB, Medicare, address, phone) — lives only in the sheet
- the API secret — lives only in the deployed Apps Script project and the
  server-side config; it is injected at deploy time, never stored here
- the contents of the medical reports
