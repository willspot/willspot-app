#!/usr/bin/env bash
# Regenerates app icons, splash images and the Play feature graphic from brand/logo-mark.svg
# and brand/brand.json. Run after changing the logo or colours (macOS: needs Google Chrome
# for rendering and `sips`, both local; nothing is downloaded).
#
#   mobile/tool/make_store_assets.sh
#
# Logo requirements (see docs/store/README.md): a 64x64 viewBox whose first <rect> is the
# full-size background tile (rx = corner radius); everything after it is the white mark.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$PWD
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
RES=mobile/android/app/src/main/res
IOS=mobile/ios/Runner/Assets.xcassets
STORE=docs/store/graphics
mkdir -p "$STORE"

LOGO=$(cat brand/logo-mark.svg)
read -r PRIMARY SECONDARY BG TAGLINE NAME < <(python3 -I -c '
import json; b=json.load(open("brand/brand.json")); c=b["colors"]
print(c["primary"], c["secondary"], c["background"], b["tagline"].replace(" "," "), b["name"].replace(" "," "))')
TAGLINE=${TAGLINE//$' '/ }
NAME=${NAME//$' '/ }

# Variants of the mark: square tile (iOS/Play, the stores round it), rounded tile, and the
# mark alone on transparent (Android adaptive foreground and splash).
variant() { python3 -I -c '
import re, sys
svg = open("brand/logo-mark.svg").read()
tile = re.search(r"<rect\b[^>]*/>", svg)
if not tile: sys.exit("brand/logo-mark.svg: the first element must be the background <rect .../>")
t = tile.group(0)
new = re.sub(r"\brx=\"[0-9.]+\"", "rx=\"0\"", t) if sys.argv[1] == "square" else ""
print(svg[:tile.start()] + new + svg[tile.end():])' "$1"; }
SQUARE=$(variant square)
MARK_ONLY=$(variant mark)
grep -q 'rx="0"' <<<"$SQUARE" && ! grep -q '<rect' <<<"$MARK_ONLY" || { echo "logo variants failed" >&2; exit 1; }

render() { # html-body width height out.png [transparent]
  local bgcss="${5:-transparent}"
  cat >"$TMP/p.html" <<EOF
<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:$2px;height:$3px;overflow:hidden;background:$bgcss}
svg{display:block}
</style></head><body>$1</body></html>
EOF
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check \
    --user-data-dir="$TMP/profile" --force-device-scale-factor=1 --default-background-color=00000000 \
    --window-size="$2,$3" --screenshot="$4" "file://$TMP/p.html" >/dev/null 2>&1
  test -s "$4"
}
svg_at() { # svg size [x y]
  sed -E "s/<svg /<svg width=\"$2\" height=\"$2\" style=\"position:absolute;left:${3:-0}px;top:${4:-0}px\" /" <<<"$1"
}
resize() { sips -z "$2" "$2" "$1" --out "$3" >/dev/null; }

# Masters
render "$(svg_at "$SQUARE" 1024)" 1024 1024 "$TMP/square.png" "$PRIMARY"
render "$(svg_at "$LOGO" 1024)" 1024 1024 "$TMP/rounded.png"
# Adaptive foreground: 108dp canvas, mark inside the 66dp safe zone (64/108 of the canvas).
render "$(svg_at "$MARK_ONLY" 640 192 192)" 1024 1024 "$TMP/foreground.png"
# Android 12+ splash icon: 288dp canvas (icon must fit a 192dp circle), rounded tile at 128dp.
render "$(svg_at "$LOGO" 456 284 284)" 1024 1024 "$TMP/splash12.png"

# iOS: opaque full-bleed square at every size in Contents.json (no alpha allowed).
sips -s format jpeg "$TMP/square.png" --out "$TMP/sq.jpg" >/dev/null && sips -s format png "$TMP/sq.jpg" --out "$TMP/square-opaque.png" >/dev/null
for f in "$IOS"/AppIcon.appiconset/Icon-App-*.png; do
  n=$(basename "$f" .png); spec=${n#Icon-App-}; pt=${spec%%x*}; scale=${spec##*@}; scale=${scale%x}
  px=$(python3 -I -c "print(round($pt*$scale))")
  resize "$TMP/square-opaque.png" "$px" "$f"
done

# Android legacy icons (pre-8.0) and adaptive layers (8.0+).
for d in mdpi:1 hdpi:1.5 xhdpi:2 xxhdpi:3 xxxhdpi:4; do
  dir=${d%%:*}; s=${d##*:}
  mkdir -p "$RES/mipmap-$dir" "$RES/drawable-$dir"
  resize "$TMP/rounded.png" "$(python3 -I -c "print(round(48*$s))")" "$RES/mipmap-$dir/ic_launcher.png"
  resize "$TMP/foreground.png" "$(python3 -I -c "print(round(108*$s))")" "$RES/mipmap-$dir/ic_launcher_foreground.png"
  resize "$TMP/rounded.png" "$(python3 -I -c "print(round(96*$s))")" "$RES/drawable-$dir/splash_logo.png"
  resize "$TMP/splash12.png" "$(python3 -I -c "print(round(288*$s))")" "$RES/drawable-$dir/splash_icon.png"
done

# iOS launch image (120pt).
for s in 1 2 3; do
  suffix=$([ $s = 1 ] && echo "" || echo "@${s}x")
  resize "$TMP/rounded.png" $((120 * s)) "$IOS/LaunchImage.imageset/LaunchImage$suffix.png"
done

# Store graphics: Play icon (512, opaque) and feature graphic (1024x500).
resize "$TMP/square-opaque.png" 512 "$STORE/play-icon-512.png"
render "<div style=\"width:1024px;height:500px;background:linear-gradient(135deg,$PRIMARY,$SECONDARY);display:flex;align-items:center;gap:48px;padding:0 88px;box-sizing:border-box;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#fff\">
  $(sed -E 's/<svg /<svg width="200" height="200" style="flex:none;filter:drop-shadow(0 18px 30px rgba(0,0,0,.25))" /' <<<"$LOGO")
  <div><div style=\"font-size:76px;font-weight:800;letter-spacing:-1.5px\">$NAME</div>
  <div style=\"font-size:36px;opacity:.92;margin-top:8px\">$TAGLINE</div></div></div>" 1024 500 "$TMP/feature.png"
sips -s format jpeg "$TMP/feature.png" --out "$TMP/feature.jpg" >/dev/null && sips -s format png "$TMP/feature.jpg" --out "$STORE/play-feature-1024x500.png" >/dev/null

echo "Icons, splash and store graphics written. Background colour for splash: $BG"
