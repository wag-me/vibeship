#!/usr/bin/env sh
# Assembles the website into _site/ from website/ plus the repo's own assets.
# Used by .github/workflows/pages.yml; run it locally to preview:
#   sh website/build.sh && npx serve _site
# Only the website has this step: the mod itself still has no build.
set -eu
cd "$(dirname "$0")/.."

OUT=_site
rm -rf "$OUT"
mkdir -p "$OUT/assets"

cp web/icons/icon.svg web/icons/apple-touch-icon.png web/favicon.svg "$OUT/assets/"
# The demo media live on the `media` branch (the plugin directory refuses files over 5 MiB in the plugin)
git fetch -q --depth 1 origin media
for f in demo.gif demo.mp4; do git show "FETCH_HEAD:$f" > "$OUT/assets/$f"; done

# Version shown in the header, from the plugin manifest
VERSION=$(python3 -c "import json;print(json.load(open('.claude-plugin/plugin.json'))['version'])")
sed "s/{{VERSION}}/$VERSION/g" website/index.html > "$OUT/index.html"

echo "Built $OUT (v$VERSION)"
