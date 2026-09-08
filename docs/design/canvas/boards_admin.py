"""Admin artboards — every authenticated admin route, inside the Figma Dashboard shell.

Copy, columns, filters and actions mirror the current app (read from source on
2026-09-08); the look is the designer's. Sample rows use the demo seeder's fake names.
"""

import json

from lib import (
    ADMIN_LINKS, TECH_LINKS, alert, badge, bars, button, checkbox, document, esc, field, icon, kv,
    label, nav_logic, select, shell, stat, table, text_input, textarea,
)

# ── sample data (demo seeder flavour, no real people) ────────────────────────

PEOPLE = [
    ("Bautista", "Bea", "2024-0001", "Active", "National Capital Region", "2024", "Community Outreach", "Community & Regional Relations Department"),
    ("Cruz", "Caloy", "2024-0002", "Active", "National Capital Region", "2024", "Scholars' Tech Guild", "Technology Department"),
    ("Dizon", "Dara", "2025-0003", "Active", "National Capital Region", "2025", "Community Outreach", "—"),
    ("Estrada", "Eli", "2026-0004", "Active", "Central Visayas", "2026", "Scholars' Tech Guild", "—"),
    ("Flores", "Fara", "2024-0005", "Active", "CALABARZON", "2024", "Community Outreach", "—"),
    ("Garcia", "Gio", "2025-0006", "Renewal pending", "Western Visayas", "2025", "—", "—"),
    ("Hilario", "Hana", "2026-0007", "Active", "National Capital Region", "2026", "Scholars' Tech Guild", "Technology Department"),
    ("Ignacio", "Iking", "2024-0008", "Graduated", "National Capital Region", "2024", "—", "—"),
    ("Javier", "Jaya", "2025-0009", "Active", "Central Visayas", "2025", "Community Outreach", "—"),
    ("Katigbak", "Kiko", "2026-0010", "Active", "CALABARZON", "2026", "—", "—"),
]

STATUS_TONE = {
    "Active": "success", "Renewal pending": "warning", "Graduated": "info", "Resigned": "neutral",
    "Left": "neutral", "Terminated": "danger", "Pending": "warning", "Approved": "success",
    "Rejected": "danger", "Draft": "neutral", "Queued": "info", "Sending": "info", "Sent": "success",
    "Failed": "danger", "On leave": "neutral", "Suspended": "danger",
}


def tok(s: str) -> str:
    """Literal {{merge_token}} copy: a zero-width space between the braces keeps the
    runtime from treating it as a template hole."""
    return s.replace("{{", "{​{").replace("}}", "}​}")


def sbadge(s: str) -> str:
    return badge(s, STATUS_TONE.get(s, "neutral"))


def mono(s: str) -> str:
    return f'<span class="mono">{esc(s)}</span>'


def link(s: str) -> str:
    return f'<a href="#">{esc(s)}</a>'


def h1(text: str, sub: str = "", right: str = "") -> str:
    """Page intro row. The page title itself lives in the shell's top bar (as in the
    Figma Dashboard frame), so only the description and the right-hand action render here."""
    r = f'<div style="margin-left:auto">{right}</div>' if right else ""
    s = f'<p style="max-width:760px;color:var(--body)">{sub}</p>' if sub else ""
    if not s and not r:
        return ""
    return (
        '<div class="row" style="align-items:flex-start;gap:24px;margin-bottom:22px;min-height:44px">'
        f'{s}{r}</div>'
    )


def section(title: str, body: str, meta: str = "") -> str:
    m = f'<span class="small muted">{meta}</span>' if meta else ""
    return (
        '<section class="stack" style="gap:12px">'
        f'<div class="row" style="justify-content:space-between"><h2 class="eyebrow">{esc(title)}</h2>{m}</div>{body}</section>'
    )


def dialog(open_hole: str, title: str, body: str, footer: str, close_hole: str) -> str:
    return (
        f'<sc-if value="{{{{{open_hole}}}}}" hint-placeholder-val="{{{{false}}}}">'
        f'<div class="overlay" onClick="{{{{{close_hole}}}}}"><div class="dialog stack" style="gap:18px">'
        f'<h2 style="font-size:18px;font-weight:600;color:var(--ink)">{esc(title)}</h2>{body}'
        f'<div class="row" style="justify-content:flex-end;gap:10px;padding-top:6px">{footer}</div>'
        "</div></div></sc-if>"
    )


def toggle_logic(name: str, default: bool = False) -> str:
    """Boolean state `name` with open/close handlers `openName` / `closeName`."""
    cap = name[:1].upper() + name[1:]
    return (
        f"vals.{name} = this.state.{name} ?? {json.dumps(default)};\n"
        f"      vals.open{cap} = () => this.setState({{ {name}: true }});\n"
        f"      vals.close{cap} = () => this.setState({{ {name}: false }});"
    )


def chip_row(group: str, options: list[str], default: int = 0, multi: bool = False) -> tuple[str, str]:
    """Clickable chips. Returns (markup, logic). Single-select unless `multi`."""
    parts = []
    for i, o in enumerate(options):
        parts.append(f'<button class="chip {{{{{group}{i}}}}}" type="button" onClick="{{{{pick{group}{i}}}}}">{esc(o)}</button>')
    markup = '<div class="row" style="flex-wrap:wrap;gap:8px">' + "".join(parts) + "</div>"
    if multi:
        lines = [f"const {group}Set = this.state.{group} ?? {json.dumps([default])};"]
        for i in range(len(options)):
            lines.append(f"vals.{group}{i} = {group}Set.includes({i}) ? 'on' : '';")
            lines.append(
                f"vals.pick{group}{i} = () => this.setState({{ {group}: {group}Set.includes({i}) ? {group}Set.filter((x) => x !== {i}) : [...{group}Set, {i}] }});"
            )
    else:
        lines = [f"const {group}Cur = this.state.{group} ?? {default};"]
        for i in range(len(options)):
            lines.append(f"vals.{group}{i} = {group}Cur === {i} ? 'on' : '';")
            lines.append(f"vals.pick{group}{i} = () => this.setState({{ {group}: {i} }});")
    return markup, "\n      ".join(lines)


