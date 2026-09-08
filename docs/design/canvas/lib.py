"""Shared pieces for the START-SYS design canvas artboards.

Every artboard is one self-contained `.dc.html` file (Claude Design "Design Components"
format). This module holds the brand stylesheet and the markup helpers the board scripts
compose; `build.py` writes the files and `canvas.json`.

Brand values come from the designer's Figma frames and the org's logo PNGs — see
`~/.claude/plans/modular-painting-cray.md` (2026-09-08) and `docs/design/canvas/README.md`.

Rules the format imposes (Claude Design preview):
- keep `<script src="./support.js"></script>` in <head> verbatim;
- `{{ hole }}` is a dotted lookup only — compute everything in `renderVals()`;
- images are referenced by bare filename with a double-quoted src;
- copy is literal text so it can be retyped in place; only state-driven values are bound.
"""

from __future__ import annotations

import html
import json

# ── Brand tokens ─────────────────────────────────────────────────────────────

FONT_LINK = (
    '<link rel="stylesheet" '
    'href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap">'
)

BASE_CSS = r"""
:root{
  --blue:#0099FF; --yellow:#FFDD00; --slate:#465461; --ink:#171717; --body:#3C4043; --label:#6C6F72;
  --card:#FDFDFD; --field:#F4F4F4; --line:#E6E7E9; --line-soft:#EFF0F2;
  --blue-soft:#A6DAFD; --yellow-soft:#FCF2B3;
  --sun:#F7ED95; --sun-deep:#FFEC74; --sky:#63BBF4; --sky-deep:#5DBDFD; --haze-warm:#EAF0DC; --haze-cool:#E4F0F7;
  --success:#15803D; --success-soft:#ECFDF3; --warning:#B45309; --warning-soft:#FFFBEB;
  --danger:#B91C1C; --danger-soft:#FEF2F2; --info:#0369A1; --info-soft:#EFF6FF;
}
*{box-sizing:border-box}
body{margin:0;font-family:Poppins,ui-sans-serif,system-ui,sans-serif;color:var(--body);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
a{color:#0067B3;text-decoration:underline;text-underline-offset:3px}
a:hover{color:#00508C}
h1,h2,h3,h4,p{margin:0}
button{font:inherit;cursor:pointer}
input,select,textarea{font:inherit}

/* page background — gradient, blurred colour shapes, faint grid and rings; no image */
.brand-bg{position:relative;isolation:isolate;overflow:hidden;
  background-image:
    repeating-linear-gradient(0deg, rgba(23,23,23,.06) 0 1px, transparent 1px 56px),
    repeating-linear-gradient(90deg, rgba(23,23,23,.06) 0 1px, transparent 1px 56px),
    linear-gradient(112deg,#F8EB82 0%,#F4EDA8 22%,var(--haze-warm) 42%,var(--haze-cool) 56%,#94CFF8 78%,#5DBDFD 100%)}
.decor{position:absolute;inset:0;z-index:-1;pointer-events:none;overflow:hidden}
.blob{position:absolute;border-radius:120px;filter:blur(34px);opacity:.92}
.blob.y1{width:440px;height:230px;left:-120px;top:120px;background:#FFE860;border-radius:140px}
.blob.y2{width:380px;height:300px;left:-60px;top:330px;background:#FFEA70;border-radius:160px;filter:blur(44px);opacity:.85}
.blob.g1{width:320px;height:260px;left:60px;bottom:-80px;background:#BFE4C4;filter:blur(60px);opacity:.8}
.blob.b1{width:520px;height:460px;right:-170px;top:40px;background:#3FAEF7;filter:blur(46px)}
.blob.y3{width:300px;height:210px;right:-40px;top:70px;background:#FFE24A;border-radius:110px;filter:blur(30px);opacity:.9}
.blob.b2{width:360px;height:280px;right:80px;bottom:-90px;background:#6CC0FA;filter:blur(56px);opacity:.8}
.blob.y4{width:260px;height:180px;right:-60px;bottom:120px;background:#F6E68A;filter:blur(40px);opacity:.85}
.ring{position:absolute;border-radius:50%;border:1px solid rgba(23,23,23,.07)}
.decor.compact .blob{transform:scale(.7);transform-origin:center}

/* surfaces */
.card{background:var(--card);border-radius:28px;box-shadow:0 24px 60px rgba(23,23,23,.14),0 2px 6px rgba(23,23,23,.06);border:1px solid rgba(255,255,255,.8)}
.card-form{background:var(--card);border-radius:16px;box-shadow:0 6px 20px rgba(23,23,23,.07)}
.panel{background:var(--card);border-radius:16px;box-shadow:0 4px 16px rgba(23,23,23,.06);padding:20px 24px}
.rule{height:1px;background:var(--slate);opacity:.6}

/* type */
.wordmark{font-weight:800;letter-spacing:-.01em;line-height:1;
  background:linear-gradient(90deg,var(--yellow) 0%,var(--blue) 100%);
  -webkit-background-clip:text;background-clip:text;color:transparent;
  -webkit-text-stroke:1.5px var(--ink);paint-order:stroke fill;
  filter:drop-shadow(0 2px 0 rgba(23,23,23,.35))}
.label{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--label)}
.eyebrow{font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--label)}
.title{font-size:26px;font-weight:600;color:var(--ink);letter-spacing:-.01em}
.h2{font-size:18px;font-weight:600;color:var(--ink)}
.muted{color:var(--label)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.small{font-size:12px}

/* controls */
.input{height:44px;width:100%;border-radius:10px;background:var(--field);border:1px solid transparent;padding:0 16px;font-size:14px;color:var(--ink);
  box-shadow:inset 0 1px 2px rgba(0,0,0,.05),0 3px 8px rgba(23,23,23,.08);outline:none}
.input:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(0,153,255,.22)}
.input.sm{height:36px;font-size:13px;padding:0 12px}
.textarea{min-height:120px;padding:12px 16px;resize:vertical;line-height:1.5}
.select{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236C6F72' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 14px center;padding-right:40px}
.check{width:18px;height:18px;border-radius:5px;border:1.5px solid #8A8F94;background:#fff;flex:none;display:inline-grid;place-items:center;margin-top:2px}
.check.on{background:var(--blue);border-color:var(--blue)}
.check.on::after{content:"";width:10px;height:6px;border:2px solid #fff;border-top:0;border-right:0;transform:rotate(-45deg) translate(1px,-1px)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:44px;padding:0 26px;border-radius:10px;border:0;
  background:linear-gradient(90deg,var(--blue-soft) 0%,var(--yellow-soft) 100%);color:var(--ink);font-weight:600;font-size:13px;letter-spacing:.06em;text-transform:uppercase;
  box-shadow:0 6px 18px rgba(0,153,255,.18),0 1px 2px rgba(0,0,0,.06);text-decoration:none;white-space:nowrap}
.btn:hover{filter:brightness(1.03)}
.btn.reverse{background:linear-gradient(90deg,var(--yellow-soft) 0%,var(--blue-soft) 100%)}
.btn.outline{background:var(--card);box-shadow:0 4px 16px rgba(23,23,23,.08)}
.btn.ghost{background:transparent;box-shadow:none;color:var(--body);text-transform:none;letter-spacing:0;font-weight:500;padding:0 12px}
.btn.danger{background:var(--danger);color:#fff;box-shadow:0 6px 18px rgba(185,28,28,.18)}
.btn.sm{height:36px;padding:0 16px;font-size:12px}
.btn.block{width:100%}
.btn[disabled]{opacity:.5;cursor:default;filter:none}
.pill{display:inline-flex;align-items:center;justify-content:center;gap:10px;height:56px;padding:0 40px;border-radius:999px;background:var(--card);color:var(--ink);
  font-size:20px;font-weight:500;box-shadow:0 10px 30px rgba(23,23,23,.12);text-decoration:none;border:0}
.link{background:none;border:0;padding:0;color:var(--blue);text-decoration:underline;text-underline-offset:3px;font:inherit}

/* shell */
.shell{display:grid;grid-template-columns:260px minmax(0,1fr);background:var(--card)}
.side{background:var(--card);display:flex;flex-direction:column;padding:28px 20px 24px;gap:10px;box-shadow:1px 0 0 var(--line-soft);height:900px;position:sticky;top:0;align-self:start}
.side .brand{display:flex;flex-direction:column;align-items:center;gap:8px;margin-bottom:22px}
.nav{display:flex;flex-direction:column;gap:10px}
.navpill{display:flex;align-items:center;height:46px;padding:0 20px;border-radius:10px;background:var(--card);color:var(--body);font-weight:500;font-size:15px;
  box-shadow:0 4px 14px rgba(23,23,23,.08);text-decoration:none;cursor:pointer;border:0;text-align:left;width:100%}
.navpill.active{background:linear-gradient(90deg,var(--blue-soft) 0%,var(--yellow-soft) 100%);color:var(--ink);font-weight:600}
.navgroup{margin-top:14px}
.topbar{height:76px;background:var(--card);display:flex;align-items:center;justify-content:space-between;padding:0 32px;box-shadow:0 1px 0 var(--line-soft)}
.content{flex:1;padding:32px}
.rolechip{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--label);background:var(--field);border-radius:999px;padding:6px 12px}

/* data */
.table{width:100%;border-collapse:separate;border-spacing:0;font-size:13.5px}
.table th{text-align:left;padding:12px 14px;font-size:11.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--label);border-bottom:1px solid var(--line)}
.table td{padding:13px 14px;border-bottom:1px solid var(--line-soft);color:var(--body);vertical-align:middle}
.table tr:last-child td{border-bottom:0}
.table td a{color:var(--ink);font-weight:500;text-decoration:none}
.table td .mono,.table td .badge{white-space:nowrap}
.badge{display:inline-flex;align-items:center;height:24px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.badge.success{background:var(--success-soft);color:var(--success)}
.badge.warning{background:var(--warning-soft);color:var(--warning)}
.badge.danger{background:var(--danger-soft);color:var(--danger)}
.badge.info{background:var(--info-soft);color:var(--info)}
.badge.neutral{background:var(--field);color:var(--body)}
.badge.blue{background:#E5F3FF;color:#0369A1}
.chip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:999px;background:var(--card);border:1px solid var(--line);font-size:13px;color:var(--body);cursor:pointer}
.chip.on{background:linear-gradient(90deg,var(--blue-soft) 0%,var(--yellow-soft) 100%);border-color:transparent;color:var(--ink);font-weight:600}
.alert{display:flex;gap:10px;align-items:flex-start;padding:12px 16px;border-radius:10px;border:1px solid transparent;font-size:13.5px}
.alert.success{background:var(--success-soft);border-color:rgba(21,128,61,.3);color:var(--success)}
.alert.warning{background:var(--warning-soft);border-color:rgba(180,83,9,.3);color:var(--warning)}
.alert.danger{background:var(--danger-soft);border-color:rgba(185,28,28,.3);color:var(--danger)}
.alert.info{background:var(--info-soft);border-color:rgba(3,105,161,.25);color:var(--info)}
.stat{display:flex;flex-direction:column;gap:6px;padding:20px 22px}
.stat .n{font-size:32px;font-weight:700;color:var(--ink);line-height:1}
.bar{height:8px;border-radius:999px;background:var(--field);overflow:hidden}
.bar>i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--blue-soft),var(--blue))}
.kv{display:grid;grid-template-columns:200px 1fr;gap:10px 16px;font-size:13.5px}
.kv dt{color:var(--label);font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding-top:2px}
.kv dd{margin:0;color:var(--ink)}
.overlay{position:absolute;inset:0;background:rgba(23,23,23,.35);display:flex;align-items:center;justify-content:center;z-index:5}
.dialog{width:520px;background:var(--card);border-radius:16px;box-shadow:0 20px 60px rgba(23,23,23,.25);padding:28px}
.tabs{display:flex;gap:4px;background:var(--field);padding:4px;border-radius:10px;width:max-content}
.tab{height:34px;padding:0 16px;border-radius:8px;border:0;background:transparent;font-weight:500;color:var(--body)}
.tab.on{background:var(--card);color:var(--ink);box-shadow:0 2px 8px rgba(23,23,23,.08);font-weight:600}
.skeleton{background:linear-gradient(90deg,var(--field),#ECEDEF,var(--field));border-radius:8px;height:14px}
.footer{background:var(--card);display:flex;align-items:center;justify-content:space-between;padding:22px 40px;box-shadow:0 -1px 0 var(--line-soft)}
.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px 32px}
.grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px 32px}
.stack{display:flex;flex-direction:column;gap:8px}
.row{display:flex;align-items:center;gap:12px}
.mobile .grid2,.mobile .grid3{grid-template-columns:minmax(0,1fr)}
.mobile .table{font-size:12.5px}
.icon{width:18px;height:18px;flex:none}
"""


