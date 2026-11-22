#!/bin/bash
# Installs the Playwright Chromium used by the headless extraction layer
# (lib/headless.js). Browser binaries land in the user cache
# (~/.cache/ms-playwright, ~170MB) — NEVER inside the repo.
set -e
cd "$(dirname "$0")/.."
if [ ! -d node_modules/playwright ]; then
  echo "Installing npm dependencies (includes playwright)…"
  npm install
fi
echo "Installing Playwright Chromium into the user cache…"
npx playwright install chromium
echo "Headless browser ready. The detect-video API will use it automatically"
echo "as a last-resort extraction stage (disable with VDT_HEADLESS=0)."