def admin_board(active: str, title: str, content: str, extra_logic: str = "", role: str = "exec_admin", links=None, height: int = 900) -> str:
    links = links or ADMIN_LINKS
    body = shell(links, active, title, role, content, min_height=height)
    logic = "const vals = {};\n      " + nav_logic(links, active) + ("\n      " + extra_logic if extra_logic else "") + "\n      return vals;"
    return document(body, logic=logic, preview=(1440, height))


# ── 1. Dashboard ─────────────────────────────────────────────────────────────

def dashboard() -> str:
    tiles = "".join(
        stat(n, lab) for lab, n in [("Renewal pending", "1"), ("Active", "20"), ("Graduated", "2"), ("Resigned", "1"), ("Left", "0"), ("Terminated", "0")]
    )
    content = (
        h1("Dashboard", "Term 2026-2027", right='<a href="#">All members (24)</a>')
        + '<div class="stack" style="gap:28px">'
        + section("Applications", '<div class="grid3" style="gap:16px">' + stat("3", "Pending review", "Awaiting a decision") + "</div>")
        + section("Members by status", '<div class="grid3" style="gap:16px">' + tiles + "</div>")
        + '<div class="grid2" style="gap:24px">'
        + '<div class="panel stack" style="gap:14px"><h2 class="eyebrow">Members by region</h2>'
        + bars([("National Capital Region", 12, 12), ("Central Visayas", 4, 12), ("CALABARZON", 4, 12), ("Western Visayas", 3, 12), ("Davao Region", 1, 12)])
        + "</div>"
        + '<div class="panel stack" style="gap:14px"><h2 class="eyebrow">Members by committee</h2>'
        + bars([("Community Outreach", 9, 9), ("Scholars' Tech Guild", 8, 9), ("No committee", 7, 9)])
        + '<p class="small muted">A member may serve on more than one committee (CBL Art. III §5), so these figures do not add up to the term’s headcount. “No committee” counts members with no committee seat and is not filterable.</p></div>'
        "</div></div>"
    )
    return admin_board("dashboard", "Dashboard", content)


# ── 2. Members list ──────────────────────────────────────────────────────────

def members() -> str:
    status_chips, l1 = chip_row("st", ["Renewal pending", "Active", "Graduated", "Resigned", "Left", "Terminated"], default=1, multi=True)
    region_chips, l2 = chip_row("rg", ["National Capital Region", "Central Visayas", "CALABARZON", "Western Visayas"], default=0, multi=True)
    rows = [
        [link(f"{g} {f}"), mono(mid), sbadge(st), region, joined, cm, dept]
        for f, g, mid, st, region, joined, cm, dept in PEOPLE
    ]
    content = (
        h1("Members", "24 members match the current filters.")
        + '<div class="stack" style="gap:16px">'
        + '<div class="row" style="gap:12px">'
        + '<div class="row" style="gap:10px;width:420px;position:relative">'
        + icon("search", 18, "#6C6F72")
        + text_input("Search by name or member ID…", kind="search")
        + "</div>"
        + '<div class="row" style="gap:8px;margin-left:auto">' + label("Term") + select(["Current term", "2025-2026", "2024-2025"], style="width:180px", extra_class="sm") + "</div>"
        + "</div>"
        + '<div class="panel stack" style="gap:14px">'
        + '<div class="stack" style="gap:8px">' + label("Status") + status_chips + "</div>"
        + '<div class="stack" style="gap:8px">' + label("Region") + region_chips + "</div>"
        + '<div class="grid2" style="gap:16px"><div class="stack" style="gap:8px">' + label("Committee") + select(["Any committee", "Community Outreach", "Scholars' Tech Guild"], extra_class="sm") + "</div>"
        + '<div class="stack" style="gap:8px">' + label("Department") + select(["Any department", "Community & Regional Relations Department", "Technology Department"], extra_class="sm") + "</div></div>"
        + "</div>"
        + '<div class="row" style="gap:8px" data-testid="active-filters">' + badge("Status: Active", "neutral") + '<button class="btn ghost sm" type="button">Clear all</button></div>'
        + '<div class="panel" style="padding:0;overflow:hidden" data-testid="member-table">'
        + table(["Name", "Member ID", "Status", "Region", "Joined", "Committees", "Departments"], rows)
        + "</div>"
        + '<div class="row" style="justify-content:space-between"><span class="small muted">Page 1 of 3 · 24 members</span><div class="row" style="gap:8px">'
        + button("Previous", "outline sm", attrs="disabled") + button("Next", "outline sm") + "</div></div>"
        + "</div>"
    )
    return admin_board("members", "Members", content, l1 + "\n      " + l2, height=1180)


# ── 3. Member detail ─────────────────────────────────────────────────────────

