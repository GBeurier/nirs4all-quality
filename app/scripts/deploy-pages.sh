#!/usr/bin/env bash
# Build the app and publish app/dist to the `gh-pages` branch of the repo.
# The app builds against sibling checkouts (nirs4all-ui, nirs4all-web/studio-lite),
# so this runs LOCALLY (not in CI). The built dist/ is fully self-contained.
set -euo pipefail
cd "$(dirname "$0")/.."   # → app/

REPO_URL="${QN_REPO_URL:-https://github.com/GBeurier/nirs4all-quality.git}"

echo "Building…"
npm run build

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -r dist/. "$TMP/"
touch "$TMP/.nojekyll"   # let GitHub Pages serve Vite's assets/ verbatim

cd "$TMP"
git init -b gh-pages -q
git -c user.name="Gregory Beurier" -c user.email="beurier@cirad.fr" add -A
git -c user.name="Gregory Beurier" -c user.email="beurier@cirad.fr" commit -q -m "Deploy quali-nirs4all to GitHub Pages"
git push -f "$REPO_URL" gh-pages

echo "Deployed → https://gbeurier.github.io/nirs4all-quality/"
