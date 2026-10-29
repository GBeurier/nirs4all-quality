#!/usr/bin/env bash
# Build the app and publish app/dist to the `gh-pages` branch of the repo.
# The UI and aggregate bindings are pinned npm packages. The Vite build still
# uses nirs4all-web/web-app's staged WASM files, so this runs locally.
# The built dist/ is fully self-contained.
set -euo pipefail
cd "$(dirname "$0")/.."   # → app/

REPO_URL="${QN_REPO_URL:-https://github.com/GBeurier/nirs4all-quality.git}"

echo "Building…"
npm run build

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git clone --quiet --single-branch --branch gh-pages --depth 1 "$REPO_URL" "$TMP/pages"
git -C "$TMP/pages" rm -r -q -- .
cp -r dist/. "$TMP/pages/"
touch "$TMP/pages/.nojekyll"
echo "quali.nirs4all.org" > "$TMP/pages/CNAME"

cd "$TMP/pages"
git add -A
if ! git diff --cached --quiet; then
  git -c user.name="dunkean" -c user.email="14640805+dunkean@users.noreply.github.com" commit -q -m "chore(pages): deploy qualified Quality application"
  git push origin gh-pages
fi

echo "Deployed → https://quali.nirs4all.org/"