def member_detail() -> str:
    status_dialog = dialog(
        "dlg",
        "Change status to Graduated",
        '<p class="muted">This change is recorded in the audit log with your account and the time.</p>'
        + field("Reason", textarea("", rows=4))
        + '<p class="small muted">At least 10 characters.</p>',
        button("Cancel", "outline", attrs='onClick="{{closeDlg}}"') + button("Confirm"),
        "closeDlg",
    )
    sensitive = [
        ("First name", "Bea"), ("Middle name", "—"), ("Last name", "Bautista"), ("Suffix", "—"),
        ("Date of birth", "2004-03-15"), ("Contact number", "+63917 000 1001"), ("Personal email", "sample1@start-sys.test"),
        ("Sex", "Female"), ("Facebook account", "https://facebook.com/sample1"), ("DOST scholarship award", "RA 7687"),
        ("Year of award", "2024"), ("University", "University of the Philippines Diliman"), ("Program", "BS Computer Science"),
    ]
    edit_fields = [
        ("First name", "Bea"), ("Middle name", ""), ("Last name", "Bautista"), ("Suffix", ""),
        ("Date of birth", "2004-03-15"), ("Contact number", "+639170001001"), ("Personal email", "sample1@start-sys.test"),
        ("Facebook account link", "https://facebook.com/sample1"),
    ]
    edit = "".join(field(l, text_input("", value=v)) for l, v in edit_fields)
    history = table(
        ["Term", "Member ID", "Status", "Region", "Year level", "Ended reason"],
        [
            ['2026-2027 <span class="small muted">(1 Jun 2026 – 31 May 2027)</span>', mono("2024-0001"), sbadge("Active"), "National Capital Region", "3", "—"],
            ['2025-2026 <span class="small muted">(1 Jun 2025 – 31 May 2026)</span>', mono("2024-0001"), sbadge("Active"), "National Capital Region", "2", "—"],
            ['2024-2025 <span class="small muted">(1 Jun 2024 – 31 May 2025)</span>', mono("2024-0001"), sbadge("Active"), "National Capital Region", "1", "—"],
        ],
    )
    content = (
        '<a href="#" class="small" style="color:var(--label);text-decoration:none">← Back to members</a>'
        + '<div class="row" style="gap:14px;margin:10px 0 22px"><h1 class="title">Bea Bautista</h1>' + mono("2024-0001") + sbadge("Active") + "</div>"
        + '<div class="stack" style="gap:20px">'
        + '<div class="panel" style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px">'
        + "".join(f'<div class="stack" style="gap:4px">{label(k)}<span style="color:var(--ink)">{v}</span></div>' for k, v in [("Status", sbadge("Active")), ("Region", "National Capital Region"), ("Year level", "3"), ("Department", "Community & Regional Relations Department"), ("Committee", "Community Outreach")])
        + "</div>"
        + '<div class="row" style="gap:10px;justify-content:flex-end">' + label("Change status") + select(["Select a status…", "Graduated", "Left", "Resigned"], value="Graduated", extra_class="sm", style="width:200px") + button("Continue", "sm", attrs='onClick="{{openDlg}}"') + "</div>"
        + '<div class="panel stack" style="gap:16px"><div class="row" style="justify-content:space-between"><h2 class="h2">Personal details</h2><span class="rolechip" style="text-transform:none;letter-spacing:0">This view is logged (CBL Art. VIII §6)</span></div>'
        + '<div class="grid2" style="gap:14px 32px">' + "".join(f'<div class="stack" style="gap:2px">{label(k)}<span style="color:var(--ink)">{esc(v)}</span></div>' for k, v in sensitive) + "</div></div>"
        + '<div class="panel stack" style="gap:18px"><h2 class="h2">Edit record</h2><div class="grid2">' + edit + "</div>"
        + '<div class="grid2">' + field("Sex", select(["—", "Male", "Female", "Prefer not to say"], value="Female")) + field("DOST scholarship award", select(["—", "RA 7687", "Merit", "JLSS RA 7687", "JLSS Merit", "JLSS RA 10612"], value="RA 7687")) + "</div>"
        + '<div class="row" style="gap:14px">' + button("Save changes") + '<span class="small" style="color:var(--success)">Saved.</span></div></div>'
        + '<div class="panel stack" style="gap:14px"><h2 class="h2">Term history</h2>' + history + "</div>"
        + '<div class="panel stack" style="gap:12px"><h2 class="h2">Audit trail</h2><ul style="margin:0;padding:0;list-style:none" class="stack">'
        + "".join(
            f'<li class="stack" style="gap:2px;padding:10px 0;border-bottom:1px solid var(--line-soft)"><div class="row" style="justify-content:space-between"><span style="font-weight:500;color:var(--ink)">{op}</span><span class="small muted">{when}</span></div><span class="small muted">{who}</span></li>'
            for op, when, who in [("UPDATE — people", "8 Sep 2026, 10:14", "By crrd_admin · changed: contact_number"), ("VIEW_RECORD — people", "8 Sep 2026, 10:12", "By crrd_admin · no field-level change recorded"), ("INSERT — memberships", "1 Jun 2026, 09:00", "By system · changed: status, term_id")]
        )
        + "</ul></div></div>"
        + status_dialog
    )
    return admin_board("members", "Members", content, toggle_logic("dlg"), height=1900)


# ── 4. Applications ──────────────────────────────────────────────────────────

def applications() -> str:
    chips, l1 = chip_row("f", ["All", "Pending", "Approved", "Rejected"], default=1)
    rows = [
        [link("Bea Bautista"), sbadge("Pending"), "application/pdf", "7 Sep 2026, 14:02", "—", '<span style="color:var(--success)">✓ meets</span>'],
        [link("Caloy Cruz"), sbadge("Pending"), "image/jpeg", "7 Sep 2026, 11:40", "—", '<span style="color:var(--success)">✓ meets</span>'],
        [link("Dara Dizon"), sbadge("Pending"), "application/pdf", "6 Sep 2026, 19:25", "—", '<span style="color:var(--danger)">✗ expected_grad_year</span>'],
        [link("Eli Estrada"), sbadge("Approved"), "application/pdf", "5 Sep 2026, 08:10", "6 Sep 2026, 09:30", "—"],
        [link("Fara Flores"), sbadge("Rejected"), "image/png", "4 Sep 2026, 16:55", "5 Sep 2026, 10:02", "—"],
    ]
    approve_all = dialog(
        "dlg",
        "Approve every pending application and renewal?",
        '<p class="muted">Approves every pending application and renewal in the current term that meets the submission standards, minting member IDs in one batch. A row that fails a standard is skipped, not approved. This cannot run while the application period is still open — close it first on the application-period page.</p>',
        button("Cancel", "outline", attrs='onClick="{{closeDlg}}"') + button("Approve all pending"),
        "closeDlg",
    )
    content = (
        h1("Applications", "3 pending decisions this term.", right=button("Approve all pending", attrs='onClick="{{openDlg}}" data-testid="approve-all"'))
        + '<div class="stack" style="gap:16px">'
        + '<div class="row">' + chips + '<div class="row" style="gap:8px;margin-left:auto">' + label("Term") + select(["2026-2027", "2025-2026"], extra_class="sm", style="width:160px") + "</div></div>"
        + '<div class="panel" style="padding:0;overflow:hidden">' + table(["Applicant", "Status", "Proof", "Submitted ↓", "Decided", "Standards"], rows) + "</div>"
        + '<div class="row" style="justify-content:space-between"><span class="small muted">Page 1 of 1 · 5 total</span><div class="row" style="gap:8px">' + button("Previous", "outline sm", attrs="disabled") + button("Next", "outline sm", attrs="disabled") + "</div></div>"
        + "</div>" + approve_all
    )
    return admin_board("applications", "Applications", content, l1 + "\n      " + toggle_logic("dlg"))


# ── 5. Application detail ────────────────────────────────────────────────────

