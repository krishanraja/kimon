# Web app source

The app ("Beside Kimon") is a Muse **web artifact** (slug `companion-app`),
not a file in this repo — artifacts are built and versioned by the agent
runtime, not by git.

To get a standalone copy of the current build into this repo:

1. In a Muse session with artifact tools: `artifact.export` with
   `slug: "companion-app"` → writes a single self-contained HTML file.
2. Copy it here as `web/beside-kimon.html`.

To continue developing it: use `artifact.edit` on slug `companion-app`
(described verbatim change requests), then re-export.

Build requirements (must hold on every iteration):
- Phone-only, zero scroll (fixed viewport, paged screens), one thing per
  screen, big tap targets, minimal text, calming, visual.
- Renders fully from the baked-in snapshot with NOTHING external on the
  critical path (fonts async + system fallbacks; sheet sync deferred until
  after first paint with a safety timer; all API calls time-bounded with
  offline fallback). This was the fix for the Android viewer load failure.
- Every screen reserves bottom clearance (nav height + safe-area) — no
  control may underlap the bottom nav.
- Reads the sheet API on load (URL + secret injected at build time);
  check-ins/notes append; honest sync state; failed writes queue visibly.
