"""Seed a throwaway canvas page that opens focused on one artboard, for a local look.

    python3 preview.py AdminDashboard   -> writes preview-AdminDashboard.html (ignored by git)
"""

import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = "/private/tmp/claude-501/bundled-skills/2.1.260/64a61522c8fa606c6f7fb7aa7af7c607/design"

board = sys.argv[1]
canvas = json.load(open(os.path.join(HERE, "canvas.json"), encoding="utf-8"))
canvas["launch"] = {"view": "focused", "file": f"{board}.dc.html"}
tmp = os.path.join(HERE, f"preview-{board}.canvas.json")
json.dump(canvas, open(tmp, "w", encoding="utf-8"))
out = f"preview-{board.lower()}.html"
args = ["node", f"{SKILL}/seed-canvas.mjs", "--template", f"{SKILL}/payload.template.html", "--out", out, "--title", "START-SYS Interface"]
for a in canvas["artboards"]:
    args += ["--artboard", a["file"]]
args += ["--image", "start-emblem.png", "--image", "start-wordmark.png", "--canvas", os.path.basename(tmp)]
res = subprocess.run(args, cwd=HERE, capture_output=True, text=True)
print((res.stdout or res.stderr)[:160])
os.remove(tmp)