def doc_viewer(title: str) -> str:
    return (
        f'<section class="stack" style="gap:10px"><h2 class="h2">{esc(title)}</h2>'
        '<div class="panel" style="height:320px;display:grid;place-items:center;background:#fff;border:1px solid var(--line)">'
        '<div class="stack" style="align-items:center;gap:8px;color:var(--label)">' + icon("file", 40, "#C9CCD1") + '<span class="small">PDF preview (streamed through the audited proxy)</span></div></div></section>'
    )


def detail_cards(kind: str = "application") -> str:
    def card(t, pairs):
        return (
            f'<div class="panel stack" style="gap:14px"><h2 class="h2">{esc(t)}</h2><div class="grid2" style="gap:12px 32px">'
            + "".join(f'<div class="stack" style="gap:2px">{label(k)}<span style="color:var(--ink)">{esc(v)}</span></div>' for k, v in pairs)
            + "</div></div>"
        )
    return (
        card("Personal information", [("First name", "Bea"), ("Middle name", "—"), ("Last name", "Bautista"), ("Suffix", "—"), ("Sex", "Female"), ("Date of birth", "2004-03-15"), ("Age", "22"), ("Email address", "applicant1@start-sys.test"), ("Contact number", "+639170001001"), ("Facebook account", "https://facebook.com/sample1")])
        + card("Scholarship and academic information", [("DOST scholarship award", "RA 7687"), ("Year of award", "2024"), ("University", "University of the Philippines Diliman"), ("Program", "BS Computer Science"), ("Year level", "1"), ("Expected year of graduation", "2030")])
        + card("Membership information", [("Region", "National Capital Region")])
        + card("Consent and certification", [("Privacy notice version agreed to", "v1"), ("Consent recorded at", "7 Sep 2026, 14:02"), ("Accuracy certified at", "7 Sep 2026, 14:02")])
    )


def application_detail() -> str:
    approve = dialog(
        "dlg",
        "Approve Bea Bautista’s application?",
        '<p class="muted">This mints a member ID and creates an active membership for the current term. Approval cannot be undone from this screen — a mistake is corrected by changing the resulting member’s status, not by reversing this decision.</p>',
        button("Cancel", "outline", attrs='onClick="{{closeDlg}}"') + button("Approve"),
        "closeDlg",
    )
    content = (
        '<a href="#" class="small" style="color:var(--label);text-decoration:none">← Back to applications</a>'
        + '<div class="row" style="justify-content:space-between;margin:10px 0 22px"><div class="row" style="gap:14px"><h1 class="title">Bea Bautista</h1>' + sbadge("Pending") + "</div>"
        + '<div class="row" style="gap:10px">' + button("Approve", attrs='onClick="{{openDlg}}"') + button("Reject", "danger") + "</div></div>"
        + '<div class="stack" style="gap:24px">'
        + '<div class="grid2">' + doc_viewer("Notice of Award") + doc_viewer("Latest registration form") + "</div>"
        + detail_cards()
        + "</div>" + approve
    )
    return admin_board("applications", "Applications", content, toggle_logic("dlg"), height=1500)


# ── 6. Application window ────────────────────────────────────────────────────

def application_window() -> str:
    schedule = table(
        ["Form", "Opens", "Closes", "Status"],
        [["membership_application", "1 Sep 2026, 08:00", "30 Sep 2026, 23:59", '<span style="color:var(--success);font-weight:500">Open — the public form accepts submissions</span>'],
         ["membership_renewal", "1 Jun 2026, 08:00", "31 Jul 2026, 23:59", '<span class="muted">Closed — submissions are refused</span>']],
    )

    def period(title, note, primary, closed=False):
        return (
            f'<div class="panel stack" style="gap:16px"><h2 class="h2">{esc(title)}</h2>' + (f'<p class="muted">{note}</p>' if note else "")
            + '<div class="grid2">' + field("Applications open", text_input("", value="2026-09-01T08:00", kind="datetime-local")) + field("Applications close", text_input("", value="2026-09-30T23:59", kind="datetime-local")) + "</div>"
            + '<p class="small muted">Times are entered and shown in your own timezone and stored as absolute instants.</p>'
            + '<div class="row" style="gap:10px">' + button(primary) + button("Close the period now", "outline", attrs="disabled" if closed else "") + "</div></div>"
        )

    content = (
        h1("Application period", "The membership application form at <code>/apply</code> accepts submissions only while a period is open, for the current term (2026-2027).")
        + '<div class="stack" style="gap:24px">'
        + '<div class="panel stack" style="gap:12px"><h2 class="h2">Current schedule</h2>' + schedule + '<p class="small muted">All times shown in Asia/Manila.</p></div>'
        + period("Change or close the open period", "", "Update the open period")
        + period("Schedule the renewal period", "The membership renewal form at <code>/renew</code> — for returning scholars, identified by member ID and email — accepts submissions only while this period is open.", "Open the period", closed=True)
        + '<div class="stack" style="gap:8px;max-width:720px"><h2 class="h2">Closing takes effect on the next submission</h2>'
        '<p class="muted">The check that refuses an application is a database policy, not a cache. The moment a closure is saved, the next submission is refused — including from a browser that already has the form open, and including a forwarded or bookmarked link. Nothing needs to be redeployed and there is no delay to wait out.</p>'
        '<p class="muted">Every open and close is written to the audit log with the officer who did it (US-B4). Closing a period never deletes it: the row stays, with its closing time set to the moment you closed it, so the period people actually applied in remains on the record.</p></div>'
        "</div>"
    )
    return admin_board("applications", "Application period", content, height=1500)


# ── 7–8. Renewals ────────────────────────────────────────────────────────────

def renewals() -> str:
    chips, l1 = chip_row("f", ["Pending", "Approved", "Rejected", "All"], default=0)
    rows = [
        [link("Garcia, Gio"), mono("2025-0006"), sbadge("Pending"), "6 Sep 2026, 12:20", "—"],
        [link("Javier, Jaya"), mono("2025-0009"), sbadge("Pending"), "5 Sep 2026, 17:48", "—"],
        [link("Lopez, Lara"), mono("2024-0012"), sbadge("Pending"), "5 Sep 2026, 09:05", "—"],
    ]
    content = (
        h1("Membership renewals", 'Returning scholars who submitted the renewal form for the current term. Approving one creates their membership for this term; their member ID never changes. The renewal period is opened on the <a href="#">application period</a> page.')
        + '<div class="stack" style="gap:16px">' + chips
        + '<div class="panel" style="padding:0;overflow:hidden" data-testid="renewals-table">' + table(["Member", "Member ID", "Status", "Submitted", "Decided"], rows) + "</div>"
        + '<p class="small muted">All times shown in Asia/Manila.</p></div>'
    )
    return admin_board("renewals", "Renewals", content, l1)