# ── Icons (stroke SVG, 24 grid, lucide shapes) ──────────────────────────────

def icon(name: str, size: int = 18, color: str = "currentColor") -> str:
    paths = {
        "menu": '<path d="M4 6h16M4 12h16M4 18h16"/>',
        "search": '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
        "chevron-down": '<path d="m6 9 6 6 6-6"/>',
        "chevron-right": '<path d="m9 18 6-6-6-6"/>',
        "chevron-left": '<path d="m15 18-6-6 6-6"/>',
        "arrow-right": '<path d="M5 12h14M13 5l7 7-7 7"/>',
        "check": '<path d="M20 6 9 17l-5-5"/>',
        "x": '<path d="M18 6 6 18M6 6l12 12"/>',
        "upload": '<path d="M12 3v12M7 8l5-5 5 5M4 21h16"/>',
        "file": '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
        "eye": '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
        "mail": '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
        "shield": '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
        "lock": '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
        "users": '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="3"/><path d="M15.5 14.5A5 5 0 0 1 22 19"/>',
        "clock": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        "alert": '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
        "info": '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
        "plus": '<path d="M12 5v14M5 12h14"/>',
        "download": '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
        "filter": '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
        "calendar": '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
        "logout": '<path d="M10 17l5-5-5-5M15 12H3M13 3h6v18h-6"/>',
        "linkedin": '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10v7M8 7h.01M12 17v-4a2 2 0 1 1 4 0v4M12 10v7"/>',
        "instagram": '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',
        "facebook": '<path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8a1 1 0 0 1 1-1z"/>',
        "qr": '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3M21 14v7h-7"/>',
        "refresh": '<path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6"/>',
        "send": '<path d="M22 2 11 13M22 2 15 22l-4-9-9-4z"/>',
        "settings": '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    }
    return (
        f'<svg class="icon" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" '
        f'stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        f"{paths[name]}</svg>"
    )


# ── Markup helpers ────────────────────────────────────────────────────────────

def esc(s: str) -> str:
    return html.escape(s, quote=True)


def decor(compact: bool = False, mobile: bool = False) -> str:
    """The blurred colour shapes and faint rings behind a `.brand-bg` surface (Figma
    Landing / Login frames). Sits at z-index -1 inside the isolated container."""
    if mobile:
        blobs = '<i class="blob y1" style="left:-160px;top:60px"></i><i class="blob b1" style="right:-220px;top:120px"></i><i class="blob y3" style="right:-90px;top:40px"></i><i class="blob g1"></i>'
        rings = '<i class="ring" style="width:320px;height:320px;left:-120px;top:380px"></i><i class="ring" style="width:260px;height:260px;right:-90px;top:20px"></i>'
    else:
        blobs = '<i class="blob y1"></i><i class="blob y2"></i><i class="blob g1"></i><i class="blob b1"></i><i class="blob y3"></i><i class="blob b2"></i><i class="blob y4"></i>'
        rings = (
            '<i class="ring" style="width:520px;height:520px;left:180px;top:-260px"></i>'
            '<i class="ring" style="width:420px;height:420px;left:560px;top:520px"></i>'
            '<i class="ring" style="width:680px;height:680px;right:120px;top:-200px"></i>'
            '<i class="ring" style="width:300px;height:300px;right:420px;bottom:-120px"></i>'
        )
    return f'<div class="decor{" compact" if compact else ""}" aria-hidden="true">{blobs}{rings}</div>'


def emblem(size: int = 96) -> str:
    h = int(size * 512 / 333)
    return f'<img src="start-emblem.png" alt="START-DOST emblem" width="{size}" height="{h}" style="width:{size}px;height:auto;display:block">'


def wordmark(size: int = 44, tag: str = "p") -> str:
    return f'<{tag} class="wordmark" style="font-size:{size}px">START-SYS</{tag}>'


def label(text: str, for_id: str | None = None) -> str:
    f = f' for="{for_id}"' if for_id else ""
    return f'<label class="label"{f}>{esc(text)}</label>'


def field(text: str, control: str, **attrs) -> str:
    """A label + control stack (one form field)."""
    return f'<div class="stack" style="gap:8px">{label(text)}{control}</div>'


def text_input(placeholder: str = "", value: str = "", kind: str = "text", extra_class: str = "", style: str = "") -> str:
    v = f' value="{esc(value)}"' if value else ""
    p = f' placeholder="{esc(placeholder)}"' if placeholder else ""
    st = f' style="{style}"' if style else ""
    return f'<input class="input {extra_class}" type="{kind}"{p}{v}{st}>'


def select(options: list[str], value: str | None = None, extra_class: str = "", style: str = "") -> str:
    opts = "".join(
        f'<option{" selected" if o == value else ""}>{esc(o)}</option>' for o in options
    )
    st = f' style="{style}"' if style else ""
    return f'<select class="input select {extra_class}"{st}>{opts}</select>'


def textarea(placeholder: str = "", value: str = "", rows: int = 4) -> str:
    return f'<textarea class="input textarea" rows="{rows}" placeholder="{esc(placeholder)}">{esc(value)}</textarea>'


def button(text: str, variant: str = "", href: str | None = None, extra: str = "", attrs: str = "") -> str:
    cls = f"btn {variant}".strip()
    if href:
        return f'<a class="{cls}" href="{esc(href)}" style="{extra}" {attrs}>{esc(text)}</a>'
    return f'<button class="{cls}" type="button" style="{extra}" {attrs}>{esc(text)}</button>'


def badge(text: str, tone: str) -> str:
    return f'<span class="badge {tone}">{esc(text)}</span>'


def alert(text: str, tone: str, ic: str = "info") -> str:
    return f'<div class="alert {tone}">{icon(ic)}<span>{text}</span></div>'


def checkbox(on: bool = False) -> str:
    return f'<span class="check{" on" if on else ""}" role="checkbox" aria-checked="{"true" if on else "false"}"></span>'


def table(headers: list[str], rows: list[list[str]], style: str = "") -> str:
    th = "".join(f"<th>{esc(h)}</th>" for h in headers)
    trs = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    st = f' style="{style}"' if style else ""
    return f'<table class="table"{st}><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table>'


def kv(pairs: list[tuple[str, str]]) -> str:
    return '<dl class="kv">' + "".join(f"<dt>{esc(k)}</dt><dd>{v}</dd>" for k, v in pairs) + "</dl>"


def stat(n: str, caption: str, sub: str = "") -> str:
    s = f'<span class="small muted">{esc(sub)}</span>' if sub else ""
    return f'<a class="panel stat" href="#" style="text-decoration:none"><span class="eyebrow">{esc(caption)}</span><span class="n">{esc(n)}</span>{s}</a>'


def bars(items: list[tuple[str, int, int]]) -> str:
    out = []
    for name, n, total in items:
        pct = 0 if total == 0 else round(100 * n / total)
        out.append(
            f'<div class="stack" style="gap:6px"><div class="row" style="justify-content:space-between">'
            f'<span>{esc(name)}</span><span class="mono muted">{n}</span></div>'
            f'<div class="bar"><i style="width:{pct}%"></i></div></div>'
        )
    return '<div class="stack" style="gap:14px">' + "".join(out) + "</div>"


def footer_strip(email: str = "[ORG EMAIL]") -> str:
    return (
        '<footer class="footer">'
        '<div class="row" style="gap:16px">'
        + emblem(44)
        + '<div class="stack" style="gap:2px"><p style="font-weight:600;color:var(--ink)">Scholars Transforming Advancement and Research for Technology</p>'
        '<p class="small muted">© 2026 START-DOST · All rights reserved</p></div></div>'
        '<div class="stack" style="align-items:flex-end;gap:6px">'
        '<div class="row" style="gap:14px;color:var(--label)">'
        + icon("linkedin")
        + icon("instagram")
        + icon("facebook")
        + "</div>"
        f'<a class="small" href="#" style="color:var(--label);text-decoration:none">{esc(email)}</a>'
        "</div></footer>"
    )


# ── Shell (sidebar + header) for authenticated boards ───────────────────────

ADMIN_LINKS = [
    ("dashboard", "Dashboard", "/dashboard"),
    ("members", "Members", "/members"),
    ("applications", "Applications", "/applications"),
    ("renewals", "Renewals", "/renewals"),
    ("campaigns", "Campaigns", "/campaigns"),
    ("officers", "Officers", "/officers"),
    ("audit", "Audit log", "/audit"),
]
TECH_LINKS = [
    ("system", "System", "/system"),
    ("userroles", "User roles", "/system/user-roles"),
]
OFFICER_LINKS = [
    ("directory", "Directory", "/directory"),
    ("committees", "Committees", "/committees"),
]
RR_LINKS = [("region", "Region", "/region")]


def nav_markup(links: list[tuple[str, str, str]]) -> str:
    """Nav pills with the active class bound to state (`{{navX}}`) and a click handler
    per pill (`{{pickX}}`). Labels stay literal so they can be retyped in place."""
    out = []
    for key, text, href in links:
        cap = key[:1].upper() + key[1:]
        out.append(
            f'<button class="navpill {{{{nav{cap}}}}}" type="button" onClick="{{{{pick{cap}}}}}">{esc(text)}</button>'
        )
    return '<nav class="nav">' + "".join(out) + "</nav>"


def nav_logic(links: list[tuple[str, str, str]], active_key: str) -> str:
    """JS that renderVals() spreads in: navX class strings and pickX handlers."""
    keys = [k for k, _, _ in links]
    caps = {k: k[:1].upper() + k[1:] for k in keys}
    lines = ["const active = this.state.active ?? %s;" % json.dumps(active_key)]
    for k in keys:
        lines.append(f"vals.nav{caps[k]} = active === {json.dumps(k)} ? 'active' : '';")
        lines.append(f"vals.pick{caps[k]} = () => this.setState({{ active: {json.dumps(k)} }});")
    return "\n      ".join(lines)


def shell(
    links: list[tuple[str, str, str]],
    active_key: str,
    title: str,
    role_label: str,
    content: str,
    width: int = 1440,
    min_height: int = 900,
) -> str:
    return (
        f'<div class="shell" style="width:{width}px;min-height:{min_height}px">'
        '<aside class="side">'
        '<div class="brand">' + emblem(64) + wordmark(22, "span") + "</div>"
        + nav_markup(links)
        + '<div style="margin-top:auto;padding-top:24px"><button class="btn reverse block" type="button">Sign out</button></div>'
        "</aside>"
        '<section style="display:flex;flex-direction:column;min-width:0">'
        f'<header class="topbar"><p class="title">{esc(title)}</p><span class="rolechip">{esc(role_label)}</span></header>'
        f'<main class="brand-bg content">{decor(compact=True)}{content}</main>'
        "</section></div>"
    )


# ── Document assembly ────────────────────────────────────────────────────────

def document(
    body: str,
    *,
    extra_css: str = "",
    logic: str | None = None,
    props: dict | None = None,
    preview: tuple[int, int] | None = None,
) -> str:
    """Wrap a body in the .dc.html envelope. `logic` is the body of renderVals()
    (must end by returning `vals`); `props` become data-props entries."""
    props = dict(props or {})
    if preview:
        props["$preview"] = {"width": preview[0], "height": preview[1]}
    script = ""
    if logic is not None or props:
        body_js = logic or "const vals = {};\n      return vals;"
        dp = html.escape(json.dumps(props), quote=True).replace("&#x27;", "&#39;")
        script = (
            f"\n<script data-dc-script data-props='{dp}'>\n"
            "class Component extends DCLogic {\n"
            "  renderVals() {\n"
            f"      {body_js}\n"
            "  }\n"
            "}\n</script>"
        )
    return (
        "<!doctype html>\n<html>\n<head>\n  <meta charset=\"utf-8\">\n"
        "  <script src=\"./support.js\"></script>\n</head>\n<body>\n<x-dc>\n<helmet>\n  "
        + FONT_LINK
        + "\n  <style>"
        + BASE_CSS
        + extra_css
        + "\n  </style>\n</helmet>\n"
        + body
        + "\n</x-dc>"
        + script
        + "\n</body>\n</html>\n"
    )
