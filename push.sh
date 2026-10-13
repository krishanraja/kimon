#!/bin/bash
# Push this handover package to https://github.com/krishanraja/kimon
# Run with your own GitHub auth (gh auth login, or a remote with credentials).
set -e
cd "$(dirname "$0")"
if [ ! -d .git ]; then
  git init -b main
  git add .
  git commit -m "Kimon copilot: API, sheet schema, docs, handover package (no PII, no secrets)"
fi
git remote remove origin 2>/dev/null || true
git remote add origin https://github.com/krishanraja/kimon.git
git push -u origin main
echo "Pushed."
