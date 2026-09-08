# START-SYS design canvas

The brand restyle (2026-09-08) was drafted as a Claude Design canvas before any code was
written: one artboard per route (27), four phone-width boards for the public pages, and a
brand sheet — 32 boards. Ethan and the designer edit the published canvas in place and
**Save**; the saved canvas is the spec the code PRs are checked against.

Sources: the designer's Figma file (Landing, Admin Login, Dashboard, [FINAL] Membership
Application) and the org's logo PNGs. Copy, columns, filters and actions were read from the
app's own route and component files so every screen is the real one, restyled.

## Files

| File | What |
|---|---|
| `lib.py` | brand tokens (CSS), icons, markup helpers, the sidebar shell |
| `boards_public.py` | landing, login, reset, MFA, unauthorized, apply, renew, privacy (+ mobile) |
| `boards_admin.py` | the 15 admin routes |
| `boards_other.py` | officer directory and committees, RR region |
| `boards_components.py` | the brand sheet |
| `build.py` | writes `*.dc.html` and `canvas.json` |
| `check_holes.py` | asserts every `{{hole}}` in the output is one the board's logic provides |
| `preview.py <Board>` | seeds a throwaway page that opens focused on one board (local look) |
| `*.dc.html`, `canvas.json`, `start-emblem.png`, `start-wordmark.png` | the canvas working files |

## Regenerate and republish

```bash
python3 docs/design/canvas/build.py && python3 docs/design/canvas/check_holes.py
```

Then seed with the Claude Design helper (`/design` in Claude Code extracts it) passing every
`*.dc.html` as `--artboard`, both PNGs as `--image` and `canvas.json` as `--canvas`, run
`--check`, and publish the seeded page to the existing artifact URL.

Once the canvas has been edited in the browser, the `.dc.html` files read back from the
artifact (`--extract`) are the source of truth — the Python generators describe the first
draft only.

## Deliberate divergences from the code (to settle before PR 1)

- The apply/renew boards follow the designer's frame: no street address, city, province or
  postal code fields. The current form still collects them.
- No "Forgot password?" link on login (no self-service reset exists; ADR 0004).
- The "What being a START member promises" card is deferred until the CCDO supplies copy.
- Footer email and social links are placeholders until the org picks them.
- Page titles live in the shell's top bar (Figma Dashboard frame); the in-page `<h1>`
  becomes screen-reader-only in code.