def renewal_detail() -> str:
    approve = dialog(
        "dlg",
        "Approve Gio Garcia’s renewal?",
        '<p class="muted">This creates an active membership for the current term and applies the updated contact and academic details to the member’s record. The member ID does not change. A mistake is corrected on the member’s record, not by reversing this decision.</p>',
        button("Cancel", "outline", attrs='onClick="{{closeDlg}}"') + button("Approve"),
        "closeDlg",
    )
    content = (
        '<a href="#" class="small" style="color:var(--label);text-decoration:none">← Back to renewals</a>'
        + '<div class="row" style="justify-content:space-between;margin:10px 0 22px"><div class="stack" style="gap:4px"><div class="row" style="gap:14px"><h1 class="title">Gio Garcia</h1>' + sbadge("Pending") + "</div>"
        + '<span class="small muted">Member ID <span class="mono">2025-0006</span> — unchanged by renewal</span></div>'
        + '<div class="row" style="gap:10px">' + button("Approve renewal", attrs='onClick="{{openDlg}}" data-testid="approve-renewal"') + button("Reject", "danger") + "</div></div>"
        + '<div class="stack" style="gap:24px"><div class="grid2">' + doc_viewer("Notice of Award") + doc_viewer("Latest registration form") + "</div>" + detail_cards("renewal") + "</div>" + approve
    )
    return admin_board("renewals", "Renewals", content, toggle_logic("dlg"), height=1500)


# ── 9–11. Campaigns ──────────────────────────────────────────────────────────

def campaigns() -> str:
    rows = [
        [link("START-DOST membership applications are open"), "Membership Application Form", sbadge("Sent"), "412", "409", "3", "1 Sep 2026, 09:00"],
        [link("Call for committee members — 2026-2027"), "Committee Application Form", sbadge("Sending"), "180", "125", "0", "7 Sep 2026, 15:30"],
        [link("Renew your START-DOST membership for 2026-2027"), "Membership Renewal Form", sbadge("Queued"), "96", "0", "0", "8 Sep 2026, 08:12"],
        [link("Regional assembly reminder"), "Freeform message", sbadge("Draft"), "—", "—", "—", "8 Sep 2026, 10:40"],
    ]
    content = (
        h1("Campaigns", "Emails and form sends to scholars, filtered by year of membership, role, region, island group and affiliation. Every send is recorded here with its per-recipient delivery report.", right=button("New campaign", href="#"))
        + '<div class="stack" style="gap:12px"><div class="panel" style="padding:0;overflow:hidden" data-testid="campaigns-table">'
        + table(["Subject", "Template", "Status", "Recipients", "Sent", "Failed", "Created"], rows)
        + '</div><p class="small muted">All times shown in Asia/Manila.</p></div>'
    )
    return admin_board("campaigns", "Campaigns", content)


