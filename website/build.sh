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

cp web/icons/icon.svg web/icons/apple-touch-icon.png web/favicon.svg docs/demo.gif "$OUT/assets/"
python3 website/ascii-frames.py docs/demo.gif "$OUT/assets/demo-ascii.json"

# Version shown in the header, from the plugin manifest
VERSION=$(python3 -c "import json;print(json.load(open('.claude-plugin/plugin.json'))['version'])")
sed "s/{{VERSION}}/$VERSION/g" website/index.html > "$OUT/index.html"

echo "Built $OUT (v$VERSION)"
