"""Write every artboard (`*.dc.html`) and `canvas.json` for the START-SYS design canvas.

    python3 docs/design/canvas/build.py

Then seed and check the canvas page (see README.md). Boards live in `boards_public.py`,
`boards_admin.py`, `boards_other.py`; each exposes `BOARDS = {name: (html, w, h)}`.
"""

from __future__ import annotations

import importlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

PAGES = [
    ("public", "Public & auth", "boards_public"),
    ("admin", "Admin", "boards_admin"),
    ("officer-rr", "Officer & RR", "boards_other"),
    ("components", "Shared", "boards_components"),
]

NOTES = {
    "public": [
        ("note-public", "Public & auth — drafted from the Figma Landing, Admin Login and [FINAL] Membership Application frames.\n\nAssumed: Poppins; light theme only; landing pill goes to /apply and a small link to /login; footer email is a placeholder until the org picks one; social icons are placeholders until URLs exist."),
        ("note-login", "Login — the Figma 'Forgot password?' link is omitted: the app has no self-service reset (recovery links are admin-sent, ADR 0004). Open question for a later ADR."),
        ("note-apply", "Apply — four steps with Next and Back (Ethan, 2026-09-08). Fields follow the designer's [FINAL] frame: no address block. The current code is one long page and still collects street address, city, province and postal code — the step form and the dropped fields are both code changes to settle before PR 1. 'Region' is kept because approval needs it. The 'What being a START member promises' card is deferred until the CCDO supplies copy."),
        ("note-privacy", "Privacy notice — rewritten in plain words for a college reader, no version line, no lawyer note. The wording here replaces docs/privacy/PRIVACY_NOTICE.md in PR 1 once Ethan and the CCDO approve it."),
    ],
    "admin": [
        ("note-admin", "Admin — the Figma Dashboard frame supplies the shell (white sidebar, pill nav, gradient active pill, SIGN OUT at the bottom, page title bar). Every screen keeps the app's current nav links, labels, columns and actions; only the look changes.\n\nNav pills, filter chips, tabs and dialogs are clickable inside each board."),
    ],
    "officer-rr": [
        ("note-officer", "Officer & Regional Representative — read-only surfaces. Officers see the directory columns only (no contact data); the RR sees their own region's contacts through the audited view."),
    ],
    "components": [
        ("note-components", "Shared — the brand sheet: exact logo colours, the gradient wordmark, buttons, inputs, badges and alerts every board is built from."),
    ],
}


def main() -> None:
    artboards = []
    annotations = []
    pages = []
    y = 0
    gap_x, gap_y = 120, 200
    per_row = 4
    for page_id, page_name, module_name in PAGES:
        try:
            mod = importlib.import_module(module_name)
        except ModuleNotFoundError:
            print(f"skip {module_name} (not written yet)")
            continue
        boards = getattr(mod, "BOARDS")
        pages.append({"id": page_id, "name": page_name})
        # sticky notes above the first row
        for i, (nid, text) in enumerate(NOTES.get(page_id, [])):
            annotations.append({"id": nid, "x": i * 720, "y": -200, "w": 640, "text": text, "page": page_id})
        y = 0
        x = 0
        row_h = 0
        n = 0
        for name, (html_src, w, h) in boards.items():
            fname = f"{name}.dc.html"
            with open(os.path.join(HERE, fname), "w", encoding="utf-8") as f:
                f.write(html_src)
            if n and n % per_row == 0:
                y += row_h + gap_y
                x = 0
                row_h = 0
            artboards.append({"file": fname, "x": x, "y": y, "w": w, "h": h, "page": page_id, "is_interactive": True})
            x += w + gap_x
            row_h = max(row_h, h)
            n += 1
        print(f"{page_id}: {n} boards")
    canvas = {"artboards": artboards, "annotations": annotations, "pages": pages, "launch": {"view": "canvas", "page": pages[0]["id"]}}
    with open(os.path.join(HERE, "canvas.json"), "w", encoding="utf-8") as f:
        json.dump(canvas, f, indent=2)
    print(f"wrote {len(artboards)} artboards, canvas.json")


if __name__ == "__main__":
    main()