def campaign_new() -> str:
    st_chips, l1 = chip_row("st", ["Active", "Renewal pending", "Graduated", "Resigned", "Left", "Terminated"], default=0, multi=True)
    ig_chips, l2 = chip_row("ig", ["Luzon", "Visayas", "Mindanao"], default=-1, multi=True)
    yl_chips, l3 = chip_row("yl", ["1", "2", "3", "4", "5"], default=-1, multi=True)
    fs = lambda t, body: f'<fieldset style="border:0;padding:0;margin:0" class="stack"><legend class="label" style="margin-bottom:8px">{esc(t)}</legend>{body}</fieldset>'  # noqa: E731
    picker_rows = [
        [checkbox(True), "Bautista, Bea", mono("2024-0001"), "National Capital Region", "CRRD", "Community Outreach", "—"],
        [checkbox(True), "Cruz, Caloy", mono("2024-0002"), "National Capital Region", "Technology", "Scholars' Tech Guild", "DCTO-PD"],
        [checkbox(False), "Dizon, Dara", mono("2025-0003"), "National Capital Region", "—", "Community Outreach", "—"],
        [checkbox(True), "Estrada, Eli", mono("2026-0004"), "Central Visayas", "—", "Scholars' Tech Guild", "—"],
    ]
    left = (
        '<div class="stack" style="gap:22px">'
        + field("Template", select(["Freeform message", "Membership Application Form", "Committee Application Form", "Membership Renewal Form"]))
        + '<p class="small muted">Choosing a template replaces the subject and message with its starting text. The three form templates carry the link to the public form for this site.</p>'
        + field("Subject", text_input("", value=tok("Renew your START-DOST membership for {{term_label}}")))
        + field("Message", textarea("", value=tok("Hi {{given_name}},\n\nRenewals for {{term_label}} are open. Your member ID stays **{{member_id}}** — renewing never changes it.\n\n[Open the Membership Renewal Form](https://start-sys.vercel.app/renew)\n\nSee you in the community,\nSTART-DOST CRRD"), rows=10))
        + '<p class="small muted">Formatting: <code>**bold**</code>, <code>__underline__</code>, <code>_italic_</code>, <code>~~strike~~</code>, <code>`code`</code>, <code>[label](https://link)</code>, lines starting with <code>-</code> for a list, a blank line for a new paragraph.</p>'
        + tok('<p class="small muted">Merge fields: <code>{{given_name}}</code>, <code>{{family_name}}</code>, <code>{{member_id}}</code>, <code>{{join_year}}</code>, <code>{{region_name}}</code>, <code>{{island_group}}</code>, <code>{{term_label}}</code>, <code>{{year_level}}</code>, <code>{{committee_name}}</code>, <code>{{department_name}}</code>. Nothing else can be merged — a birthdate or a phone number is not on the list, on purpose.</p>')
        + '<div class="panel stack" style="gap:18px"><div class="row" style="justify-content:space-between"><h2 class="h2">Recipients</h2><span class="small" style="font-weight:600;color:var(--ink)" data-testid="audience-count">This will reach 96 people.</span></div>'
        + '<p class="small muted">Every filter is “any of”; leaving one empty means it does not narrow. Only scholars with an email on file for the current term are counted.</p>'
        + fs("Membership status", st_chips)
        + fs("Island group", ig_chips)
        + '<div class="grid2">' + field("Region", select(["Any region", "National Capital Region", "CALABARZON", "Central Visayas", "Western Visayas"], extra_class="sm")) + field("Role held this term", select(["Any role", "Regional Representative", "Committee Member", "Chief Community Development Officer"], extra_class="sm")) + "</div>"
        + '<p class="small muted">No affiliations are recorded yet. A partnership (e.g. START x DataCamp) is a row a CRRD Admin adds, never a code change.</p>'
        + '<div class="grid3">' + field("Department", select(["Any", "Community & Regional Relations Department", "Technology Department"], extra_class="sm")) + field("Committee", select(["Any", "Community Outreach", "Scholars' Tech Guild"], extra_class="sm")) + field("University", select(["Any", "University of the Philippines Diliman", "Mapúa University"], extra_class="sm")) + "</div>"
        + fs("Year level", yl_chips)
        + '<div class="stack" style="gap:12px;border-top:1px solid var(--line-soft);padding-top:16px"><h3 style="font-weight:600;color:var(--ink)">Pick people individually</h3>'
        + '<p class="small muted">Search finds anyone the filters above match. Untick someone to drop them from the send; tick someone to add them even if a filter above would otherwise exclude them.</p>'
        + '<div class="row" style="gap:16px;align-items:flex-end">' + '<div class="stack" style="gap:6px;width:340px">' + label("Search by name or member ID") + text_input("e.g. Dela Cruz or 2024-0001", extra_class="sm") + "</div>"
        + '<label class="row" style="gap:8px;white-space:nowrap;height:36px">' + checkbox(True) + "<span>Everyone matching the filters</span></label>" + button("Clear selection", "outline sm") + '<span class="small muted" style="margin-left:auto;white-space:nowrap;height:36px;display:inline-flex;align-items:center">2 picked, 1 excluded</span></div>'
        + table(["", "Name", "Member ID", "Region", "Department", "Committee", "Position"], picker_rows)
        + '<div class="row" style="justify-content:space-between"><span class="small muted">Showing 1–4 of 96</span><div class="row" style="gap:8px">' + button("Previous", "outline sm", attrs="disabled") + button("Next", "outline sm") + "</div></div>"
        + "</div></div>"
        + '<div class="row" style="gap:16px">' + button("Save draft") + '<span class="small muted">Saving does not send. The draft opens on its own page, where the recipient list is frozen and the send is started — and watched — from there.</span></div>'
        + "</div>"
    )
    right = (
        '<aside class="panel stack" style="gap:14px;position:sticky;top:24px"><h2 class="h2">Preview</h2><p class="small muted">Rendered as a recipient sees it, with sample values in place of the merge fields.</p>'
        '<div style="border:1px solid var(--line);border-radius:12px;padding:18px;background:#fff" class="stack">'
        '<p class="small muted" style="border-bottom:1px solid var(--line-soft);padding-bottom:8px">Subject: Renew your START-DOST membership for 2026-2027</p>'
        '<p>Hi Juan,</p><p>Renewals for 2026-2027 are open. Your member ID stays <strong>2024-0001</strong> — renewing never changes it.</p><p><a href="#">Open the Membership Renewal Form</a></p><p>See you in the community,<br>START-DOST CRRD</p>'
        '<p class="small muted" style="border-top:1px solid var(--line-soft);padding-top:8px">Sent by START-DOST through START-SYS.</p></div></aside>'
    )
    content = (
        h1("New campaign", "Write the message once; each recipient gets it with their own name and details merged in. Messages go out through <code>gmail_smtp</code>.")
        + '<div style="display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:28px;align-items:start">' + left + right + "</div>"
    )
    return admin_board("campaigns", "New campaign", content, "\n      ".join([l1, l2, l3]), height=2050)


def campaign_detail() -> str:
    rows = [
        ["Bautista, Bea", "sample1@start-sys.test", "Sent", "8 Sep 2026, 08:15", ""],
        ["Cruz, Caloy", "sample2@start-sys.test", "Sent", "8 Sep 2026, 08:15", ""],
        ["Dizon, Dara", "sample3@start-sys.test", "Failed", "8 Sep 2026, 08:15", '<span class="small muted">550 mailbox unavailable</span>'],
        ["Estrada, Eli", "sample4@start-sys.test", "Queued", "—", ""],
    ]
    content = (
        '<p class="small muted"><a href="#">Campaigns</a> /</p>'
        + '<div class="row" style="gap:14px;margin:8px 0 4px"><h1 class="title">Renew your START-DOST membership for 2026-2027</h1>' + sbadge("Sending") + "</div>"
        + '<p class="small muted" style="margin-bottom:22px">Membership Renewal Form · created 8 Sep 2026, 08:12 · queued 8 Sep 2026, 08:14</p>'
        + '<div style="display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:24px;align-items:start;margin-bottom:24px">'
        + tok('<section class="stack" style="gap:10px"><h2 class="h2">Message</h2><div class="panel" style="min-height:360px;background:#fff;border:1px solid var(--line)"><p>Hi {{given_name}},</p><p>Renewals for {{term_label}} are open. Your member ID stays <strong>{{member_id}}</strong> — renewing never changes it.</p><p><a href="#">Open the Membership Renewal Form</a></p></div><p class="small muted">Merge fields appear as written here and are filled in per recipient at send.</p></section>')
        + '<div class="stack" style="gap:16px">'
        + '<div class="panel stack" style="gap:12px"><h2 class="h2">Recipients</h2>' + kv([("Status", "active"), ("Year of membership", "any"), ("Island group", "any"), ("Region", "any"), ("Role", "any"), ("Affiliation", "any")]) + '<p class="small" style="color:var(--ink)">96 recipients frozen.</p></div>'
        + '<div class="panel stack" style="gap:12px"><h2 class="h2">Send</h2><div class="bar" role="progressbar"><i style="width:34%"></i></div><p class="small" data-testid="send-progress">33 sent · 1 failed · 62 to go</p>'
        + '<div class="row" style="gap:10px">' + button("Resume sending", attrs='data-testid="send-campaign"') + button("Stop after this chunk", "outline") + "</div>"
        + '<p class="small muted">Sends through gmail_smtp, 25 messages per step, and keeps going until the queue is empty. Leave this page open; if it is closed mid-way, Send again later resumes without re-sending anyone.</p></div>'
        + "</div></div>"
        + '<section class="stack" style="gap:12px"><h2 class="h2">Delivery report</h2><div class="panel" style="padding:0;overflow:hidden" data-testid="recipients-table">'
        + table(["Name", "Email", "Status", "Sent", "Error"], rows)
        + '</div><p class="small muted">“Sent” means the mail server accepted the message. The interim Gmail transport has no bounce reporting (ADR 0010); a bounced address shows up in the sending inbox, not here. All times in Asia/Manila.</p></section>'
    )
    return admin_board("campaigns", "Campaigns", content, height=1300)


