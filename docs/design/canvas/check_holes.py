"""Sanity check: every `{{hole}}` in a generated board must be one the board's logic
provides. Run after build.py."""

import glob
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
KNOWN = re.compile(r"^\{\{(nav\w+|pick\w+|open\w+|close\w+|dlg|is\w+|step\d|goStep\d|st\d+|rg\d+|f\d+|a\d+|t\d+|ig\d+|yl\d+|false|true)\}\}$")
bad = 0
for path in sorted(glob.glob(os.path.join(HERE, "*.dc.html"))):
    src = open(path, encoding="utf-8").read()
    holes = set(re.findall(r"\{\{[^}]*\}\}", src))
    unknown = sorted(h for h in holes if not KNOWN.match(h))
    if unknown:
        bad += 1
        print(os.path.basename(path), unknown)
print("ok" if not bad else f"{bad} file(s) with unexpected holes")
