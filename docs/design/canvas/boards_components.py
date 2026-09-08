"""Brand sheet — the tokens and primitives every other board is built from."""

from lib import alert, badge, button, checkbox, document, emblem, esc, field, icon, select, text_input, textarea, wordmark


def swatch(name: str, hex_: str, note: str = "") -> str:
    return (
        '<div class="stack" style="gap:8px">'
        f'<div style="height:64px;border-radius:12px;background:{hex_};box-shadow:inset 0 0 0 1px rgba(23,23,23,.06)"></div>'
        f'<div class="stack" style="gap:0"><span style="font-weight:600;color:var(--ink)">{esc(name)}</span><span class="mono small muted">{esc(hex_)}</span>'
        + (f'<span class="small muted">{esc(note)}</span>' if note else "")
        + "</div></div>"
    )


def brand_sheet() -> str:
    body = (
        '<div style="width:1440px;min-height:1500px;background:var(--card);padding:56px 64px;display:flex;flex-direction:column;gap:44px">'
        '<div class="stack" style="gap:6px"><h1 class="title" style="font-size:32px">START-SYS brand sheet</h1><p class="muted">Logo colours are exact (from the org PNGs). Surface, text and background values were sampled from the designer\'s Figma frames. Type: Poppins.</p></div>'
        # logo + wordmark
        '<section class="stack" style="gap:16px"><h2 class="eyebrow">Logo and wordmark</h2>'
        '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;align-items:center">'
        '<div class="panel" style="display:flex;align-items:center;justify-content:center;height:220px;background:var(--field)">' + emblem(110) + "</div>"
        '<div class="panel" style="display:flex;align-items:center;justify-content:center;height:220px;background:var(--field)">' + wordmark(56) + "</div>"
        '<div class="panel" style="display:flex;align-items:center;justify-content:center;height:220px;background:var(--field)"><img src="start-wordmark.png" alt="START org wordmark" style="width:320px;height:auto"></div>'
        "</div>"
        '<p class="small muted">Emblem: sidebar (64px), hero (150px), favicon. START-SYS wordmark: Poppins 800, gradient yellow → blue, 1.5px ink outline (CSS, no image). Org wordmark with tagline: footer of the public forms.</p></section>'
        # colours
        '<section class="stack" style="gap:16px"><h2 class="eyebrow">Colours</h2>'
        '<div style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:20px">'
        + swatch("Logo blue", "#0099FF") + swatch("Logo yellow", "#FFDD00") + swatch("Ink", "#171717") + swatch("Slate", "#465461", "arrow, arcs, lines") + swatch("Body text", "#3C4043") + swatch("Label", "#6C6F72")
        + swatch("Card", "#FDFDFD") + swatch("Field", "#F4F4F4") + swatch("Blue soft", "#A6DAFD", "button gradient") + swatch("Yellow soft", "#FCF2B3", "button gradient") + swatch("Sun", "#F7ED95", "background") + swatch("Sky", "#63BBF4", "background")
        + swatch("Success", "#15803D") + swatch("Warning", "#B45309") + swatch("Danger", "#B91C1C") + swatch("Info", "#0369A1") + swatch("Haze warm", "#EAF0DC", "background centre") + swatch("Haze cool", "#E4F0F7", "background centre")
        + "</div></section>"
        # background
        '<section class="stack" style="gap:16px"><h2 class="eyebrow">Page background</h2>'
        '<div class="brand-bg" style="height:220px;border-radius:16px"></div>'
        '<p class="small muted">115° gradient sun → haze → sky, two blurred blobs (yellow left, blue right), 48px grid at 4.5% ink. CSS only, no image.</p></section>'
        # type
        '<section class="stack" style="gap:16px"><h2 class="eyebrow">Type — Poppins</h2><div class="panel stack" style="gap:14px">'
        '<p style="font-size:26px;font-weight:600;color:var(--ink)">Page title · 26px / 600</p>'
        '<p style="font-size:18px;font-weight:600;color:var(--ink)">Section heading · 18px / 600</p>'
        '<p>Body · 14px / 400 — Scholars Transforming Advancement and Research for Technology.</p>'
        '<p class="label">Field label · 12px / 600 / uppercase / 0.08em</p>'
        '<p class="mono">Member ID · ui-monospace 13px — 2026-0001</p></div></section>'
        # controls
        '<section class="stack" style="gap:16px"><h2 class="eyebrow">Controls</h2><div class="panel" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px 40px">'
        '<div class="stack" style="gap:12px">' + '<div class="row" style="gap:12px;flex-wrap:wrap">' + button("Primary") + button("Reverse", "reverse") + button("Outline", "outline") + button("Danger", "danger") + button("Ghost", "ghost") + button("Small", "sm") + "</div>"
        '<div class="row" style="gap:12px;flex-wrap:wrap"><a class="pill" href="#" style="height:48px;font-size:16px;padding:0 28px">Landing pill →</a><button class="navpill active" type="button" style="width:200px">Active nav pill</button><button class="navpill" type="button" style="width:200px">Nav pill</button></div></div>'
        '<div class="stack" style="gap:14px">' + field("Text input", text_input("Placeholder")) + field("Select", select(["Select…", "Option"])) + '<label class="row" style="gap:10px">' + checkbox(True) + "<span>Checkbox</span></label></div>"
        "</div></section>"
        # badges + alerts
        '<section class="stack" style="gap:16px"><h2 class="eyebrow">Status badges and alerts</h2><div class="panel stack" style="gap:16px">'
        '<div class="row" style="gap:10px;flex-wrap:wrap">' + badge("Active", "success") + badge("Renewal pending", "warning") + badge("Graduated", "info") + badge("Resigned", "neutral") + badge("Left", "neutral") + badge("Terminated", "danger") + badge("Pending", "warning") + badge("Approved", "success") + badge("Rejected", "danger") + badge("Draft", "neutral") + badge("Queued", "info") + badge("Sent", "success") + badge("Failed", "danger") + "</div>"
        + alert("Approved — member ID 2026-0001", "success", "check") + alert("Your confidentiality acknowledgement for the current term is not on file, so member records cannot be opened. An Executive Admin records it (CBL Art. VIII §7.1).", "warning", "alert") + alert("This record was changed by someone else since you opened it. Reload the page to see the current values before saving again.", "danger", "alert") + alert("This view is logged (CBL Art. VIII §6).", "info", "info")
        + "</div></section>"
        "</div>"
    )
    return document(body, preview=(1440, 1500))


BOARDS = {"Brand": (brand_sheet(), 1440, 1500)}