# ── 12. Officers ─────────────────────────────────────────────────────────────

def officers() -> str:
    rows = [
        ['<span style="font-weight:600;color:var(--ink)">Chief Executive Officer</span><br><span class="small mono muted">CEO</span>', 'Reyes, Diana<br><span class="small mono muted">2024-0007</span>', sbadge("Active"), "—", button("Record separation", "outline sm")],
        ['<span style="font-weight:600;color:var(--ink)">Chief Operations Officer</span><br><span class="small mono muted">COO</span>', '<span class="muted">Vacant</span>', "", "", button("Appoint", "sm", attrs='onClick="{{openDlg}}"')],
        ['<span style="font-weight:600;color:var(--ink)">Chief Technology Officer</span><br><span class="small mono muted">CTO</span>', 'Cruz, Caloy (acting)<br><span class="small mono muted">2024-0002</span>', sbadge("Active"), "Art. VI §4.2 — designated by the CEO, 3 Sep 2026", button("Record separation", "outline sm")],
        ['<span style="font-weight:600;color:var(--ink)">Chief Community Development Officer</span><br><span class="small mono muted">CCDO</span>', 'Domingo, Carlos<br><span class="small mono muted">2024-0011</span>', sbadge("Active"), "—", button("Record separation", "outline sm")],
        ['<span style="font-weight:600;color:var(--ink)">Deputy Chief Community Development Officer for Community</span><br><span class="small mono muted">DCCDO_C</span>', 'Santos, Mia<br><span class="small mono muted">2025-0014</span>', sbadge("On leave"), "Art. VI §1.2 — LOA approved by the CEO to 30 Sep", button("Record separation", "outline sm")],
        ['<span style="font-weight:600;color:var(--ink)">Regional Representative</span><br><span class="small mono muted">REGIONAL_REP</span>', 'Villanueva, Rina<br><span class="small mono muted">2025-0021</span>', sbadge("Active"), "NCR", button("Record separation", "outline sm") + " " + button("Appoint", "sm", attrs='onClick="{{openDlg}}"')],
    ]
    appoint = dialog(
        "dlg",
        "Appoint Chief Operations Officer",
        '<p class="muted">Records who holds this CBL position for the current term (CBL Art. V §2, Art. VI §4). It does not, by itself, grant a system account or role — assigning one is a separate, tech_admin-only step.</p>'
        + '<div class="row" style="gap:10px;align-items:flex-end"><div style="flex:1">' + field("Member ID", text_input("2026-0001")) + "</div>" + button("Find", "outline") + "</div>"
        + '<label class="row" style="gap:10px">' + checkbox(False) + "<span>Acting appointment (CBL Art. VI §4.1-4.3)</span></label>"
        + field("Note", textarea("Name the CBL Art. VI basis and the decider — at least 10 characters.", rows=3)),
        button("Cancel", "outline", attrs='onClick="{{closeDlg}}"') + button("Appoint"),
        "closeDlg",
    )
    content = (
        h1("Officers", "Who holds each CBL position for the current term, and their standing under CBL Art. VI. Appointing or recording a separation here is a RECORD of a decision made under the Constitution — by the CEO or the Executive Board — not the decision itself (ADR 0012). It does not, by itself, grant a system account or role; that stays a separate, tech_admin-only step at <strong>System → User roles</strong>.")
        + '<div class="panel" style="padding:0;overflow:hidden" data-testid="officers-table">' + table(["Position", "Holder", "Status", "Note", "Action"], rows) + "</div>" + appoint
    )
    return admin_board("officers", "Officers", content, toggle_logic("dlg"), height=1000)


# ── 13. Audit log ────────────────────────────────────────────────────────────

def audit_log() -> str:
    a_chips, l1 = chip_row("a", ["All", "INSERT", "UPDATE", "VIEW_DOCUMENT", "VIEW_RECORD", "CAMPAIGN_QUEUED"], default=0)
    t_chips, l2 = chip_row("t", ["All", "applications", "email_campaigns", "memberships", "people", "user_roles"], default=0)
    diff = lambda items: '<ul style="margin:0;padding:0;list-style:none" class="stack">' + "".join(f'<li><span class="mono muted">{k}</span> {v}</li>' for k, v in items) + "</ul>"  # noqa: E731
    rows = [
        ['<span class="mono">2026-09-08 10:14:02</span>', 'crrd_admin<br><span class="small mono muted">5f1c…9a2e</span>', badge("UPDATE", "neutral"), 'people<br><span class="small mono muted">c7d2…41b0</span>', diff([("contact_number", '<span style="text-decoration:line-through;opacity:.6">«redacted»</span> → «redacted»')])],
        ['<span class="mono">2026-09-08 10:12:40</span>', 'crrd_admin<br><span class="small mono muted">5f1c…9a2e</span>', badge("VIEW_RECORD", "info"), 'people<br><span class="small mono muted">c7d2…41b0</span>', '<span class="muted">No field values changed</span>'],
        ['<span class="mono">2026-09-08 08:14:11</span>', 'exec_admin<br><span class="small mono muted">0b77…d3c1</span>', badge("CAMPAIGN_QUEUED", "neutral"), 'email_campaigns<br><span class="small mono muted">9e40…77aa</span>', diff([("status", "draft → queued"), ("recipient_count", "0 → 96")])],
        ['<span class="mono">2026-09-07 14:03:55</span>', 'crrd_admin<br><span class="small mono muted">5f1c…9a2e</span>', badge("VIEW_DOCUMENT", "info"), 'applications<br><span class="small mono muted">1a9f…e2d4</span>', '<span class="muted">No field values changed</span>'],
        ['<span class="mono">2026-09-06 09:30:08</span>', 'crrd_admin<br><span class="small mono muted">5f1c…9a2e</span>', badge("INSERT", "success"), 'memberships<br><span class="small mono muted">3c1e…b8f9</span>', diff([("status", "active"), ("term_id", "2026-2027"), ("region_id", "NCR")])],
    ]
    content = (
        h1("Audit log", "Append-only. Sensitive values were masked before each entry was written, and there is no path to reveal them.")
        + '<div class="stack" style="gap:16px">'
        + '<div class="stack" style="gap:10px"><div class="row" style="gap:12px">' + label("Action") + a_chips + "</div>"
        + '<div class="row" style="gap:12px">' + label("Table") + t_chips + "</div></div>"
        + '<div class="panel" style="padding:0;overflow:hidden">' + table(["When (Asia/Manila)", "Actor", "Action", "Record", "Changed"], rows) + "</div>"
        + '<a href="#" style="font-weight:500">Older entries →</a></div>'
    )
    return admin_board("audit", "Audit log", content, l1 + "\n      " + l2, height=1000)


