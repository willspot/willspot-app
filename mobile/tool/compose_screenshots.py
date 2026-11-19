"""Turns raw app captures into store screenshots: brand background, caption, the capture in a
rounded frame. Renders with the local Google Chrome (headless, throwaway profile).

  python3 mobile/tool/compose_screenshots.py docs/store/screenshots/android.json
  python3 mobile/tool/compose_screenshots.py docs/store/screenshots/ios.json

The JSON lists the output size, the raw-capture folder and one entry per screenshot
({"raw": "home.png", "title": "...", "subtitle": "..."}). Colours come from brand/brand.json.
"""
import html, json, os, shutil, subprocess, sys, tempfile

CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
spec_path = sys.argv[1]
spec = json.load(open(spec_path))
base = os.path.dirname(os.path.abspath(spec_path))
brand = json.load(open("brand/brand.json"))
c = brand["colors"]
W, H = spec["width"], spec["height"]
raw_dir = os.path.join(base, spec["raw"])
out_dir = os.path.join(base, spec["out"])
os.makedirs(out_dir, exist_ok=True)

tmp = tempfile.mkdtemp()
try:
    for i, s in enumerate(spec["screens"], 1):
        raw = os.path.join(raw_dir, s["raw"])
        # Device frame: 78% of the width, keeping the capture's own aspect ratio.
        fw = round(W * 0.78)
        page = f"""<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden}}
body{{background:linear-gradient(160deg,{c['primary']} 0%,{c['primaryDark']} 45%,{c['secondary']} 130%);
font-family:-apple-system,"Helvetica Neue",Helvetica,Arial,sans-serif;color:#fff;text-align:center}}
h1{{font-size:{round(W*0.068)}px;line-height:1.12;margin:{round(H*0.055)}px {round(W*0.08)}px 0;font-weight:800;letter-spacing:-0.5px}}
p{{font-size:{round(W*0.036)}px;line-height:1.35;margin:{round(H*0.015)}px {round(W*0.1)}px 0;opacity:.9}}
.frame{{position:absolute;left:{(W-fw)//2}px;top:{round(H*0.25)}px;width:{fw}px;border-radius:{round(fw*0.07)}px;
overflow:hidden;border:{max(6, round(W*0.012))}px solid #14121F;box-shadow:0 30px 80px rgba(0,0,0,.35);background:#14121F}}
.frame img{{display:block;width:100%}}
</style></head><body>
<h1>{html.escape(s['title'])}</h1><p>{html.escape(s.get('subtitle',''))}</p>
<div class="frame"><img src="file://{raw}"></div></body></html>"""
        hp = os.path.join(tmp, "p.html")
        open(hp, "w").write(page)
        out = os.path.join(out_dir, f"{i:02d}-{os.path.splitext(s['raw'])[0]}.png")
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
                        f"--user-data-dir={tmp}/profile", "--force-device-scale-factor=1",
                        f"--window-size={W},{H}", f"--screenshot={out}", f"file://{hp}"],
                       check=True, capture_output=True)
        print("wrote", os.path.relpath(out))
finally:
    shutil.rmtree(tmp, ignore_errors=True)