# ── 14–15. System (tech_admin) ───────────────────────────────────────────────

def system() -> str:
    content = (
        h1("System", "Configuration and access control — reserved to the Technical Admin (CBL Art. III §2.3; PRD §2 “configure the system and control access”).")
        + '<div class="stack" style="gap:20px;max-width:900px">'
        + '<div class="panel stack" style="gap:14px"><h2 class="h2">Current term</h2><div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px">'
        + "".join(f'<div class="stack" style="gap:2px">{label(k)}<span style="color:var(--ink);font-weight:500">{esc(v)}</span></div>' for k, v in [("Label", "2026-2027"), ("Starts", "2026-06-01"), ("Ends", "2027-05-31"), ("Status", "ACTIVE")])
        + "</div></div>"
        + '<div class="grid2" style="gap:16px">'
        + '<a href="#" class="panel stack" style="gap:6px;text-decoration:none"><span class="h2">User roles</span><span class="small muted">Invite accounts and assign or revoke the seven access tiers (US-E3).</span></a>'
        + '<a href="#" class="panel stack" style="gap:6px;text-decoration:none"><span class="h2">Application windows</span><span class="small muted">Open or close the application period (US-B4). Managed on the Applications surface — crrd_admin and tech_admin per ADR 0003.</span></a>'
        + "</div></div>"
    )
    return admin_board("system", "System", content, role="tech_admin", links=TECH_LINKS)


def user_roles() -> str:
    role_sel = lambda v: select(["exec_admin", "tech_admin", "crrd_admin", "officer", "regional_rep"], value=v, extra_class="sm", style="width:160px")  # noqa: E731
    rows = [
        ['<span class="mono small">0b77c2e1-…-d3c1</span>', "Diana Reyes (2024-0007)", role_sel("exec_admin"), '<span class="muted small">— (not a Regional Representative)</span>', button("Revoke", "outline sm")],
        ['<span class="mono small">2ad9f0b4-…-8e15</span>', "—", role_sel("tech_admin"), '<span class="muted small">— (not a Regional Representative)</span>', button("Revoke", "outline sm")],
        ['<span class="mono small">5f1c7a88-…-9a2e</span>', "Carlos Domingo (2024-0011)", role_sel("crrd_admin"), '<span class="muted small">— (not a Regional Representative)</span>', button("Revoke", "outline sm")],
        ['<span class="mono small">7c3e11d0-…-b402</span>', "Mia Santos (2025-0014)", role_sel("crrd_admin"), '<span class="muted small">— (not a Regional Representative)</span>', button("Save", "sm") + " " + button("Revoke", "outline sm")],
        ['<span class="mono small">9e40aa17-…-77aa</span>', "Rina Villanueva (2025-0021)", role_sel("regional_rep"), select(["Select a region…", "National Capital Region (NCR)", "CALABARZON (R04A)"], value="National Capital Region (NCR)", extra_class="sm", style="width:220px"), button("Revoke", "outline sm")],
    ]
    invite = dialog(
        "dlg",
        "Invite user",
        '<p class="muted">No public signup exists (PRD MVP item 1). Sends a one-time invite email and, on acceptance, grants the role selected below.</p>'
        + field("Email", text_input("", kind="email"))
        + field("Role", select(["officer", "exec_admin", "tech_admin", "crrd_admin", "regional_rep"]))
        + field("Person id (optional)", text_input("uuid — leave blank for a system-only account", extra_class="mono")),
        button("Cancel", "outline", attrs='onClick="{{closeDlg}}"') + button("Send invite"),
        "closeDlg",
    )
    content = (
        h1("User roles", "Public signup is disabled (PRD MVP item 1) — accounts exist only by invitation. Assigning or revoking a role here takes effect on that account's next request (US-E3); nothing here silently confirms which of “no account” or “no role” produced an empty result.", right=button("Invite user", attrs='onClick="{{openDlg}}"'))
        + '<div class="stack" style="gap:12px"><div class="panel" style="padding:0;overflow:hidden">' + table(["Account", "Person", "Role", "Region", ""], rows) + "</div>"
        + '<p class="small muted">Accounts are identified by their <code>auth.users.id</code> above, not by email — PostgREST has no read access to <code>auth.users</code>, and granting it would widen the service-role boundary this system is built to avoid (ARCHITECTURE.md §5).</p></div>' + invite
    )
    return admin_board("userroles", "User roles", content, toggle_logic("dlg"), role="tech_admin", links=TECH_LINKS)


BOARDS = {
    "AdminDashboard": (dashboard(), 1440, 900),
    "Members": (members(), 1440, 1180),
    "MemberDetail": (member_detail(), 1440, 1900),
    "Applications": (applications(), 1440, 900),
    "ApplicationDetail": (application_detail(), 1440, 1500),
    "ApplicationWindow": (application_window(), 1440, 1500),
    "Renewals": (renewals(), 1440, 900),
    "RenewalDetail": (renewal_detail(), 1440, 1500),
    "Campaigns": (campaigns(), 1440, 900),
    "CampaignNew": (campaign_new(), 1440, 2050),
    "CampaignDetail": (campaign_detail(), 1440, 1300),
    "Officers": (officers(), 1440, 1000),
    "AuditLog": (audit_log(), 1440, 1000),
    "System": (system(), 1440, 900),
    "UserRoles": (user_roles(), 1440, 900),
}
